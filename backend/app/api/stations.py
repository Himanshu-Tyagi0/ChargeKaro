"""Stations and Chargers discovery & management routes (/api/v1/stations)."""

import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.core.database import get_db
from app.models.enums import ChargerStatus, UserRole
from app.models.station import Charger, Station, StatusEvent
from app.models.user import User
from app.schemas.station import (
    ChargerCreateRequest,
    ChargerOut,
    ChargerUpdateRequest,
    StationCreateRequest,
    StationOut,
    StationUpdateRequest,
)
from app.security.deps import require_csrf, require_roles
from app.security.middleware import get_client_ip, record_audit_log
from app.services.geo import DELHI_CENTER, haversine_km
from app.services.simulator import handle_charger_offline_impact
from app.services.websocket_manager import ws_manager

router = APIRouter(tags=["stations"])


def serialize_station(st: Station, user_lat: float, user_lng: float) -> StationOut:
    amenities = json.loads(st.amenities_json) if st.amenities_json else []
    free_count = sum(1 for c in st.chargers if c.status == ChargerStatus.FREE)
    min_price = min((c.price_per_kwh for c in st.chargers), default=0.0)
    max_power = max((c.power_kw for c in st.chargers), default=0.0)
    return StationOut(
        id=st.id,
        owner_id=st.owner_id,
        name=st.name,
        area=st.area,
        address=st.address,
        city=st.city,
        latitude=st.latitude,
        longitude=st.longitude,
        operator_name=st.operator_name,
        opening_hours=st.opening_hours,
        is_24x7=st.is_24x7,
        amenities=amenities,
        average_rating=st.average_rating,
        is_demo=st.is_demo,
        distance_km=haversine_km(user_lat, user_lng, st.latitude, st.longitude),
        free_chargers=free_count,
        total_chargers=len(st.chargers),
        min_price_per_kwh=min_price,
        max_power_kw=max_power,
        chargers=[ChargerOut.model_validate(c) for c in st.chargers],
    )


@router.get("/stations", response_model=list[StationOut])
def list_stations(
    area: str | None = Query(default=None, max_length=100),
    connector_type: str | None = Query(default=None, max_length=40),
    min_power: float | None = Query(default=None, ge=0, le=500),
    max_price: float | None = Query(default=None, ge=0, le=100),
    only_available: bool = Query(default=False),
    amenity: str | None = Query(default=None, max_length=40),
    max_distance_km: float | None = Query(default=None, gt=0, le=200),
    lat: float = Query(default=DELHI_CENTER[0], ge=-90, le=90),
    lng: float = Query(default=DELHI_CENTER[1], ge=-180, le=180),
    bbox: str | None = Query(default=None, description="min_lat,min_lng,max_lat,max_lng"),
    sort: str = Query(default="nearest", pattern="^(nearest|cheapest|fastest)$"),
    db: Session = Depends(get_db),
):
    stations = db.scalars(select(Station).options(joinedload(Station.chargers))).unique().all()

    bbox_vals: tuple[float, float, float, float] | None = None
    if bbox:
        try:
            parts = [float(p.strip()) for p in bbox.split(",")]
            if len(parts) == 4:
                bbox_vals = (parts[0], parts[1], parts[2], parts[3])
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid bbox format")

    results: list[StationOut] = []
    for st in stations:
        if bbox_vals:
            min_lat, min_lng, max_lat, max_lng = bbox_vals
            if not (min_lat <= st.latitude <= max_lat and min_lng <= st.longitude <= max_lng):
                continue

        if area:
            q = area.strip().lower()
            if q not in st.area.lower() and q not in st.name.lower() and q not in st.address.lower():
                continue

        amenities_list = json.loads(st.amenities_json) if st.amenities_json else []
        if amenity:
            if not any(amenity.strip().lower() in a.lower() for a in amenities_list):
                continue

        chargers = st.chargers
        if connector_type:
            if not any(c.connector_type.value.lower() == connector_type.strip().lower() for c in chargers):
                continue
        if min_power is not None:
            if not any(c.power_kw >= min_power for c in chargers):
                continue
        if max_price is not None:
            if not any(c.price_per_kwh <= max_price for c in chargers):
                continue
        if only_available:
            if not any(c.status == ChargerStatus.FREE for c in chargers):
                continue

        out = serialize_station(st, lat, lng)
        if max_distance_km is not None and (out.distance_km or 0) > max_distance_km:
            continue
        results.append(out)

    if sort == "nearest":
        results.sort(key=lambda s: s.distance_km or 0.0)
    elif sort == "cheapest":
        results.sort(key=lambda s: s.min_price_per_kwh or 999.0)
    elif sort == "fastest":
        results.sort(key=lambda s: s.max_power_kw or 0.0, reverse=True)

    return results


@router.get("/stations/{station_id}", response_model=StationOut)
def get_station_detail(
    station_id: int,
    lat: float = Query(default=DELHI_CENTER[0], ge=-90, le=90),
    lng: float = Query(default=DELHI_CENTER[1], ge=-180, le=180),
    db: Session = Depends(get_db),
):
    st = db.scalar(select(Station).options(joinedload(Station.chargers)).where(Station.id == station_id))
    if not st:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Station not found")
    return serialize_station(st, lat, lng)


@router.post("/stations", response_model=StationOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_csrf)])
def create_station(
    request: Request,
    payload: StationCreateRequest,
    user: User = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
    db: Session = Depends(get_db),
):
    st = Station(
        owner_id=user.id,
        name=payload.name.strip(),
        area=payload.area.strip(),
        address=payload.address.strip(),
        latitude=payload.latitude,
        longitude=payload.longitude,
        operator_name=payload.operator_name.strip(),
        opening_hours=payload.opening_hours.strip(),
        is_24x7=payload.is_24x7,
        amenities_json=json.dumps(payload.amenities),
        is_demo=True,
    )
    db.add(st)
    db.flush()
    record_audit_log(
        db,
        action="STATION_CREATED",
        resource_type="station",
        resource_id=st.id,
        user_id=user.id,
        details={"name": st.name, "area": st.area},
        ip_address=get_client_ip(request),
        correlation_id=getattr(request.state, "correlation_id", None),
    )
    db.commit()
    st_loaded = db.scalar(select(Station).options(joinedload(Station.chargers)).where(Station.id == st.id))
    return serialize_station(st_loaded, DELHI_CENTER[0], DELHI_CENTER[1])


@router.patch("/stations/{station_id}", response_model=StationOut, dependencies=[Depends(require_csrf)])
def update_station(
    station_id: int,
    request: Request,
    payload: StationUpdateRequest,
    user: User = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
    db: Session = Depends(get_db),
):
    st = db.scalar(select(Station).options(joinedload(Station.chargers)).where(Station.id == station_id))
    if not st:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Station not found")
    if user.role != UserRole.ADMIN and st.owner_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only modify your own stations")

    if payload.name is not None:
        st.name = payload.name.strip()
    if payload.area is not None:
        st.area = payload.area.strip()
    if payload.address is not None:
        st.address = payload.address.strip()
    if payload.opening_hours is not None:
        st.opening_hours = payload.opening_hours.strip()
    if payload.is_24x7 is not None:
        st.is_24x7 = payload.is_24x7
    if payload.amenities is not None:
        st.amenities_json = json.dumps(payload.amenities)

    record_audit_log(
        db,
        action="STATION_UPDATED",
        resource_type="station",
        resource_id=st.id,
        user_id=user.id,
        details=payload.model_dump(exclude_none=True),
        ip_address=get_client_ip(request),
        correlation_id=getattr(request.state, "correlation_id", None),
    )
    db.commit()
    db.refresh(st)
    return serialize_station(st, DELHI_CENTER[0], DELHI_CENTER[1])


@router.get("/stations/{station_id}/chargers", response_model=list[ChargerOut])
def list_station_chargers(station_id: int, db: Session = Depends(get_db)):
    st = db.get(Station, station_id)
    if not st:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Station not found")
    chargers = db.scalars(select(Charger).where(Charger.station_id == station_id).order_by(Charger.id)).all()
    return [ChargerOut.model_validate(c) for c in chargers]


@router.post("/stations/{station_id}/chargers", response_model=ChargerOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_csrf)])
def add_charger(
    station_id: int,
    request: Request,
    payload: ChargerCreateRequest,
    user: User = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
    db: Session = Depends(get_db),
):
    st = db.get(Station, station_id)
    if not st:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Station not found")
    if user.role != UserRole.ADMIN and st.owner_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only add chargers to your own stations")

    c = Charger(
        station_id=station_id,
        label=payload.label.strip(),
        connector_type=payload.connector_type,
        power_kw=payload.power_kw,
        price_per_kwh=payload.price_per_kwh,
        status=ChargerStatus.FREE,
    )
    db.add(c)
    db.flush()
    record_audit_log(
        db,
        action="CHARGER_ADDED",
        resource_type="charger",
        resource_id=c.id,
        user_id=user.id,
        details={"station_id": station_id, "label": c.label},
        ip_address=get_client_ip(request),
        correlation_id=getattr(request.state, "correlation_id", None),
    )
    db.commit()
    db.refresh(c)
    return ChargerOut.model_validate(c)


@router.patch("/chargers/{charger_id}", response_model=ChargerOut, dependencies=[Depends(require_csrf)])
async def update_charger(
    charger_id: int,
    request: Request,
    payload: ChargerUpdateRequest,
    user: User = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
    db: Session = Depends(get_db),
):
    c = db.scalar(select(Charger).options(joinedload(Charger.station)).where(Charger.id == charger_id))
    if not c:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Charger not found")
    if user.role != UserRole.ADMIN and c.station.owner_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only update chargers at your own stations")

    now_utc = datetime.now(timezone.utc)
    status_changed = False
    prev_status = c.status
    user_events = []

    if payload.label is not None:
        c.label = payload.label.strip()
    if payload.power_kw is not None:
        c.power_kw = payload.power_kw
    if payload.price_per_kwh is not None:
        c.price_per_kwh = payload.price_per_kwh
    if payload.status is not None and payload.status != c.status:
        c.status = payload.status
        c.last_updated = now_utc
        status_changed = True
        db.add(
            StatusEvent(
                charger_id=c.id,
                previous_status=prev_status,
                new_status=payload.status,
                source=f"OWNER:{user.id}",
            )
        )
        if payload.status == ChargerStatus.OFFLINE:
            user_events = handle_charger_offline_impact(db, c)

    record_audit_log(
        db,
        action="CHARGER_OVERRIDE",
        resource_type="charger",
        resource_id=c.id,
        user_id=user.id,
        details=payload.model_dump(exclude_none=True, mode="json"),
        ip_address=get_client_ip(request),
        correlation_id=getattr(request.state, "correlation_id", None),
    )
    db.commit()
    db.refresh(c)

    if status_changed:
        await ws_manager.broadcast_status({
            "type": "charger_status",
            "station_id": c.station_id,
            "station_name": c.station.name,
            "charger_id": c.id,
            "charger_label": c.label,
            "previous_status": prev_status.value,
            "status": c.status.value,
            "last_updated": now_utc.isoformat(),
        })
        for uid, ev in user_events:
            await ws_manager.send_to_user(uid, ev)

    return ChargerOut.model_validate(c)
