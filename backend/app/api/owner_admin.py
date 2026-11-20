"""Station Owner and Admin dashboard & demo control routes (/api/v1/owner, /api/v1/admin)."""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.agents.demand_agent import predict_station_demand
from app.agents.monitoring_agent import scan_charger_health
from app.core.database import get_db
from app.models.audit import AuditLog
from app.models.booking import Booking
from app.models.enums import BookingStatus, ChargerStatus, UserRole
from app.models.station import Charger, Station
from app.models.user import User
from app.schemas.ai import AuditLogOut
from app.schemas.auth import UserOut
from app.security.deps import require_csrf, require_roles
from app.security.middleware import get_client_ip, record_audit_log
from app.services.booking_service import IST_OFFSET, serialize_booking
from app.services.geo import DELHI_CENTER
from app.services.simulator import force_charger_offline_demo, simulate_rush_hour
from app.services.websocket_manager import ws_manager

router = APIRouter(tags=["owner & admin"])


class ForceOfflineBody(BaseModel):
    charger_id: int | None = None


@router.get("/owner/dashboard")
def owner_dashboard(
    user: User = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
    db: Session = Depends(get_db),
):
    stmt = select(Station).options(joinedload(Station.chargers))
    if user.role == UserRole.OWNER:
        stmt = stmt.where(Station.owner_id == user.id)
    stations = db.scalars(stmt).unique().all()

    station_ids = [s.id for s in stations]
    charger_ids = [c.id for s in stations for c in s.chargers]

    bookings = []
    if charger_ids:
        bookings = db.scalars(
            select(Booking)
            .options(joinedload(Booking.charger).joinedload(Charger.station), joinedload(Booking.vehicle), joinedload(Booking.session))
            .where(Booking.charger_id.in_(charger_ids))
            .order_by(Booking.start_time.desc())
        ).all()

    total_revenue = round(
        sum(b.estimated_cost_inr for b in bookings if b.status in {BookingStatus.COMPLETED, BookingStatus.CONFIRMED, BookingStatus.CHARGING}),
        2,
    )
    total_chargers = len(charger_ids)
    active_now = sum(1 for s in stations for c in s.chargers if c.status in {ChargerStatus.OCCUPIED, ChargerStatus.BOOKED})
    utilization_pct = round((active_now / total_chargers) * 100.0, 1) if total_chargers else 0.0

    # Revenue by day (last 7 days)
    now_ist = datetime.now(timezone.utc) + IST_OFFSET
    revenue_series = []
    for offset in range(6, -1, -1):
        day = (now_ist - timedelta(days=offset)).date()
        day_rev = sum(
            b.estimated_cost_inr
            for b in bookings
            if ((b.start_time + IST_OFFSET).date() == day)
            and b.status != BookingStatus.CANCELLED
        )
        revenue_series.append({"date": day.strftime("%d %b"), "revenue_inr": round(day_rev, 0)})

    # Station utilization breakdown
    station_utilization = []
    for s in stations:
        tot = len(s.chargers) or 1
        busy = sum(1 for c in s.chargers if c.status in {ChargerStatus.OCCUPIED, ChargerStatus.BOOKED})
        station_utilization.append({
            "station_id": s.id,
            "station_name": s.name,
            "utilization_pct": round((busy / tot) * 100.0, 1),
            "free_count": sum(1 for c in s.chargers if c.status == ChargerStatus.FREE),
            "total_count": len(s.chargers),
        })

    # Peak hour heatmap (7 days x 24 hours)
    heatmap = []
    days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    for d_idx, d_name in enumerate(days):
        hours = []
        for h in range(24):
            base = 22 if d_idx < 5 else 30
            if 9 <= h <= 11:
                base += 34
            elif 17 <= h <= 21:
                base += 52
            elif 0 <= h <= 5:
                base -= 14
            count_match = sum(
                1
                for b in bookings
                if (b.start_time + IST_OFFSET).weekday() == d_idx and (b.start_time + IST_OFFSET).hour == h
            )
            val = min(100, base + count_match * 14)
            hours.append({"hour": h, "intensity": val})
        heatmap.append({"day": d_name, "hours": hours})

    demand_insights = [predict_station_demand(db, s.id) for s in stations[:3]]
    alerts = scan_charger_health(db, owner_id=user.id if user.role == UserRole.OWNER else None)

    from app.api.stations import serialize_station
    return {
        "kpis": {
            "total_stations": len(stations),
            "total_chargers": total_chargers,
            "total_bookings": len(bookings),
            "total_revenue_inr": total_revenue,
            "live_utilization_pct": utilization_pct,
        },
        "stations": [serialize_station(s, DELHI_CENTER[0], DELHI_CENTER[1]) for s in stations],
        "bookings": [serialize_booking(b) for b in bookings[:30]],
        "revenue_series": revenue_series,
        "station_utilization": station_utilization,
        "heatmap": heatmap,
        "demand_insights": demand_insights,
        "monitoring_alerts": alerts,
    }


@router.get("/admin/users", response_model=list[UserOut])
def admin_list_users(
    _admin: User = Depends(require_roles(UserRole.ADMIN)),
    db: Session = Depends(get_db),
):
    users = db.scalars(select(User).options(joinedload(User.vehicles)).order_by(User.id)).unique().all()
    return [UserOut.model_validate(u) for u in users]


@router.get("/admin/audit-logs", response_model=list[AuditLogOut])
def admin_audit_logs(
    _admin: User = Depends(require_roles(UserRole.ADMIN)),
    db: Session = Depends(get_db),
):
    logs = db.scalars(select(AuditLog).order_by(AuditLog.created_at.desc()).limit(100)).all()
    return [AuditLogOut.model_validate(l) for l in logs]


@router.get("/admin/health")
def admin_system_health(
    _admin: User = Depends(require_roles(UserRole.ADMIN)),
    db: Session = Depends(get_db),
):
    stations = db.scalars(select(Station).options(joinedload(Station.chargers))).unique().all()
    chargers = [c for s in stations for c in s.chargers]
    counts = {st.value: sum(1 for c in chargers if c.status == st) for st in ChargerStatus}
    alerts = scan_charger_health(db)
    return {
        "status": "healthy",
        "database": "connected",
        "station_count": len(stations),
        "charger_count": len(chargers),
        "charger_status_breakdown": counts,
        "ws_public_clients": len(ws_manager.public_connections),
        "ws_private_users": len(ws_manager.user_connections),
        "monitoring_alerts": alerts,
    }


@router.post("/admin/demo/rush-hour", dependencies=[Depends(require_csrf)])
async def admin_demo_rush_hour(
    request: Request,
    admin: User = Depends(require_roles(UserRole.ADMIN)),
    db: Session = Depends(get_db),
):
    broadcasts = simulate_rush_hour(db)
    record_audit_log(
        db,
        action="DEMO_RUSH_HOUR",
        resource_type="demo",
        user_id=admin.id,
        details={"affected_chargers": len(broadcasts)},
        ip_address=get_client_ip(request),
        correlation_id=getattr(request.state, "correlation_id", None),
    )
    db.commit()
    for b in broadcasts:
        await ws_manager.broadcast_status(b)
    return {"message": f"Simulated rush hour across {len(broadcasts)} chargers.", "updated": len(broadcasts)}


@router.post("/admin/demo/force-offline", dependencies=[Depends(require_csrf)])
async def admin_demo_force_offline(
    request: Request,
    payload: ForceOfflineBody | None = None,
    admin: User = Depends(require_roles(UserRole.ADMIN)),
    db: Session = Depends(get_db),
):
    cid = payload.charger_id if payload else None
    broadcasts, user_events = force_charger_offline_demo(db, cid)
    record_audit_log(
        db,
        action="DEMO_FORCE_OFFLINE",
        resource_type="demo",
        user_id=admin.id,
        details={"charger_id": cid},
        ip_address=get_client_ip(request),
        correlation_id=getattr(request.state, "correlation_id", None),
    )
    db.commit()
    for b in broadcasts:
        await ws_manager.broadcast_status(b)
    for uid, ev in user_events:
        await ws_manager.send_to_user(uid, ev)
    return {"message": "Forced charger offline for monitoring & re-routing demo.", "broadcasts": broadcasts}


@router.post("/admin/demo/reset", dependencies=[Depends(require_csrf)])
async def admin_demo_reset(
    request: Request,
    admin: User = Depends(require_roles(UserRole.ADMIN)),
    db: Session = Depends(get_db),
):
    from seed import seed_database
    seed_database(reset=True)
    record_audit_log(
        db,
        action="DEMO_RESET",
        resource_type="demo",
        user_id=admin.id,
        details={"reset": True},
        ip_address=get_client_ip(request),
        correlation_id=getattr(request.state, "correlation_id", None),
    )
    db.commit()
    await ws_manager.broadcast_status({"type": "full_refresh", "reason": "demo_reset"})
    return {"message": "Demo database reset to clean initial state."}
