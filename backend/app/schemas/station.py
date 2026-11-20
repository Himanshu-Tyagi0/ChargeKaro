"""Station and Charger Pydantic schemas."""

from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import ChargerStatus, ConnectorType


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ChargerOut(BaseModel):
    id: int
    station_id: int
    label: str
    connector_type: ConnectorType
    power_kw: float
    price_per_kwh: float
    status: ChargerStatus
    last_updated: datetime
    flap_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class StationOut(BaseModel):
    id: int
    owner_id: int
    name: str
    area: str
    address: str
    city: str
    latitude: float
    longitude: float
    operator_name: str
    opening_hours: str
    is_24x7: bool
    amenities: list[str]
    average_rating: float
    is_demo: bool
    distance_km: float | None = None
    free_chargers: int = 0
    total_chargers: int = 0
    min_price_per_kwh: float = 0.0
    max_power_kw: float = 0.0
    chargers: list[ChargerOut] = []


class StationCreateRequest(StrictModel):
    name: str = Field(min_length=3, max_length=140)
    area: str = Field(min_length=2, max_length=120)
    address: str = Field(min_length=5, max_length=280)
    latitude: float = Field(ge=-90.0, le=90.0)
    longitude: float = Field(ge=-180.0, le=180.0)
    operator_name: str = Field(min_length=2, max_length=100)
    opening_hours: str = Field(default="24x7", max_length=80)
    is_24x7: bool = True
    amenities: list[str] = Field(default_factory=list, max_length=10)


class StationUpdateRequest(StrictModel):
    name: str | None = Field(default=None, min_length=3, max_length=140)
    area: str | None = Field(default=None, min_length=2, max_length=120)
    address: str | None = Field(default=None, min_length=5, max_length=280)
    opening_hours: str | None = Field(default=None, max_length=80)
    is_24x7: bool | None = None
    amenities: list[str] | None = Field(default=None, max_length=10)


class ChargerCreateRequest(StrictModel):
    label: str = Field(min_length=2, max_length=60)
    connector_type: ConnectorType
    power_kw: float = Field(ge=1.0, le=500.0)
    price_per_kwh: float = Field(ge=5.0, le=100.0)


class ChargerUpdateRequest(StrictModel):
    label: str | None = Field(default=None, min_length=2, max_length=60)
    power_kw: float | None = Field(default=None, ge=1.0, le=500.0)
    price_per_kwh: float | None = Field(default=None, ge=5.0, le=100.0)
    status: ChargerStatus | None = None
