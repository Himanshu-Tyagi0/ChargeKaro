"""Live charger status simulator and admin demo control operations."""

import asyncio
import random
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import and_, select
from sqlalchemy.orm import Session, joinedload

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.models.audit import Notification
from app.models.booking import Booking
from app.models.enums import BookingStatus, ChargerStatus, NotificationType
from app.models.station import Charger, Station, StatusEvent
from app.services.booking_service import ACTIVE_BOOKING_STATUSES, process_no_shows
from app.services.geo import haversine_km
from app.services.websocket_manager import ws_manager


def _find_best_alternative(db: Session, offline_charger: Charger) -> Charger | None:
    """Find the best FREE compatible charger nearby if a booked charger goes offline."""
    origin_station = offline_charger.station
    candidates = db.scalars(
        select(Charger)
        .options(joinedload(Charger.station))
        .where(
            Charger.id != offline_charger.id,
            Charger.status == ChargerStatus.FREE,
            Charger.connector_type == offline_charger.connector_type,
        )
    ).all()
    if not candidates:
        candidates = db.scalars(
            select(Charger)
            .options(joinedload(Charger.station))
            .where(Charger.id != offline_charger.id, Charger.status == ChargerStatus.FREE)
        ).all()
    if not candidates:
        return None
    candidates.sort(
        key=lambda c: haversine_km(
            origin_station.latitude, origin_station.longitude, c.station.latitude, c.station.longitude
        )
    )
    return candidates[0]


def handle_charger_offline_impact(db: Session, charger: Charger) -> list[tuple[int, dict[str, Any]]]:
    """If a charger goes offline, notify affected upcoming bookings with an alternative."""
    now_utc = datetime.now(timezone.utc)
    affected = db.scalars(
        select(Booking).where(
            Booking.charger_id == charger.id,
            Booking.status == BookingStatus.CONFIRMED,
            Booking.end_time > now_utc,
        )
    ).all()
    user_events: list[tuple[int, dict[str, Any]]] = []
    if not affected:
        return user_events

    alt = _find_best_alternative(db, charger)
    for b in affected:
        if alt:
            msg = (
                f"{charger.label} at {charger.station.name} went offline. "
                f"Smart Booking Agent recommends {alt.label} at {alt.station.name} "
                f"({alt.power_kw} kW, Rs {alt.price_per_kwh}/kWh)."
            )
        else:
            msg = f"{charger.label} at {charger.station.name} went offline. Please reschedule your booking."
        db.add(
            Notification(
                user_id=b.user_id,
                title="Charger Offline — Alternative Ready",
                message=msg,
                type=NotificationType.WARNING,
            )
        )
        user_events.append(
            (
                b.user_id,
                {
                    "type": "booking_alert",
                    "booking_id": b.id,
                    "title": "Charger Offline — Alternative Ready",
                    "message": msg,
                    "suggested_charger_id": alt.id if alt else None,
                    "suggested_station_id": alt.station_id if alt else None,
                },
            )
        )
    return user_events


def step_simulator_once(db: Session) -> tuple[list[dict[str, Any]], list[tuple[int, dict[str, Any]]]]:
    """Run one realistic simulation tick across chargers, respecting active bookings."""
    now_utc = datetime.now(timezone.utc)
    chargers = db.scalars(select(Charger).options(joinedload(Charger.station))).all()
    if not chargers:
        return [], []

    # Chargers locked by active immediate bookings cannot be randomly toggled
    locked_charger_ids = set(
        db.scalars(
            select(Booking.charger_id).where(
                and_(
                    Booking.status.in_(ACTIVE_BOOKING_STATUSES),
                    Booking.start_time <= now_utc + timedelta(minutes=20),
                    Booking.end_time >= now_utc,
                )
            )
        ).all()
    )

    eligible = [c for c in chargers if c.id not in locked_charger_ids]
    if not eligible:
        return [], []

    sample_count = min(len(eligible), random.choice([1, 2]))
    chosen = random.sample(eligible, sample_count)
    broadcasts: list[dict[str, Any]] = []
    user_events: list[tuple[int, dict[str, Any]]] = []

    for c in chosen:
        prev = c.status
        new_status = prev
        r = random.random()

        if prev == ChargerStatus.FREE:
            if r < 0.72:
                new_status = ChargerStatus.OCCUPIED
            elif r < 0.78:
                new_status = ChargerStatus.OFFLINE
        elif prev == ChargerStatus.OCCUPIED:
            if r < 0.75:
                new_status = ChargerStatus.FREE
            elif r < 0.80:
                new_status = ChargerStatus.OFFLINE
        elif prev == ChargerStatus.OFFLINE:
            if r < 0.65:
                new_status = ChargerStatus.FREE
        elif prev == ChargerStatus.BOOKED:
            new_status = ChargerStatus.FREE

        if new_status != prev:
            c.status = new_status
            c.last_updated = now_utc
            c.flap_count += 1
            db.add(
                StatusEvent(
                    charger_id=c.id,
                    previous_status=prev,
                    new_status=new_status,
                    source="SIMULATOR",
                )
            )
            broadcasts.append(
                {
                    "type": "charger_status",
                    "station_id": c.station_id,
                    "station_name": c.station.name,
                    "charger_id": c.id,
                    "charger_label": c.label,
                    "previous_status": prev.value,
                    "status": new_status.value,
                    "last_updated": now_utc.isoformat(),
                }
            )
            if new_status == ChargerStatus.OFFLINE:
                user_events.extend(handle_charger_offline_impact(db, c))

    # Monitoring check: alert owner/admin if charger flapped excessively
    for c in chosen:
        if c.flap_count >= 5 and c.flap_count % 5 == 0:
            owner_id = c.station.owner_id
            msg = f"Monitoring Agent detected frequent status flapping on {c.label} at {c.station.name} ({c.flap_count} transitions)."
            db.add(
                Notification(
                    user_id=owner_id,
                    title="Charger Flapping Alert",
                    message=msg,
                    type=NotificationType.WARNING,
                )
            )
            user_events.append((owner_id, {"type": "monitoring_alert", "title": "Charger Flapping Alert", "message": msg}))

    db.commit()
    return broadcasts, user_events


def simulate_rush_hour(db: Session) -> list[dict[str, Any]]:
    """Admin demo action: push ~75% of free chargers to OCCUPIED to simulate evening peak."""
    now_utc = datetime.now(timezone.utc)
    free_chargers = db.scalars(
        select(Charger).options(joinedload(Charger.station)).where(Charger.status == ChargerStatus.FREE)
    ).all()
    broadcasts: list[dict[str, Any]] = []
    target_count = max(1, int(len(free_chargers) * 0.75))
    for c in random.sample(free_chargers, min(len(free_chargers), target_count)):
        prev = c.status
        c.status = ChargerStatus.OCCUPIED
        c.last_updated = now_utc
        db.add(StatusEvent(charger_id=c.id, previous_status=prev, new_status=ChargerStatus.OCCUPIED, source="DEMO_RUSH_HOUR"))
        broadcasts.append(
            {
                "type": "charger_status",
                "station_id": c.station_id,
                "station_name": c.station.name,
                "charger_id": c.id,
                "charger_label": c.label,
                "previous_status": prev.value,
                "status": ChargerStatus.OCCUPIED.value,
                "last_updated": now_utc.isoformat(),
            }
        )
    db.commit()
    return broadcasts


def force_charger_offline_demo(db: Session, charger_id: int | None = None) -> tuple[list[dict[str, Any]], list[tuple[int, dict[str, Any]]]]:
    """Admin demo action: force a charger OFFLINE to showcase monitoring and re-routing."""
    now_utc = datetime.now(timezone.utc)
    if charger_id:
        c = db.scalar(select(Charger).options(joinedload(Charger.station)).where(Charger.id == charger_id))
    else:
        c = db.scalar(
            select(Charger).options(joinedload(Charger.station)).where(Charger.status != ChargerStatus.OFFLINE)
        )
    if not c:
        return [], []

    prev = c.status
    c.status = ChargerStatus.OFFLINE
    c.last_updated = now_utc
    c.flap_count += 1
    db.add(StatusEvent(charger_id=c.id, previous_status=prev, new_status=ChargerStatus.OFFLINE, source="ADMIN_DEMO"))
    user_events = handle_charger_offline_impact(db, c)
    owner_id = c.station.owner_id
    alert_msg = f"Monitoring Agent: {c.label} at {c.station.name} went OFFLINE."
    db.add(Notification(user_id=owner_id, title="Charger Offline Alert", message=alert_msg, type=NotificationType.WARNING))
    user_events.append((owner_id, {"type": "monitoring_alert", "title": "Charger Offline Alert", "message": alert_msg}))
    db.commit()

    broadcasts = [
        {
            "type": "charger_status",
            "station_id": c.station_id,
            "station_name": c.station.name,
            "charger_id": c.id,
            "charger_label": c.label,
            "previous_status": prev.value,
            "status": ChargerStatus.OFFLINE.value,
            "last_updated": now_utc.isoformat(),
        }
    ]
    return broadcasts, user_events


def _run_simulator_db_tick() -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[tuple[int, dict[str, Any]]]]:
    with SessionLocal() as db:
        no_show_events = process_no_shows(db)
        broadcasts, user_events = step_simulator_once(db)
    return no_show_events, broadcasts, user_events


async def simulator_loop() -> None:
    """Background task running every 5-9 seconds to emit realistic live EV charger telemetry."""
    settings = get_settings()
    if not settings.enable_simulator:
        return

    while True:
        delay = random.uniform(settings.simulator_interval_min_sec, settings.simulator_interval_max_sec)
        await asyncio.sleep(delay)
        try:
            no_show_events, broadcasts, user_events = await asyncio.to_thread(_run_simulator_db_tick)

            for ev in no_show_events:
                await ws_manager.broadcast_status(ev)
                if ev.get("user_id"):
                    await ws_manager.send_to_user(ev["user_id"], {"type": "booking_expired", **ev})
            for b in broadcasts:
                await ws_manager.broadcast_status(b)
            for uid, payload in user_events:
                await ws_manager.send_to_user(uid, payload)
        except asyncio.CancelledError:
            break
        except Exception:
            # Keep background simulator resilient without crashing server
            await asyncio.sleep(3)
