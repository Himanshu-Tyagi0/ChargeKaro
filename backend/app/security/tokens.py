"""JWT access tokens, rotating refresh tokens, CSRF, and signed QR tokens."""

import hashlib
import hmac
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt

from app.core.config import get_settings


def create_access_token(user_id: int, role: str, email: str) -> str:
    """Mint a short-lived (15m) JWT access token."""
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "role": role,
        "email": email,
        "type": "access",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.access_token_expire_minutes)).timestamp()),
        "jti": uuid.uuid4().hex,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict[str, Any]:
    """Validate and decode a JWT access token."""
    settings = get_settings()
    payload = jwt.decode(
        token,
        settings.jwt_secret,
        algorithms=[settings.jwt_algorithm],
        options={"require": ["sub", "role", "exp", "type"]},
    )
    if payload.get("type") != "access":
        raise jwt.InvalidTokenError("Invalid token type")
    return payload


def generate_refresh_token() -> tuple[str, str]:
    """Return (raw_token, sha256_hash) for rotating httpOnly refresh tokens."""
    raw = secrets.token_urlsafe(48)
    token_hash = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    return raw, token_hash


def hash_token(raw_token: str) -> str:
    """Hash a raw refresh token for database lookup."""
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def create_qr_token(booking_id: int, user_id: int, charger_id: int, jti: str, valid_until: datetime) -> str:
    """Create a short-lived signed single-use QR check-in JWT."""
    settings = get_settings()
    now = datetime.now(timezone.utc)
    exp = max(valid_until, now + timedelta(minutes=30))
    payload = {
        "bid": booking_id,
        "uid": user_id,
        "cid": charger_id,
        "jti": jti,
        "type": "qr_checkin",
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
    }
    return jwt.encode(payload, settings.qr_secret, algorithm=settings.jwt_algorithm)


def decode_qr_token(token: str) -> dict[str, Any]:
    """Verify and decode a signed single-use QR check-in JWT."""
    settings = get_settings()
    payload = jwt.decode(
        token,
        settings.qr_secret,
        algorithms=[settings.jwt_algorithm],
        options={"require": ["bid", "uid", "cid", "jti", "exp", "type"]},
    )
    if payload.get("type") != "qr_checkin":
        raise jwt.InvalidTokenError("Invalid QR token type")
    return payload


def generate_csrf_token() -> str:
    """Create a double-submit CSRF token signed with HMAC."""
    settings = get_settings()
    nonce = secrets.token_hex(16)
    sig = hmac.new(settings.csrf_secret.encode("utf-8"), nonce.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{nonce}.{sig}"


def verify_csrf_token(token: str) -> bool:
    """Verify CSRF token integrity."""
    settings = get_settings()
    if not token or "." not in token:
        return False
    nonce, sig = token.split(".", 1)
    expected = hmac.new(settings.csrf_secret.encode("utf-8"), nonce.encode("utf-8"), hashlib.sha256).hexdigest()
    return hmac.compare_digest(sig, expected)
