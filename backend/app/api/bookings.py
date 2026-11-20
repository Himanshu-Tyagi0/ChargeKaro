"""Booking and Charging Session REST routes (/api/v1/bookings, /api/v1/sessions)."""

from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, Header, Query, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.core.database import get_db
from app.models.booking import Booking, ChargingSession
from app.models.station import Charger
from app.models.user import User
from app.schemas.booking import (
    AvailabilityOut,
    BookingCreateRequest,
    BookingOut,
    BookingRescheduleRequest,
    CheckInRequest,
    InvoiceOut,
    SessionOut,
)
from app.security.deps import get_current_user, limiter, require_csrf
from app.security.middleware import get_client_ip
from app.services.booking_service import (
    cancel_booking,
    create_booking_transactional,
    get_charger_availability,
    reschedule_booking,
    serialize_booking,
)
from app.services.session_service import (
    checkin_booking_and_start,
    compute_live_session_stats,
    stop_session_and_generate_invoice,
)
from app.services.websocket_manager import ws_manager

router = APIRouter(tags=["bookings & sessions"])


@router.get("/bookings/availability/{charger_id}", response_model=AvailabilityOut)
def charger_availability(
    charger_id: int,
    target_date: date = Query(default_factory=lambda: datetime.now(timezone.utc).date()),
    db: Session = Depends(get_db),
):
    return get_charger_availability(db, charger_id, target_date)


@router.post("/bookings", response_model=BookingOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_csrf)])
@limiter.limit("20/minute")
async def create_booking_endpoint(
    request: Request,
    payload: BookingCreateRequest,
    idempotency_key_header: str | None = Header(default=None, alias="Idempotency-Key"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    idem_key = payload.idempotency_key or idempotency_key_header
    booking, created = create_booking_transactional(
        db=db,
        user=user,
        charger_id=payload.charger_id,
        start_time=payload.start_time,
        duration_minutes=payload.duration_minutes,
        vehicle_id=payload.vehicle_id,
        payment_method=payload.payment_method,
        idempotency_key=idem_key,
        ip_address=get_client_ip(request),
        correlation_id=getattr(request.state, "correlation_id", None),
    )
    out = serialize_booking(booking)
    if created:
        await ws_manager.broadcast_status({
            "type": "charger_status",
            "station_id": booking.charger.station_id,
            "station_name": booking.charger.station.name,
            "charger_id": booking.charger_id,
            "charger_label": booking.charger.label,
            "status": booking.charger.status.value,
            "last_updated": datetime.now(timezone.utc).isoformat(),
        })
        await ws_manager.send_to_user(
            user.id,
            {
                "type": "booking_confirmed",
                "booking_id": booking.id,
                "station_name": booking.charger.station.name,
                "charger_label": booking.charger.label,
            },
        )
    return out


@router.get("/bookings/mine", response_model=list[BookingOut])
def my_bookings(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(Booking)
        .options(joinedload(Booking.charger).joinedload(Charger.station), joinedload(Booking.vehicle), joinedload(Booking.session))
        .where(Booking.user_id == user.id)
        .order_by(Booking.start_time.desc())
    ).all()
    return [serialize_booking(b) for b in rows]


@router.post("/bookings/{booking_id}/cancel", response_model=BookingOut, dependencies=[Depends(require_csrf)])
async def cancel_booking_endpoint(
    booking_id: int,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    booking = cancel_booking(
        db=db,
        booking_id=booking_id,
        user=user,
        ip_address=get_client_ip(request),
        correlation_id=getattr(request.state, "correlation_id", None),
    )
    await ws_manager.broadcast_status({
        "type": "charger_status",
        "station_id": booking.charger.station_id,
        "station_name": booking.charger.station.name,
        "charger_id": booking.charger_id,
        "charger_label": booking.charger.label,
        "status": booking.charger.status.value,
        "last_updated": datetime.now(timezone.utc).isoformat(),
    })
    return serialize_booking(booking)


@router.post("/bookings/{booking_id}/reschedule", response_model=BookingOut, dependencies=[Depends(require_csrf)])
def reschedule_booking_endpoint(
    booking_id: int,
    request: Request,
    payload: BookingRescheduleRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    booking = reschedule_booking(
        db=db,
        booking_id=booking_id,
        user=user,
        new_start_time=payload.new_start_time,
        new_duration_minutes=payload.duration_minutes,
        ip_address=get_client_ip(request),
        correlation_id=getattr(request.state, "correlation_id", None),
    )
    return serialize_booking(booking)


@router.post("/bookings/{booking_id}/checkin", response_model=SessionOut, dependencies=[Depends(require_csrf)])
async def checkin_endpoint(
    booking_id: int,
    request: Request,
    payload: CheckInRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    session = checkin_booking_and_start(
        db=db,
        booking_id=booking_id,
        user=user,
        qr_token=payload.qr_token,
        simulate_scan=payload.simulate_scan,
        ip_address=get_client_ip(request),
        correlation_id=getattr(request.state, "correlation_id", None),
    )
    booking = db.scalar(
        select(Booking)
        .options(joinedload(Booking.charger).joinedload(Charger.station), joinedload(Booking.vehicle))
        .where(Booking.id == session.booking_id)
    )
    await ws_manager.broadcast_status({
        "type": "charger_status",
        "station_id": booking.charger.station_id,
        "station_name": booking.charger.station.name,
        "charger_id": booking.charger_id,
        "charger_label": booking.charger.label,
        "status": booking.charger.status.value,
        "last_updated": datetime.now(timezone.utc).isoformat(),
    })
    return compute_live_session_stats(session, booking.charger, booking.vehicle)


@router.get("/sessions/{session_id}", response_model=SessionOut)
def get_session_live_stats(
    session_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    session = db.get(ChargingSession, session_id)
    if not session:
        from fastapi import HTTPException
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Charging session not found")
    if session.user_id != user.id and user.role.value != "admin":
        from fastapi import HTTPException
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot view another user's session")

    booking = db.scalar(
        select(Booking)
        .options(joinedload(Booking.charger).joinedload(Charger.station), joinedload(Booking.vehicle))
        .where(Booking.id == session.booking_id)
    )
    return compute_live_session_stats(session, booking.charger, booking.vehicle)


@router.post("/sessions/{session_id}/stop", response_model=InvoiceOut, dependencies=[Depends(require_csrf)])
async def stop_session_endpoint(
    session_id: int,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    session, invoice = stop_session_and_generate_invoice(
        db=db,
        session_id=session_id,
        user=user,
        ip_address=get_client_ip(request),
        correlation_id=getattr(request.state, "correlation_id", None),
    )
    charger = db.scalar(select(Charger).options(joinedload(Charger.station)).where(Charger.id == session.charger_id))
    await ws_manager.broadcast_status({
        "type": "charger_status",
        "station_id": charger.station_id,
        "station_name": charger.station.name,
        "charger_id": charger.id,
        "charger_label": charger.label,
        "status": charger.status.value,
        "last_updated": datetime.now(timezone.utc).isoformat(),
    })
    await ws_manager.send_to_user(
        session.user_id,
        {
            "type": "session_complete",
            "session_id": session.id,
            "kwh_delivered": invoice.kwh_delivered,
            "total_paid_inr": invoice.total_paid_inr,
        },
    )
    return invoice
