"""Recommendation Agent: ranks stations and chargers with plain-language explanations."""

from typing import Any
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.models.enums import ChargerStatus
from app.models.station import Station
from app.services.geo import DELHI_CENTER, haversine_km


def recommend_chargers(
    db: Session,
    user_lat: float | None = None,
    user_lng: float | None = None,
    battery_pct: int = 35,
    connector_type: str | None = None,
    urgency: str = "normal",
    max_price_inr: float | None = None,
    min_power_kw: float | None = None,
    area_query: str | None = None,
    sort_preference: str = "balanced",
    limit: int = 4,
) -> list[dict[str, Any]]:
    """Rank stations and best matching chargers based on distance, availability, speed, and price."""
    lat = user_lat if user_lat is not None else DELHI_CENTER[0]
    lng = user_lng if user_lng is not None else DELHI_CENTER[1]

    stations = db.scalars(select(Station).options(joinedload(Station.chargers))).unique().all()
    if area_query:
        q = area_query.strip().lower()
        filtered = [s for s in stations if q in s.area.lower() or q in s.name.lower() or q in s.address.lower()]
        if filtered:
            stations = filtered

    scored: list[tuple[float, dict[str, Any]]] = []
    for st in stations:
        dist = haversine_km(lat, lng, st.latitude, st.longitude)
        chargers = st.chargers
        if connector_type:
            matching = [c for c in chargers if c.connector_type.value.lower() == connector_type.lower()]
            if matching:
                chargers = matching
        if max_price_inr is not None:
            matching = [c for c in chargers if c.price_per_kwh <= max_price_inr]
            if not matching:
                continue
            chargers = matching
        if min_power_kw is not None:
            matching = [c for c in chargers if c.power_kw >= min_power_kw]
            if not matching:
                continue
            chargers = matching

        if not chargers:
            continue

        free_chargers = [c for c in chargers if c.status == ChargerStatus.FREE]
        best_charger = max(
            free_chargers or chargers,
            key=lambda c: (
                1 if c.status == ChargerStatus.FREE else 0,
                c.power_kw if urgency == "high" or battery_pct < 25 else -c.price_per_kwh,
                c.power_kw,
            ),
        )

        # Scoring (higher is better)
        avail_bonus = 45.0 if best_charger.status == ChargerStatus.FREE else (-25.0 if best_charger.status == ChargerStatus.OFFLINE else 0.0)
        dist_score = max(0.0, 35.0 - dist * 2.2)
        speed_weight = 0.45 if (urgency == "high" or battery_pct < 25 or sort_preference == "fastest") else 0.20
        price_weight = 2.4 if sort_preference == "cheapest" else 1.2
        speed_score = min(30.0, best_charger.power_kw * speed_weight)
        price_score = max(0.0, (28.0 - best_charger.price_per_kwh) * price_weight)
        rating_score = st.average_rating * 2.0

        total_score = avail_bonus + dist_score + speed_score + price_score + rating_score

        reasons: list[str] = []
        if best_charger.status == ChargerStatus.FREE:
            reasons.append(f"{len(free_chargers)} charger(s) free right now")
        else:
            reasons.append(f"Best charger currently {best_charger.status.value.lower()}")
        reasons.append(f"{dist:.1f} km away")
        reasons.append(f"{best_charger.power_kw:.0f} kW {best_charger.connector_type.value}")
        reasons.append(f"Rs {best_charger.price_per_kwh:.0f}/kWh")
        if battery_pct < 25 and best_charger.power_kw >= 50:
            reasons.append("high-speed DC ideal for low battery")

        scored.append(
            (
                total_score,
                {
                    "station_id": st.id,
                    "station_name": st.name,
                    "area": st.area,
                    "latitude": st.latitude,
                    "longitude": st.longitude,
                    "distance_km": dist,
                    "free_chargers": len(free_chargers),
                    "total_chargers": len(st.chargers),
                    "best_charger_id": best_charger.id,
                    "best_charger_label": best_charger.label,
                    "connector_type": best_charger.connector_type.value,
                    "power_kw": best_charger.power_kw,
                    "price_per_kwh": best_charger.price_per_kwh,
                    "status": best_charger.status.value,
                    "score": round(total_score, 1),
                    "why": " · ".join(reasons),
                },
            )
        )

    scored.sort(key=lambda item: item[0], reverse=True)
    return [item[1] for item in scored[:limit]]
