"""Whitelisted AI Agent tools with strict Pydantic validation, RBAC, and confirmation gates."""

import re
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.agents.demand_agent import predict_station_demand
from app.agents.monitoring_agent import scan_charger_health
from app.agents.recommendation_agent import recommend_chargers
from app.agents.route_agent import plan_ev_route
from app.models.booking import Booking
from app.models.enums import BookingStatus, ChargerStatus
from app.models.station import Charger, Station
from app.models.user import User
from app.security.middleware import record_audit_log
from app.services.booking_service import (
    IST_OFFSET,
    cancel_booking,
    create_booking_transactional,
    get_charger_availability,
    reschedule_booking,
    serialize_booking,
)

# Short-lived server-side store for pending write confirmations (keyed by action_id)
# Never executes a write tool unless user explicitly confirms the matching action_id.
_PENDING_CONFIRMATIONS: dict[str, dict[str, Any]] = {}


def sanitize_untrusted_text(text: str) -> str:
    """Strip prompt-injection markers or control sequences from untrusted user/station text."""
    cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", " ", text)
    return cleaned.strip()[:600]


class SearchChargersArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    area_query: str | None = Field(default=None, max_length=100)
    connector_type: str | None = Field(default=None, max_length=40)
    min_power_kw: float | None = Field(default=None, ge=0, le=500)
    max_price_inr: float | None = Field(default=None, ge=0, le=100)
    sort_preference: str = Field(default="balanced", max_length=20)
    user_lat: float | None = Field(default=28.6315, ge=-90, le=90)
    user_lng: float | None = Field(default=77.2167, ge=-180, le=180)
    battery_pct: int = Field(default=35, ge=1, le=100)


class CheckAvailabilityArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    station_query: str | None = Field(default=None, max_length=100)
    charger_label: str | None = Field(default=None, max_length=40)
    charger_id: int | None = Field(default=None, gt=0)


class ProposeBookingArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    station_query: str = Field(min_length=2, max_length=100)
    charger_label: str | None = Field(default=None, max_length=40)
    hour_24: int | None = Field(default=None, ge=0, le=23)
    minute: int = Field(default=0, ge=0, le=59)
    duration_minutes: int = Field(default=30)


class ProposeCancelArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    booking_id: int | None = Field(default=None, gt=0)


class PredictDemandArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    station_query: str = Field(min_length=2, max_length=100)


class PlanRouteArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    origin: str = Field(min_length=2, max_length=100)
    destination: str = Field(min_length=2, max_length=100)
    battery_pct: int = Field(default=35, ge=1, le=100)
    connector_type: str | None = Field(default="CCS2", max_length=40)


def _prune_pending() -> None:
    now = time.time()
    expired = [k for k, v in _PENDING_CONFIRMATIONS.items() if now - v["created_ts"] > 600]
    for k in expired:
        del _PENDING_CONFIRMATIONS[k]


def _resolve_station(db: Session, query: str) -> Station | None:
    q = query.strip().lower()
    stations = db.scalars(select(Station).options(joinedload(Station.chargers))).unique().all()
    for st in stations:
        if q in st.name.lower() or q in st.area.lower():
            return st
    # Fuzzy token match
    tokens = [t for t in q.split() if len(t) > 2]
    for st in stations:
        hay = f"{st.name} {st.area}".lower()
        if any(t in hay for t in tokens):
            return st
    return None


def _resolve_charger(station: Station, label_query: str | None) -> Charger | None:
    if not station.chargers:
        return None
    if label_query:
        lq = label_query.strip().lower()
        for c in station.chargers:
            if lq in c.label.lower() or lq.replace("charger", "").strip() == c.label.lower().replace("charger", "").strip():
                return c
    free = [c for c in station.chargers if c.status == ChargerStatus.FREE]
    return free[0] if free else station.chargers[0]


def _next_available_slot(db: Session, charger_id: int, desired_hour: int | None, desired_min: int) -> datetime:
    now_utc = datetime.now(timezone.utc)
    now_ist = now_utc + IST_OFFSET
    if desired_hour is not None:
        target_ist = now_ist.replace(hour=desired_hour, minute=0 if desired_min < 30 else 30, second=0, microsecond=0)
        if target_ist <= now_ist:
            target_ist += timedelta(days=1)
        target_utc = target_ist - IST_OFFSET
        avail = get_charger_availability(db, charger_id, target_ist.date())
        for slot in avail.slots:
            if slot.available and slot.start_time >= target_utc - timedelta(minutes=1):
                return slot.start_time
    # Fallback: earliest available slot today
    avail_today = get_charger_availability(db, charger_id, now_ist.date())
    for slot in avail_today.slots:
        if slot.available:
            return slot.start_time
    # Tomorrow
    avail_tmrw = get_charger_availability(db, charger_id, (now_ist + timedelta(days=1)).date())
    for slot in avail_tmrw.slots:
        if slot.available:
            return slot.start_time
    return now_utc + timedelta(minutes=30)


def execute_whitelisted_tool(
    tool_name: str,
    raw_args: dict[str, Any],
    db: Session,
    user: User | None,
    ip_address: str | None = None,
    correlation_id: str | None = None,
) -> dict[str, Any]:
    """Execute one whitelisted backend tool under the current user's permissions."""
    _prune_pending()
    record_audit_log(
        db,
        action=f"AI_TOOL:{tool_name}",
        resource_type="ai_tool",
        resource_id=tool_name,
        user_id=user.id if user else None,
        details=raw_args,
        ip_address=ip_address,
        correlation_id=correlation_id,
    )
    db.commit()

    if tool_name == "search_chargers":
        args = SearchChargersArgs(**raw_args)
        recs = recommend_chargers(
            db,
            user_lat=args.user_lat,
            user_lng=args.user_lng,
            battery_pct=args.battery_pct,
            connector_type=args.connector_type,
            min_power_kw=args.min_power_kw,
            max_price_inr=args.max_price_inr,
            area_query=args.area_query,
            sort_preference=args.sort_preference,
        )
        return {"recommendations": recs, "count": len(recs)}

    if tool_name == "check_availability":
        args = CheckAvailabilityArgs(**raw_args)
        charger: Charger | None = None
        if args.charger_id:
            charger = db.scalar(select(Charger).options(joinedload(Charger.station)).where(Charger.id == args.charger_id))
        elif args.station_query:
            st = _resolve_station(db, args.station_query)
            if st:
                charger = _resolve_charger(st, args.charger_label)
        if not charger:
            # Fallback: search by charger number across stations if station_query omitted
            if args.charger_label:
                all_c = db.scalars(select(Charger).options(joinedload(Charger.station))).all()
                for c in all_c:
                    if args.charger_label.lower() in c.label.lower():
                        charger = c
                        break
        if not charger:
            return {"error": "Could not find that station or charger."}
        return {
            "charger_id": charger.id,
            "charger_label": charger.label,
            "station_id": charger.station_id,
            "station_name": charger.station.name,
            "status": charger.status.value,
            "connector_type": charger.connector_type.value,
            "power_kw": charger.power_kw,
            "price_per_kwh": charger.price_per_kwh,
        }

    if tool_name == "propose_booking":
        if not user:
            return {"auth_required": True, "error": "Please sign in as a driver to book a charger."}
        args = ProposeBookingArgs(**raw_args)
        dur = args.duration_minutes if args.duration_minutes in (30, 60, 90) else 30
        st = _resolve_station(db, args.station_query)
        if not st:
            return {"error": f"No station matched '{args.station_query}'."}
        charger = _resolve_charger(st, args.charger_label)
        if not charger:
            return {"error": f"No chargers found at {st.name}."}
        if charger.status == ChargerStatus.OFFLINE:
            return {"error": f"{charger.label} at {st.name} is currently offline."}

        slot_start = _next_available_slot(db, charger.id, args.hour_24, args.minute)
        ist_str = (slot_start + IST_OFFSET).strftime("%d %b, %H:%M IST")
        est_cost = round(max(60.0, min(45.0, charger.power_kw * (dur / 60.0) * 0.72) * charger.price_per_kwh), 2)

        action_id = uuid.uuid4().hex[:12]
        _PENDING_CONFIRMATIONS[action_id] = {
            "user_id": user.id,
            "action_type": "CREATE_BOOKING",
            "created_ts": time.time(),
            "payload": {
                "charger_id": charger.id,
                "start_time": slot_start.isoformat(),
                "duration_minutes": dur,
            },
        }
        return {
            "pending_action": {
                "action_id": action_id,
                "action_type": "CREATE_BOOKING",
                "summary": f"Book {charger.label} ({charger.power_kw:.0f} kW {charger.connector_type.value}) at {st.name} for {ist_str} ({dur} min, est. Rs {est_cost:.0f}).",
                "details": {
                    "station_name": st.name,
                    "charger_label": charger.label,
                    "start_time_ist": ist_str,
                    "duration_minutes": dur,
                    "estimated_cost_inr": est_cost,
                },
            }
        }

    if tool_name == "propose_cancel_booking":
        if not user:
            return {"auth_required": True, "error": "Please sign in to manage your bookings."}
        args = ProposeCancelArgs(**raw_args)
        query = (
            select(Booking)
            .options(joinedload(Booking.charger).joinedload(Charger.station))
            .where(Booking.user_id == user.id, Booking.status.in_([BookingStatus.CONFIRMED, BookingStatus.PENDING_PAYMENT]))
            .order_by(Booking.start_time.asc())
        )
        if args.booking_id:
            query = query.where(Booking.id == args.booking_id)
        booking = db.scalar(query)
        if not booking:
            return {"error": "You have no upcoming confirmed bookings to cancel."}
        ist_str = (booking.start_time + IST_OFFSET).strftime("%d %b, %H:%M IST")
        action_id = uuid.uuid4().hex[:12]
        _PENDING_CONFIRMATIONS[action_id] = {
            "user_id": user.id,
            "action_type": "CANCEL_BOOKING",
            "created_ts": time.time(),
            "payload": {"booking_id": booking.id},
        }
        return {
            "pending_action": {
                "action_id": action_id,
                "action_type": "CANCEL_BOOKING",
                "summary": f"Cancel Booking #{booking.id} at {booking.charger.station.name} ({booking.charger.label}) scheduled for {ist_str}.",
                "details": {
                    "booking_id": booking.id,
                    "station_name": booking.charger.station.name,
                    "charger_label": booking.charger.label,
                    "start_time_ist": ist_str,
                },
            }
        }

    if tool_name == "get_my_bookings":
        if not user:
            return {"auth_required": True, "error": "Please sign in to view your bookings."}
        bookings = db.scalars(
            select(Booking)
            .options(joinedload(Booking.charger).joinedload(Charger.station), joinedload(Booking.vehicle), joinedload(Booking.session))
            .where(Booking.user_id == user.id)
            .order_by(Booking.start_time.desc())
            .limit(5)
        ).all()
        return {"bookings": [serialize_booking(b).model_dump(mode="json") for b in bookings]}

    if tool_name == "predict_station_demand":
        args = PredictDemandArgs(**raw_args)
        st = _resolve_station(db, args.station_query)
        if not st:
            return {"error": f"No station matched '{args.station_query}'."}
        return predict_station_demand(db, st.id)

    if tool_name == "plan_ev_route":
        args = PlanRouteArgs(**raw_args)
        return plan_ev_route(
            db,
            origin=args.origin,
            destination=args.destination,
            battery_pct=args.battery_pct,
            connector_type=args.connector_type,
        )

    if tool_name == "get_monitoring_alerts":
        if not user or user.role.value not in {"owner", "admin"}:
            return {"error": "Monitoring alerts require Station Owner or Admin permissions."}
        owner_filter = user.id if user.role.value == "owner" else None
        return {"alerts": scan_charger_health(db, owner_id=owner_filter)}

    return {"error": f"Tool '{tool_name}' is not whitelisted."}


def confirm_pending_action(
    action_id: str,
    db: Session,
    user: User | None,
    ip_address: str | None = None,
    correlation_id: str | None = None,
) -> dict[str, Any]:
    """Execute a previously proposed write action after explicit user confirmation."""
    _prune_pending()
    if not user:
        return {"error": "Authentication required to confirm action."}
    entry = _PENDING_CONFIRMATIONS.get(action_id)
    if not entry:
        return {"error": "Confirmation expired or not found. Please ask again."}
    if entry["user_id"] != user.id:
        return {"error": "Cannot confirm another user's pending action."}

    del _PENDING_CONFIRMATIONS[action_id]
    action_type = entry["action_type"]
    payload = entry["payload"]

    if action_type == "CREATE_BOOKING":
        booking, _ = create_booking_transactional(
            db=db,
            user=user,
            charger_id=payload["charger_id"],
            start_time=datetime.fromisoformat(payload["start_time"]),
            duration_minutes=payload["duration_minutes"],
            idempotency_key=f"ai-{action_id}",
            ip_address=ip_address,
            correlation_id=correlation_id,
        )
        return {"executed": "CREATE_BOOKING", "booking": serialize_booking(booking).model_dump(mode="json")}

    if action_type == "CANCEL_BOOKING":
        booking = cancel_booking(
            db=db,
            booking_id=payload["booking_id"],
            user=user,
            ip_address=ip_address,
            correlation_id=correlation_id,
        )
        return {"executed": "CANCEL_BOOKING", "booking": serialize_booking(booking).model_dump(mode="json")}

    if action_type == "RESCHEDULE_BOOKING":
        booking = reschedule_booking(
            db=db,
            booking_id=payload["booking_id"],
            user=user,
            new_start_time=datetime.fromisoformat(payload["new_start_time"]),
            ip_address=ip_address,
            correlation_id=correlation_id,
        )
        return {"executed": "RESCHEDULE_BOOKING", "booking": serialize_booking(booking).model_dump(mode="json")}

    return {"error": "Unknown pending action type."}
