"""Monitoring Agent: detects flapping chargers and prolonged offline units."""

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.models.enums import ChargerStatus
from app.models.station import Charger, StatusEvent


def scan_charger_health(db: Session, owner_id: int | None = None) -> list[dict[str, Any]]:
    """Detect chargers that are offline too long or flapping frequently."""
    now_utc = datetime.now(timezone.utc)
    since = now_utc - timedelta(hours=2)

    stmt = select(Charger).options(joinedload(Charger.station))
    chargers = db.scalars(stmt).all()
    if owner_id is not None:
        chargers = [c for c in chargers if c.station.owner_id == owner_id]

    alerts: list[dict[str, Any]] = []
    for c in chargers:
        recent_events = db.scalars(
            select(StatusEvent).where(StatusEvent.charger_id == c.id, StatusEvent.created_at >= since)
        ).all()
        offline_hits = sum(1 for e in recent_events if e.new_status == ChargerStatus.OFFLINE)

        last_upd = c.last_updated
        if last_upd.tzinfo is None:
            last_upd = last_upd.replace(tzinfo=timezone.utc)
        mins_since_update = int((now_utc - last_upd).total_seconds() / 60.0)

        if c.status == ChargerStatus.OFFLINE:
            alerts.append({
                "severity": "HIGH" if mins_since_update >= 10 else "MEDIUM",
                "charger_id": c.id,
                "charger_label": c.label,
                "station_id": c.station_id,
                "station_name": c.station.name,
                "issue": "OFFLINE",
                "message": f"{c.label} at {c.station.name} is OFFLINE ({mins_since_update}m since last status change).",
                "flap_count": c.flap_count,
            })
        elif c.flap_count >= 5 or offline_hits >= 2:
            alerts.append({
                "severity": "MEDIUM",
                "charger_id": c.id,
                "charger_label": c.label,
                "station_id": c.station_id,
                "station_name": c.station.name,
                "issue": "FLAPPING",
                "message": f"{c.label} at {c.station.name} shows unstable telemetry ({c.flap_count} transitions).",
                "flap_count": c.flap_count,
            })

    return alerts
