"""Auth, User, and Vehicle Pydantic schemas."""

from datetime import datetime
from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models.enums import ConnectorType, UserRole


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RegisterRequest(StrictModel):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=120)
    password: str = Field(min_length=8, max_length=128)
    phone: str | None = Field(default=None, max_length=20)
    role: UserRole = UserRole.DRIVER


class LoginRequest(StrictModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class VehicleCreateRequest(StrictModel):
    make: str = Field(min_length=2, max_length=60)
    model: str = Field(min_length=1, max_length=80)
    registration_number: str = Field(min_length=4, max_length=24)
    connector_type: ConnectorType
    battery_capacity_kwh: float = Field(gt=5.0, le=200.0)
    current_battery_pct: int = Field(ge=1, le=100, default=40)
    range_km: int = Field(ge=40, le=1000, default=320)


class VehicleOut(BaseModel):
    id: int
    make: str
    model: str
    registration_number: str
    connector_type: ConnectorType
    battery_capacity_kwh: float
    current_battery_pct: int
    range_km: int
    is_default: bool

    model_config = ConfigDict(from_attributes=True)


class UserOut(BaseModel):
    id: int
    email: str
    full_name: str
    role: UserRole
    is_active: bool
    created_at: datetime
    vehicles: list[VehicleOut] = []

    model_config = ConfigDict(from_attributes=True)


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    csrf_token: str
    user: UserOut
