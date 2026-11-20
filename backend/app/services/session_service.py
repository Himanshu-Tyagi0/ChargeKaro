"""Charging session simulation, QR check-in, live stats, and invoice generation."""

import uuid
from datetime import datetime, timezone

import jwt
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.core.database import immediate_write_transaction
from app.models.audit import Notification
from app.models.booking import Booking, ChargingSession, Payment
from app.models.enums import BookingStatus, ChargerStatus, NotificationType, SessionStatus
from app.models.station import Charger, StatusEvent
from app.models.user import User, Vehicle
from app.schemas.booking import InvoiceOut, SessionOut
from app.security.middleware import record_audit_log
from app.security.tokens import decode_qr_token


def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def compute_live_session_stats(
    session: ChargingSession,
    charger: Charger,
    vehicle: Vehicle | None = None,
) -> SessionOut:
    """Calculate real-time simulated battery %, kWh delivered, and INR cost."""
    now_utc = datetime.now(timezone.utc)
    started = _as_utc(session.started_at)

    if session.status == SessionStatus.COMPLETED:
        return SessionOut(
            id=session.id,
            booking_id=session.booking_id,
            charger_id=session.charger_id,
            station_id=charger.station_id,
            station_name=charger.station.name,
            charger_label=charger.label,
            power_kw=charger.power_kw,
            price_per_kwh=charger.price_per_kwh,
            started_at=started,
            ended_at=_as_utc(session.ended_at) if session.ended_at else now_utc,
            initial_battery_pct=session.initial_battery_pct,
            current_battery_pct=round(session.current_battery_pct, 1),
            target_battery_pct=session.target_battery_pct,
            kwh_delivered=round(session.kwh_delivered, 2),
            total_cost_inr=round(session.total_cost_inr, 2),
            estimated_minutes_remaining=0,
            status=session.status,
        )

    # Demo acceleration: 1 real second = 18 simulated charging seconds (~30s shows meaningful charge!)
    elapsed_real_sec = max(1.0, (now_utc - started).total_seconds())
    sim_hours = (elapsed_real_sec * 18.0) / 3600.0
    capacity_kwh = vehicle.battery_capacity_kwh if vehicle else 40.5
    max_deliverable_kwh = max(
        1.0, capacity_kwh * ((session.target_battery_pct - session.initial_battery_pct) / 100.0)
    )
    kwh_delivered = min(max_deliverable_kwh, charger.power_kw * 0.88 * sim_hours)
    pct_gain = (kwh_delivered / capacity_kwh) * 100.0
    current_pct = min(float(session.target_battery_pct), session.initial_battery_pct + pct_gain)
    cost_inr = round(kwh_delivered * charger.price_per_kwh, 2)

    remaining_kwh = max(0.0, max_deliverable_kwh - kwh_delivered)
    eff_kw = max(1.0, charger.power_kw * 0.88)
    est_mins_left = int(round((remaining_kwh / eff_kw) * 60.0))

    return SessionOut(
        id=session.id,
        booking_id=session.booking_id,
        charger_id=session.charger_id,
        station_id=charger.station_id,
        station_name=charger.station.name,
        charger_label=charger.label,
        power_kw=charger.power_kw,
        price_per_kwh=charger.price_per_kwh,
        started_at=started,
        ended_at=None,
        initial_battery_pct=session.initial_battery_pct,
        current_battery_pct=round(current_pct, 1),
        target_battery_pct=session.target_battery_pct,
        kwh_delivered=round(kwh_delivered, 2),
        total_cost_inr=cost_inr,
        estimated_minutes_remaining=est_mins_left,
        status=session.status,
    )


def checkin_booking_and_start(
    db: Session,
    booking_id: int,
    user: User,
    qr_token: str | None = None,
    simulate_scan: bool = False,
    ip_address: str | None = None,
    correlation_id: str | None = None,
) -> ChargingSession:
    """Verify single-use signed QR token (or demo simulate_scan) and start charging session."""
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
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot check in to another user's booking")

        if booking.qr_used:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="QR check-in token has already been used")

        if booking.session and booking.session.status == SessionStatus.ACTIVE:
            return booking.session

        if booking.status not in {BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Booking is {booking.status.value} and cannot check in")

        if not simulate_scan:
            if not qr_token:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="QR token is required")
            try:
                payload = decode_qr_token(qr_token)
            except jwt.PyJWTError:
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired QR token")
            if payload.get("bid") != booking.id or payload.get("jti") != booking.qr_token_jti:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="QR token does not match this booking")

        booking.qr_used = True
        booking.status = BookingStatus.CHARGING
        booking.updated_at = now_utc

        prev = booking.charger.status
        booking.charger.status = ChargerStatus.OCCUPIED
        booking.charger.last_updated = now_utc
        db.add(
            StatusEvent(
                charger_id=booking.charger.id,
                previous_status=prev,
                new_status=ChargerStatus.OCCUPIED,
                source="SESSION_START",
            )
        )

        init_pct = booking.vehicle.current_battery_pct if booking.vehicle else 28
        session = ChargingSession(
            booking_id=booking.id,
            charger_id=booking.charger.id,
            user_id=booking.user_id,
            started_at=now_utc,
            initial_battery_pct=init_pct,
            current_battery_pct=float(init_pct),
            target_battery_pct=85,
            kwh_delivered=0.0,
            total_cost_inr=0.0,
            status=SessionStatus.ACTIVE,
        )
        db.add(session)
        db.flush()

        db.add(
            Notification(
                user_id=booking.user_id,
                title="Charging Started",
                message=f"Live session active on {booking.charger.label} at {booking.charger.station.name}.",
                type=NotificationType.INFO,
            )
        )
        record_audit_log(
            db,
            action="SESSION_STARTED",
            resource_type="session",
            resource_id=session.id,
            user_id=user.id,
            details={"booking_id": booking.id, "charger_id": booking.charger.id, "simulate_scan": simulate_scan},
            ip_address=ip_address,
            correlation_id=correlation_id,
        )

    return db.scalar(select(ChargingSession).where(ChargingSession.id == session.id))


def stop_session_and_generate_invoice(
    db: Session,
    session_id: int,
    user: User,
    ip_address: str | None = None,
    correlation_id: str | None = None,
) -> tuple[ChargingSession, InvoiceOut]:
    """Stop active charging session, release charger to FREE, and return invoice."""
    now_utc = datetime.now(timezone.utc)
    with immediate_write_transaction(db):
        session = db.scalar(select(ChargingSession).where(ChargingSession.id == session_id))
        if not session:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Charging session not found")
        if session.user_id != user.id and user.role.value != "admin":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot stop another user's session")

        booking = db.scalar(
            select(Booking)
            .options(
                joinedload(Booking.charger).joinedload(Charger.station),
                joinedload(Booking.vehicle),
                joinedload(Booking.payments),
                joinedload(Booking.user),
            )
            .where(Booking.id == session.booking_id)
        )
        charger = booking.charger

        if session.status == SessionStatus.ACTIVE:
            stats = compute_live_session_stats(session, charger, booking.vehicle)
            # Ensure a minimum demo delivery so invoice looks meaningful
            delivered = max(1.2, stats.kwh_delivered)
            energy_charge = round(delivered * charger.price_per_kwh, 2)
            session.ended_at = now_utc
            session.kwh_delivered = delivered
            session.current_battery_pct = max(stats.current_battery_pct, float(session.initial_battery_pct + 4))
            session.total_cost_inr = energy_charge
            session.status = SessionStatus.COMPLETED

            booking.status = BookingStatus.COMPLETED
            booking.updated_at = now_utc

            prev = charger.status
            charger.status = ChargerStatus.FREE
            charger.last_updated = now_utc
            db.add(
                StatusEvent(
                    charger_id=charger.id,
                    previous_status=prev,
                    new_status=ChargerStatus.FREE,
                    source="SESSION_STOP",
                )
            )
            db.add(
                Notification(
                    user_id=booking.user_id,
                    title="Charging Complete",
                    message=f"Delivered {delivered:.2f} kWh at {charger.station.name}. Invoice ready.",
                    type=NotificationType.SUCCESS,
                )
            )
            record_audit_log(
                db,
                action="SESSION_COMPLETED",
                resource_type="session",
                resource_id=session.id,
                user_id=user.id,
                details={"kwh": delivered, "cost_inr": energy_charge},
                ip_address=ip_address,
                correlation_id=correlation_id,
            )

    energy_charge = round(session.total_cost_inr, 2)
    platform_fee = 10.0
    gst = round((energy_charge + platform_fee) * 0.18, 2)
    total_paid = round(energy_charge + platform_fee + gst, 2)
    payment = booking.payments[0] if booking.payments else None

    invoice = InvoiceOut(
        invoice_number=f"CK-INV-{session.id:05d}",
        booking_id=booking.id,
        session_id=session.id,
        driver_name=booking.user.full_name,
        station_name=charger.station.name,
        station_address=charger.station.address,
        charger_label=charger.label,
        connector_type=charger.connector_type,
        power_kw=charger.power_kw,
        started_at=_as_utc(session.started_at),
        ended_at=_as_utc(session.ended_at or now_utc),
        kwh_delivered=round(session.kwh_delivered, 2),
        rate_per_kwh_inr=charger.price_per_kwh,
        energy_charge_inr=energy_charge,
        platform_fee_inr=platform_fee,
        gst_inr=gst,
        total_paid_inr=total_paid,
        payment_method=payment.method if payment else "MOCK_UPI",
        payment_reference=payment.reference_id if payment else f"DEMO-{uuid.uuid4().hex[:8].upper()}",
        is_demo=True,
    )
    return session, invoice
