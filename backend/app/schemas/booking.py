"""Booking, ChargingSession, and Payment Pydantic schemas."""

from datetime import datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import BookingStatus, ConnectorType, SessionStatus


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TimeSlotOut(BaseModel):
    start_time: datetime
    end_time: datetime
    label: str
    available: bool
    reason: str | None = None


class AvailabilityOut(BaseModel):
    charger_id: int
    date: str
    slots: list[TimeSlotOut]


class BookingCreateRequest(StrictModel):
    charger_id: int = Field(gt=0)
    vehicle_id: int | None = Field(default=None, gt=0)
    start_time: datetime
    duration_minutes: Literal[30, 60, 90] = 30
    payment_method: Literal["MOCK_UPI", "MOCK_CARD"] = "MOCK_UPI"
    upi_id: str | None = Field(default=None, max_length=80)
    idempotency_key: str | None = Field(default=None, min_length=6, max_length=80)


class BookingRescheduleRequest(StrictModel):
    new_start_time: datetime
    duration_minutes: Literal[30, 60, 90] | None = None


class CheckInRequest(StrictModel):
    qr_token: str | None = Field(default=None, max_length=1024)
    simulate_scan: bool = False


class BookingOut(BaseModel):
    id: int
    user_id: int
    charger_id: int
    station_id: int
    station_name: str
    station_area: str
    charger_label: str
    connector_type: ConnectorType
    power_kw: float
    price_per_kwh: float
    vehicle_id: int | None = None
    vehicle_name: str | None = None
    start_time: datetime
    end_time: datetime
    duration_minutes: int
    status: BookingStatus
    estimated_cost_inr: float
    cancellation_fee_inr: float
    connector_warning: str | None = None
    qr_token: str | None = None
    qr_used: bool
    session_id: int | None = None
    created_at: datetime


class SessionOut(BaseModel):
    id: int
    booking_id: int
    charger_id: int
    station_id: int
    station_name: str
    charger_label: str
    power_kw: float
    price_per_kwh: float
    started_at: datetime
    ended_at: datetime | None
    initial_battery_pct: int
    current_battery_pct: float
    target_battery_pct: int
    kwh_delivered: float
    total_cost_inr: float
    estimated_minutes_remaining: int
    status: SessionStatus


class InvoiceOut(BaseModel):
    invoice_number: str
    booking_id: int
    session_id: int
    driver_name: str
    station_name: str
    station_address: str
    charger_label: str
    connector_type: ConnectorType
    power_kw: float
    started_at: datetime
    ended_at: datetime
    kwh_delivered: float
    rate_per_kwh_inr: float
    energy_charge_inr: float
    platform_fee_inr: float
    gst_inr: float
    total_paid_inr: float
    payment_method: str
    payment_reference: str
    is_demo: bool = True
