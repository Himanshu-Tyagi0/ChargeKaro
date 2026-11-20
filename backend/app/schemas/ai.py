"""AI Assistant, Agent Activity, Demand, Route, and Admin schemas."""

from datetime import datetime
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ChatMessage(StrictModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=1000)


class AIChatRequest(StrictModel):
    message: str = Field(min_length=1, max_length=600)
    language: Literal["en-IN", "hi-IN"] = "en-IN"
    user_lat: float | None = Field(default=28.6315, ge=-90.0, le=90.0)
    user_lng: float | None = Field(default=77.2167, ge=-180.0, le=180.0)
    battery_pct: int | None = Field(default=35, ge=1, le=100)
    confirm_action_id: str | None = Field(default=None, max_length=80)
    history: list[ChatMessage] = Field(default_factory=list, max_length=12)


class RecommendRequest(StrictModel):
    user_lat: float = Field(default=28.6315, ge=-90.0, le=90.0)
    user_lng: float = Field(default=77.2167, ge=-180.0, le=180.0)
    battery_pct: int = Field(default=30, ge=1, le=100)
    connector_type: str | None = Field(default=None, max_length=40)
    urgency: Literal["low", "normal", "high"] = "normal"
    max_price_inr: float | None = Field(default=None, ge=5.0, le=100.0)


class RoutePlanRequest(StrictModel):
    origin: str = Field(min_length=2, max_length=120)
    destination: str = Field(min_length=2, max_length=120)
    battery_pct: int = Field(default=35, ge=1, le=100)
    vehicle_range_km: int = Field(default=300, ge=60, le=800)
    connector_type: str | None = Field(default="CCS2", max_length=40)


class ToolCallTrace(BaseModel):
    tool_name: str
    arguments: dict[str, Any]
    status: str
    summary: str


class PendingConfirmation(BaseModel):
    action_id: str
    action_type: str
    summary: str
    details: dict[str, Any]


class AIChatResponse(BaseModel):
    reply: str
    speak_text: str
    agent_used: str
    provider: str
    tool_calls: list[ToolCallTrace] = []
    recommendations: list[dict[str, Any]] = []
    route_plan: dict[str, Any] | None = None
    pending_action: PendingConfirmation | None = None
    executed_booking: dict[str, Any] | None = None


class NotificationOut(BaseModel):
    id: int
    title: str
    message: str
    type: str
    is_read: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AuditLogOut(BaseModel):
    id: int
    user_id: int | None
    action: str
    resource_type: str
    resource_id: str | None
    details_json: str
    ip_address: str | None
    correlation_id: str | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
