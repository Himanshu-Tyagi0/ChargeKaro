"""Station, Charger, and StatusEvent ORM models."""

from datetime import datetime, timezone
from sqlalchemy import Boolean, DateTime, Enum, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.enums import ChargerStatus, ConnectorType


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Station(Base):
    __tablename__ = "stations"
    __table_args__ = (
        Index("ix_station_geo", "latitude", "longitude"),
        Index("ix_station_area", "area"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(140), nullable=False)
    area: Mapped[str] = mapped_column(String(120), nullable=False)
    address: Mapped[str] = mapped_column(String(280), nullable=False)
    city: Mapped[str] = mapped_column(String(80), default="Delhi-NCR", nullable=False)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    operator_name: Mapped[str] = mapped_column(String(100), nullable=False)
    opening_hours: Mapped[str] = mapped_column(String(80), default="24x7", nullable=False)
    is_24x7: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    amenities_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    average_rating: Mapped[float] = mapped_column(Float, default=4.5, nullable=False)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    owner: Mapped["User"] = relationship(back_populates="stations")
    chargers: Mapped[list["Charger"]] = relationship(
        back_populates="station", cascade="all, delete-orphan", order_by="Charger.id"
    )


class Charger(Base):
    __tablename__ = "chargers"
    __table_args__ = (
        Index("ix_charger_station_status", "station_id", "status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    station_id: Mapped[int] = mapped_column(ForeignKey("stations.id", ondelete="CASCADE"), index=True, nullable=False)
    label: Mapped[str] = mapped_column(String(60), nullable=False)
    connector_type: Mapped[ConnectorType] = mapped_column(Enum(ConnectorType), nullable=False)
    power_kw: Mapped[float] = mapped_column(Float, nullable=False)
    price_per_kwh: Mapped[float] = mapped_column(Float, nullable=False)
    status: Mapped[ChargerStatus] = mapped_column(Enum(ChargerStatus), default=ChargerStatus.FREE, nullable=False)
    last_updated: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    flap_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    station: Mapped["Station"] = relationship(back_populates="chargers")
    bookings: Mapped[list["Booking"]] = relationship(back_populates="charger")
    status_events: Mapped[list["StatusEvent"]] = relationship(
        back_populates="charger", cascade="all, delete-orphan"
    )


class StatusEvent(Base):
    __tablename__ = "status_events"
    __table_args__ = (
        Index("ix_status_event_charger_time", "charger_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    charger_id: Mapped[int] = mapped_column(ForeignKey("chargers.id", ondelete="CASCADE"), nullable=False)
    previous_status: Mapped[ChargerStatus] = mapped_column(Enum(ChargerStatus), nullable=False)
    new_status: Mapped[ChargerStatus] = mapped_column(Enum(ChargerStatus), nullable=False)
    source: Mapped[str] = mapped_column(String(40), default="SIMULATOR", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    charger: Mapped["Charger"] = relationship(back_populates="status_events")
