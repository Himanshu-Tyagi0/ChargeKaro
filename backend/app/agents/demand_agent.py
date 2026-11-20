"""Demand Prediction Agent: predicts hourly station load using booking & status history."""

from datetime import timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.models.booking import Booking
from app.models.station import Station, StatusEvent

IST_OFFSET = timedelta(hours=5, minutes=30)


def predict_station_demand(db: Session, station_id: int) -> dict[str, Any]:
    """Predict hourly demand (0..23 IST) for a station using historical bookings & status events."""
    import numpy as np
    from sklearn.linear_model import Ridge

    station = db.scalar(select(Station).options(joinedload(Station.chargers)).where(Station.id == station_id))
    if not station:
        return {"error": "Station not found"}

    charger_ids = [c.id for c in station.chargers]
    hourly_counts = np.zeros(24, dtype=float)

    if charger_ids:
        bookings = db.scalars(select(Booking).where(Booking.charger_id.in_(charger_ids))).all()
        for b in bookings:
            st = b.start_time
            if st.tzinfo is None:
                ist_hour = (st + IST_OFFSET).hour
            else:
                ist_hour = (st + IST_OFFSET).hour
            hourly_counts[ist_hour % 24] += 1.8

        events = db.scalars(select(StatusEvent).where(StatusEvent.charger_id.in_(charger_ids))).all()
        for ev in events:
            if ev.new_status.value == "OCCUPIED":
                ist_hour = (ev.created_at + IST_OFFSET).hour
                hourly_counts[ist_hour % 24] += 0.6

    # Combine historical signal with smooth Delhi urban diurnal features via Ridge regression
    hours = np.arange(24, dtype=float)
    X = np.column_stack([
        np.sin(2 * np.pi * hours / 24.0),
        np.cos(2 * np.pi * hours / 24.0),
        np.sin(4 * np.pi * hours / 24.0),
        np.cos(4 * np.pi * hours / 24.0),
        ((hours >= 9) & (hours <= 11)).astype(float),
        ((hours >= 18) & (hours <= 21)).astype(float),
    ])

    # Prior baseline curve for Delhi-NCR EV traffic + observed counts
    prior = (
        22.0
        + 26.0 * np.exp(-((hours - 10.0) ** 2) / 6.0)
        + 42.0 * np.exp(-((hours - 19.5) ** 2) / 7.5)
        + 12.0 * np.exp(-((hours - 14.0) ** 2) / 8.0)
    )
    max_obs = max(1.0, float(hourly_counts.max()))
    obs_scaled = (hourly_counts / max_obs) * 45.0 if hourly_counts.sum() > 0 else np.zeros(24)
    y_target = np.clip(prior * 0.72 + obs_scaled * 0.65, 10.0, 96.0)

    model = Ridge(alpha=1.2)
    model.fit(X, y_target)
    preds = np.clip(model.predict(X), 8.0, 98.0)

    hourly_forecast = []
    for h in range(24):
        load_pct = int(round(preds[h]))
        level = "HIGH" if load_pct >= 68 else ("MODERATE" if load_pct >= 42 else "LOW")
        hourly_forecast.append({
            "hour": h,
            "label": f"{h:02d}:00",
            "predicted_utilization_pct": load_pct,
            "level": level,
        })

    sorted_quiet = sorted([h for h in hourly_forecast if 6 <= h["hour"] <= 23], key=lambda x: x["predicted_utilization_pct"])
    sorted_busy = sorted(hourly_forecast, key=lambda x: x["predicted_utilization_pct"], reverse=True)

    best_window = sorted_quiet[0] if sorted_quiet else hourly_forecast[6]
    peak_window = sorted_busy[0]

    hint = (
        f"Best time to charge at {station.name} is around {best_window['label']} IST "
        f"(~{best_window['predicted_utilization_pct']}% predicted load). "
        f"Avoid {peak_window['label']} IST peak ({peak_window['predicted_utilization_pct']}% load)."
    )

    return {
        "station_id": station.id,
        "station_name": station.name,
        "best_hour_label": best_window["label"],
        "peak_hour_label": peak_window["label"],
        "hint": hint,
        "hourly_forecast": hourly_forecast,
    }
