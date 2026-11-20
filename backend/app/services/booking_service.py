"""Transactional booking engine with strict double-booking prevention."""

import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import and_, select
from sqlalchemy.orm import Session, joinedload

from app.core.database import immediate_write_transaction, is_sqlite
from app.models.audit import Notification
from app.models.booking import Booking, Payment
from app.models.enums import BookingStatus, ChargerStatus, NotificationType, PaymentStatus
from app.models.station import Charger, Station, StatusEvent
from app.models.user import User, Vehicle
from app.schemas.booking import AvailabilityOut, BookingOut, TimeSlotOut
from app.security.middleware import record_audit_log
from app.security.tokens import create_qr_token

ACTIVE_BOOKING_STATUSES = {
    BookingStatus.PENDING_PAYMENT,
    BookingStatus.CONFIRMED,
    BookingStatus.CHECKED_IN,
    BookingStatus.CHARGING,
}

IST_OFFSET = timedelta(hours=5, minutes=30)


def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _estimate_cost(charger: Charger, duration_minutes: int) -> float:
    # Realistic energy delivery (~75% average charge curve utilization)
    estimated_kwh = charger.power_kw * (duration_minutes / 60.0) * 0.72
    estimated_kwh = min(estimated_kwh, 45.0)
    return round(max(60.0, estimated_kwh * charger.price_per_kwh), 2)


def serialize_booking(booking: Booking) -> BookingOut:
    charger = booking.charger
    station = charger.station
    qr_token: str | None = None
    if booking.status in {BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN} and booking.qr_token_jti:
        qr_token = create_qr_token(
            booking_id=booking.id,
            user_id=booking.user_id,
            charger_id=booking.charger_id,
            jti=booking.qr_token_jti,
            valid_until=_as_utc(booking.end_time),
        )
    vehicle_name = f"{booking.vehicle.make} {booking.vehicle.model}" if booking.vehicle else None
    return BookingOut(
        id=booking.id,
        user_id=booking.user_id,
        charger_id=booking.charger_id,
        station_id=station.id,
        station_name=station.name,
        station_area=station.area,
        charger_label=charger.label,
        connector_type=charger.connector_type,
        power_kw=charger.power_kw,
        price_per_kwh=charger.price_per_kwh,
        vehicle_id=booking.vehicle_id,
        vehicle_name=vehicle_name,
        start_time=_as_utc(booking.start_time),
        end_time=_as_utc(booking.end_time),
        duration_minutes=booking.duration_minutes,
        status=booking.status,
        estimated_cost_inr=booking.estimated_cost_inr,
        cancellation_fee_inr=booking.cancellation_fee_inr,
        connector_warning=booking.connector_warning,
        qr_token=qr_token,
        qr_used=booking.qr_used,
        session_id=booking.session.id if booking.session else None,
        created_at=_as_utc(booking.created_at),
    )


def get_charger_availability(db: Session, charger_id: int, target_date: date) -> AvailabilityOut:
    """Return 30-minute availability grid for a charger on a given IST date (up to 7 days ahead)."""
    charger = db.get(Charger, charger_id)
    if not charger:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Charger not found")

    now_utc = datetime.now(timezone.utc)
    today_ist = (now_utc + IST_OFFSET).date()
    if target_date < today_ist or target_date > today_ist + timedelta(days=7):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Availability can only be checked from today up to 7 days ahead",
        )

    day_start_ist = datetime(target_date.year, target_date.month, target_date.day, 0, 0, tzinfo=timezone.utc)
    day_start_utc = day_start_ist - IST_OFFSET
    day_end_utc = day_start_utc + timedelta(days=1)

    existing = db.scalars(
        select(Booking).where(
            and_(
                Booking.charger_id == charger_id,
                Booking.status.in_(ACTIVE_BOOKING_STATUSES),
                Booking.start_time < day_end_utc,
                Booking.end_time > day_start_utc,
            )
        )
    ).all()

    slots: list[TimeSlotOut] = []
    for idx in range(48):
        slot_start = day_start_utc + timedelta(minutes=30 * idx)
        slot_end = slot_start + timedelta(minutes=30)
        ist_local = slot_start + IST_OFFSET
        label = ist_local.strftime("%H:%M")

        available = True
        reason: str | None = None
        if charger.status == ChargerStatus.OFFLINE:
            available = False
            reason = "Charger offline"
        elif slot_end <= now_utc:
            available = False
            reason = "Past slot"
        else:
            for b in existing:
                if _as_utc(b.start_time) < slot_end and _as_utc(b.end_time) > slot_start:
                    available = False
                    reason = "Reserved"
                    break

        slots.append(
            TimeSlotOut(
                start_time=slot_start,
                end_time=slot_end,
                label=label,
                available=available,
                reason=reason,
            )
        )

    return AvailabilityOut(charger_id=charger_id, date=target_date.isoformat(), slots=slots)


def create_booking_transactional(
    db: Session,
    user: User,
    charger_id: int,
    start_time: datetime,
    duration_minutes: int,
    vehicle_id: int | None = None,
    payment_method: str = "MOCK_UPI",
    idempotency_key: str | None = None,
    ip_address: str | None = None,
    correlation_id: str | None = None,
) -> tuple[Booking, bool]:
    """Create a confirmed booking with strict double-booking prevention and idempotency.

    Returns (booking, created_new).
    """
    start_utc = _as_utc(start_time)
    end_utc = start_utc + timedelta(minutes=duration_minutes)
    now_utc = datetime.now(timezone.utc)

    if start_utc < now_utc - timedelta(minutes=5):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot book a time slot in the past")
    if start_utc > now_utc + timedelta(days=7, hours=1):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Bookings are allowed up to 7 days ahead")

    with immediate_write_transaction(db):
        if idempotency_key:
            existing_idem = db.scalar(
                select(Booking)
                .options(joinedload(Booking.charger).joinedload(Charger.station), joinedload(Booking.vehicle), joinedload(Booking.session))
                .where(Booking.idempotency_key == idempotency_key, Booking.user_id == user.id)
            )
            if existing_idem:
                return existing_idem, False

        stmt = select(Charger).options(joinedload(Charger.station)).where(Charger.id == charger_id)
        if not is_sqlite:
            stmt = stmt.with_for_update()
        charger = db.scalar(stmt)
        if not charger:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Charger not found")
        if charger.status == ChargerStatus.OFFLINE:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Charger is currently offline")

        # Strict overlap check inside serialized write transaction
        overlap = db.scalar(
            select(Booking).where(
                and_(
                    Booking.charger_id == charger_id,
                    Booking.status.in_(ACTIVE_BOOKING_STATUSES),
                    Booking.start_time < end_utc,
                    Booking.end_time > start_utc,
                )
            )
        )
        if overlap:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This charger is already booked for the selected time window.",
            )

        # Vehicle compatibility check
        vehicle: Vehicle | None = None
        connector_warning: str | None = None
        if vehicle_id:
            vehicle = db.scalar(select(Vehicle).where(Vehicle.id == vehicle_id, Vehicle.user_id == user.id))
            if not vehicle:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Selected vehicle not found")
        else:
            vehicle = db.scalar(select(Vehicle).where(Vehicle.user_id == user.id, Vehicle.is_default == True))  # noqa: E712

        if vehicle and vehicle.connector_type != charger.connector_type:
            connector_warning = (
                f"Connector mismatch: your {vehicle.make} {vehicle.model} uses {vehicle.connector_type.value}, "
                f"while {charger.label} has {charger.connector_type.value}. Adapter required."
            )

        estimated_cost = _estimate_cost(charger, duration_minutes)
        qr_jti = uuid.uuid4().hex

        booking = Booking(
            user_id=user.id,
            charger_id=charger.id,
            vehicle_id=vehicle.id if vehicle else None,
            start_time=start_utc,
            end_time=end_utc,
            duration_minutes=duration_minutes,
            status=BookingStatus.CONFIRMED,
            estimated_cost_inr=estimated_cost,
            idempotency_key=idempotency_key,
            qr_token_jti=qr_jti,
            connector_warning=connector_warning,
        )
        db.add(booking)
        db.flush()

        payment = Payment(
            booking_id=booking.id,
            user_id=user.id,
            amount_inr=estimated_cost,
            method=payment_method,
            reference_id=f"DEMO-{uuid.uuid4().hex[:10].upper()}",
            status=PaymentStatus.PAID,
            idempotency_key=f"pay:{idempotency_key}" if idempotency_key else None,
        )
        db.add(payment)

        # If booking starts within next 20 mins and charger is FREE, reflect BOOKED immediately
        if start_utc <= now_utc + timedelta(minutes=20) and charger.status == ChargerStatus.FREE:
            prev = charger.status
            charger.status = ChargerStatus.BOOKED
            charger.last_updated = now_utc
            db.add(
                StatusEvent(
                    charger_id=charger.id,
                    previous_status=prev,
                    new_status=ChargerStatus.BOOKED,
                    source="BOOKING",
                )
            )

        db.add(
            Notification(
                user_id=user.id,
                title="Booking Confirmed",
                message=f"{charger.label} at {charger.station.name} reserved for {(start_utc + IST_OFFSET).strftime('%d %b %H:%M')} IST.",
                type=NotificationType.SUCCESS,
            )
        )
        record_audit_log(
            db,
            action="BOOKING_CREATED",
            resource_type="booking",
            resource_id=booking.id,
            user_id=user.id,
            details={"charger_id": charger.id, "duration_min": duration_minutes, "cost_inr": estimated_cost},
            ip_address=ip_address,
            correlation_id=correlation_id,
        )

    # Re-load with relationships
    loaded = db.scalar(
        select(Booking)
        .options(joinedload(Booking.charger).joinedload(Charger.station), joinedload(Booking.vehicle), joinedload(Booking.session))
        .where(Booking.id == booking.id)
    )
    return loaded, True


def cancel_booking(
    db: Session,
    booking_id: int,
    user: User,
    ip_address: str | None = None,
    correlation_id: str | None = None,
) -> Booking:
    """Cancel a booking with 15-minute free-cancellation rule."""
    now_utc = datetime.now(timezone.utc)
    with immediate_write_transaction(db):
        booking = db.scalar(
            select(Booking)
            .options(joinedload(Booking.charger).joinedload(Charger.station), joinedload(Booking.vehicle), joinedload(Booking.session))
            .where(Booking.id == booking_id)
        )
        if not booking:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking not found")
        if booking.user_id != user.id and user.role.value != "admin":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot cancel another user's booking")
        if booking.status not in {BookingStatus.PENDING_PAYMENT, BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Cannot cancel booking in status {booking.status.value}")

        mins_to_start = (_as_utc(booking.start_time) - now_utc).total_seconds() / 60.0
        fee = 0.0 if mins_to_start >= 15.0 else 25.0
        booking.status = BookingStatus.CANCELLED
        booking.cancellation_fee_inr = fee
        booking.updated_at = now_utc

        if booking.charger.status == ChargerStatus.BOOKED:
            prev = booking.charger.status
            booking.charger.status = ChargerStatus.FREE
            booking.charger.last_updated = now_utc
            db.add(
                StatusEvent(
                    charger_id=booking.charger.id,
                    previous_status=prev,
                    new_status=ChargerStatus.FREE,
                    source="BOOKING",
                )
            )

        db.add(
            Notification(
                user_id=booking.user_id,
                title="Booking Cancelled",
                message=f"Booking #{booking.id} cancelled. {'Free cancellation applied.' if fee == 0 else f'Late cancellation fee Rs {fee:.0f} applied.'}",
                type=NotificationType.INFO,
            )
        )
        record_audit_log(
            db,
            action="BOOKING_CANCELLED",
            resource_type="booking",
            resource_id=booking.id,
            user_id=user.id,
            details={"fee_inr": fee},
            ip_address=ip_address,
            correlation_id=correlation_id,
        )
    db.refresh(booking)
    return booking


def reschedule_booking(
    db: Session,
    booking_id: int,
    user: User,
    new_start_time: datetime,
    new_duration_minutes: int | None = None,
    ip_address: str | None = None,
    correlation_id: str | None = None,
) -> Booking:
    """Atomically reschedule a confirmed booking after checking slot availability."""
    new_start_utc = _as_utc(new_start_time)
    now_utc = datetime.now(timezone.utc)
    if new_start_utc < now_utc - timedelta(minutes=5):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot reschedule into the past")

    with immediate_write_transaction(db):
        booking = db.scalar(
            select(Booking)
            .options(joinedload(Booking.charger).joinedload(Charger.station), joinedload(Booking.vehicle), joinedload(Booking.session))
            .where(Booking.id == booking_id)
        )
        if not booking:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking not found")
        if booking.user_id != user.id and user.role.value != "admin":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot reschedule another user's booking")
        if booking.status != BookingStatus.CONFIRMED:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only confirmed bookings can be rescheduled")

        dur = new_duration_minutes or booking.duration_minutes
        new_end_utc = new_start_utc + timedelta(minutes=dur)

        overlap = db.scalar(
            select(Booking).where(
                and_(
                    Booking.charger_id == booking.charger_id,
                    Booking.id != booking.id,
                    Booking.status.in_(ACTIVE_BOOKING_STATUSES),
                    Booking.start_time < new_end_utc,
                    Booking.end_time > new_start_utc,
                )
            )
        )
        if overlap:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Selected new time slot conflicts with another booking")

        booking.start_time = new_start_utc
        booking.end_time = new_end_utc
        booking.duration_minutes = dur
        booking.estimated_cost_inr = _estimate_cost(booking.charger, dur)
        booking.updated_at = now_utc

        record_audit_log(
            db,
            action="BOOKING_RESCHEDULED",
            resource_type="booking",
            resource_id=booking.id,
            user_id=user.id,
            details={"new_start": new_start_utc.isoformat(), "duration_min": dur},
            ip_address=ip_address,
            correlation_id=correlation_id,
        )
    db.refresh(booking)
    return booking


def process_no_shows(db: Session) -> list[dict[str, Any]]:
    """Auto-mark bookings NO_SHOW if >10 min past start without check-in and release charger."""
    now_utc = datetime.now(timezone.utc)
    cutoff = now_utc - timedelta(minutes=10)
    stale = db.scalars(
        select(Booking)
        .options(joinedload(Booking.charger).joinedload(Charger.station))
        .where(
            Booking.status == BookingStatus.CONFIRMED,
            Booking.start_time < cutoff,
        )
    ).all()

    events: list[dict[str, Any]] = []
    if not stale:
        return events

    for b in stale:
        b.status = BookingStatus.NO_SHOW
        b.updated_at = now_utc
        if b.charger.status == ChargerStatus.BOOKED:
            prev = b.charger.status
            b.charger.status = ChargerStatus.FREE
            b.charger.last_updated = now_utc
            db.add(
                StatusEvent(
                    charger_id=b.charger.id,
                    previous_status=prev,
                    new_status=ChargerStatus.FREE,
                    source="NO_SHOW_RELEASE",
                )
            )
            events.append({
                "type": "charger_status",
                "station_id": b.charger.station_id,
                "charger_id": b.charger.id,
                "status": ChargerStatus.FREE.value,
                "last_updated": now_utc.isoformat(),
                "user_id": b.user_id,
                "booking_id": b.id,
            })
        db.add(
            Notification(
                user_id=b.user_id,
                title="Booking Marked No-Show",
                message=f"Booking #{b.id} at {b.charger.station.name} expired after 10 minutes without check-in.",
                type=NotificationType.WARNING,
            )
        )
    db.commit()
    return events
