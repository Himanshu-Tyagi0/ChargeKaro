"""Booking, ChargingSession, and Payment ORM models."""

from datetime import datetime, timezone
from sqlalchemy import Boolean, DateTime, Enum, Float, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.enums import BookingStatus, PaymentStatus, SessionStatus


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Booking(Base):
    __tablename__ = "bookings"
    __table_args__ = (
        Index("ix_booking_charger_window", "charger_id", "start_time", "end_time"),
        Index("ix_booking_user_status", "user_id", "status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    charger_id: Mapped[int] = mapped_column(ForeignKey("chargers.id", ondelete="CASCADE"), nullable=False)
    vehicle_id: Mapped[int | None] = mapped_column(ForeignKey("vehicles.id", ondelete="SET NULL"), nullable=True)

    start_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False)

    status: Mapped[BookingStatus] = mapped_column(
        Enum(BookingStatus), default=BookingStatus.PENDING_PAYMENT, nullable=False
    )
    estimated_cost_inr: Mapped[float] = mapped_column(Float, nullable=False)
    cancellation_fee_inr: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)

    idempotency_key: Mapped[str | None] = mapped_column(String(80), unique=True, nullable=True)
    qr_token_jti: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    qr_used: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    connector_warning: Mapped[str | None] = mapped_column(String(200), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    user: Mapped["User"] = relationship(back_populates="bookings")
    charger: Mapped["Charger"] = relationship(back_populates="bookings")
    vehicle: Mapped["Vehicle | None"] = relationship()
    session: Mapped["ChargingSession | None"] = relationship(back_populates="booking", uselist=False)
    payments: Mapped[list["Payment"]] = relationship(back_populates="booking", cascade="all, delete-orphan")


class ChargingSession(Base):
    __tablename__ = "charging_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    booking_id: Mapped[int] = mapped_column(ForeignKey("bookings.id", ondelete="CASCADE"), unique=True, nullable=False)
    charger_id: Mapped[int] = mapped_column(ForeignKey("chargers.id", ondelete="CASCADE"), index=True, nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)

    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    initial_battery_pct: Mapped[int] = mapped_column(Integer, default=28, nullable=False)
    current_battery_pct: Mapped[float] = mapped_column(Float, default=28.0, nullable=False)
    target_battery_pct: Mapped[int] = mapped_column(Integer, default=85, nullable=False)
    kwh_delivered: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    total_cost_inr: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    status: Mapped[SessionStatus] = mapped_column(Enum(SessionStatus), default=SessionStatus.ACTIVE, nullable=False)

    booking: Mapped["Booking"] = relationship(back_populates="session")


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    booking_id: Mapped[int] = mapped_column(ForeignKey("bookings.id", ondelete="CASCADE"), index=True, nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    amount_inr: Mapped[float] = mapped_column(Float, nullable=False)
    method: Mapped[str] = mapped_column(String(40), default="MOCK_UPI", nullable=False)
    reference_id: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[PaymentStatus] = mapped_column(Enum(PaymentStatus), default=PaymentStatus.PAID, nullable=False)
    idempotency_key: Mapped[str | None] = mapped_column(String(80), unique=True, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    booking: Mapped["Booking"] = relationship(back_populates="payments")
