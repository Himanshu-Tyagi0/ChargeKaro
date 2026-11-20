"""Domain enums shared across ORM models and schemas."""

from enum import Enum


class UserRole(str, Enum):
    DRIVER = "driver"
    OWNER = "owner"
    ADMIN = "admin"


class ConnectorType(str, Enum):
    CCS2 = "CCS2"
    CHADEMO = "CHAdeMO"
    TYPE_2 = "Type 2"
    BHARAT_AC_001 = "Bharat AC-001"
    BHARAT_DC_001 = "Bharat DC-001"


class ChargerStatus(str, Enum):
    FREE = "FREE"
    OCCUPIED = "OCCUPIED"
    BOOKED = "BOOKED"
    OFFLINE = "OFFLINE"


class BookingStatus(str, Enum):
    PENDING_PAYMENT = "PENDING_PAYMENT"
    CONFIRMED = "CONFIRMED"
    CHECKED_IN = "CHECKED_IN"
    CHARGING = "CHARGING"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"
    NO_SHOW = "NO_SHOW"
    EXPIRED = "EXPIRED"


class SessionStatus(str, Enum):
    ACTIVE = "ACTIVE"
    COMPLETED = "COMPLETED"


class PaymentStatus(str, Enum):
    PENDING = "PENDING"
    PAID = "PAID"
    REFUNDED = "REFUNDED"


class NotificationType(str, Enum):
    INFO = "INFO"
    SUCCESS = "SUCCESS"
    WARNING = "WARNING"
    REMINDER = "REMINDER"
