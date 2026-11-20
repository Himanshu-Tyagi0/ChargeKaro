"""Route and Range Planning Agent: straight-line corridor EV stop planner."""

from typing import Any
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.models.enums import ChargerStatus
from app.models.station import Station
from app.services.geo import (
    DELHI_CENTER,
    haversine_km,
    point_to_segment_distance_km,
    resolve_place_coords,
)


def plan_ev_route(
    db: Session,
    origin: str,
    destination: str,
    battery_pct: int = 35,
    vehicle_range_km: int = 300,
    connector_type: str | None = "CCS2",
) -> dict[str, Any]:
    """Plan charging stops along a corridor from origin to destination in Delhi-NCR."""
    orig_coords = resolve_place_coords(origin) or DELHI_CENTER
    dest_coords = resolve_place_coords(destination) or (28.4950, 77.0890)  # Cyber Hub fallback

    total_km = haversine_km(orig_coords[0], orig_coords[1], dest_coords[0], dest_coords[1])
    # Road factor ~1.25x straight-line distance in NCR
    est_road_km = round(max(2.0, total_km * 1.25), 1)
    usable_range_km = round(vehicle_range_km * (battery_pct / 100.0), 1)
    needs_stop = usable_range_km < (est_road_km + 25.0) or battery_pct < 35

    stations = db.scalars(select(Station).options(joinedload(Station.chargers))).unique().all()
    corridor_candidates: list[tuple[float, float, Station]] = []

    for st in stations:
        perp_dist, progress_t = point_to_segment_distance_km(
            st.latitude, st.longitude, orig_coords[0], orig_coords[1], dest_coords[0], dest_coords[1]
        )
        if perp_dist <= 8.0:
            corridor_candidates.append((perp_dist, progress_t, st))

    corridor_candidates.sort(key=lambda item: (item[0], item[1]))

    stops: list[dict[str, Any]] = []
    for perp_dist, progress_t, st in corridor_candidates:
        chargers = st.chargers
        if connector_type:
            compat = [c for c in chargers if c.connector_type.value.lower() == connector_type.lower()]
            if compat:
                chargers = compat
        free = [c for c in chargers if c.status == ChargerStatus.FREE]
        if not free and not chargers:
            continue
        chosen = max(free or chargers, key=lambda c: c.power_kw)
        detour_km = round(perp_dist * 1.3, 1)
        charge_mins = 20 if chosen.power_kw >= 60 else 35
        stops.append({
            "station_id": st.id,
            "station_name": st.name,
            "area": st.area,
            "latitude": st.latitude,
            "longitude": st.longitude,
            "detour_km": detour_km,
            "progress_pct": int(round(progress_t * 100)),
            "charger_id": chosen.id,
            "charger_label": chosen.label,
            "connector_type": chosen.connector_type.value,
            "power_kw": chosen.power_kw,
            "price_per_kwh": chosen.price_per_kwh,
            "status": chosen.status.value,
            "recommended_charge_minutes": charge_mins,
        })
        if len(stops) >= 2:
            break

    polyline = [list(orig_coords)]
    for s in sorted(stops, key=lambda x: x["progress_pct"]):
        polyline.append([s["latitude"], s["longitude"]])
    polyline.append(list(dest_coords))

    summary = (
        f"Route from {origin} to {destination} (~{est_road_km} km road distance). "
        f"Current battery ({battery_pct}%) gives ~{usable_range_km} km range. "
    )
    if needs_stop and stops:
        top = stops[0]
        summary += (
            f"Recommended stop: {top['station_name']} ({top['detour_km']} km off corridor, "
            f"{top['power_kw']} kW {top['connector_type']}, ~{top['recommended_charge_minutes']} min top-up)."
        )
    elif stops:
        summary += f"You have sufficient range, with {stops[0]['station_name']} available mid-route if needed."
    else:
        summary += "No corridor chargers matched; view the live map for nearest options."

    return {
        "origin": {"label": origin, "latitude": orig_coords[0], "longitude": orig_coords[1]},
        "destination": {"label": destination, "latitude": dest_coords[0], "longitude": dest_coords[1]},
        "estimated_road_km": est_road_km,
        "usable_range_km": usable_range_km,
        "needs_charging_stop": needs_stop,
        "recommended_stops": stops,
        "polyline": polyline,
        "summary": summary,
    }
