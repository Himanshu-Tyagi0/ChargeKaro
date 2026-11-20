"""Security headers, correlation IDs, PII masking, and audit logging."""

import json
import re
import uuid
from typing import Any

from fastapi import Request
from sqlalchemy.orm import Session
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import get_settings
from app.models.audit import AuditLog

_EMAIL_RE = re.compile(r"([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*(@[A-Za-z0-9.-]+\.[A-Za-z]{2,})")
_PHONE_RE = re.compile(r"(\+?\d{2,4}[- ]?)?\d{6}(\d{4})")
_CARD_RE = re.compile(r"\b(?:\d[ -]*?){13,19}\b")


def mask_pii(value: str) -> str:
    """Mask emails, phone numbers, and card-like sequences before logging."""
    masked = _EMAIL_RE.sub(r"\1***\2", value)
    masked = _PHONE_RE.sub(r"******\2", masked)
    masked = _CARD_RE.sub("[REDACTED_NUMBER]", masked)
    return masked


def mask_dict(data: dict[str, Any]) -> dict[str, Any]:
    """Recursively mask sensitive keys and PII strings in dictionaries."""
    sensitive_keys = {"password", "password_hash", "token", "refresh_token", "card_number", "cvv", "api_key"}
    clean: dict[str, Any] = {}
    for k, v in data.items():
        if k.lower() in sensitive_keys:
            clean[k] = "[REDACTED]"
        elif isinstance(v, str):
            clean[k] = mask_pii(v)
        elif isinstance(v, dict):
            clean[k] = mask_dict(v)
        else:
            clean[k] = v
    return clean


def get_client_ip(request: Request) -> str:
    """Extract client IP safely."""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()[:64]
    if request.client:
        return (request.client.host or "unknown")[:64]
    return "unknown"


def record_audit_log(
    db: Session,
    action: str,
    resource_type: str,
    resource_id: str | int | None = None,
    user_id: int | None = None,
    details: dict[str, Any] | None = None,
    ip_address: str | None = None,
    correlation_id: str | None = None,
) -> AuditLog:
    """Persist a sanitized audit log entry."""
    safe_details = mask_dict(details or {})
    entry = AuditLog(
        user_id=user_id,
        action=action,
        resource_type=resource_type,
        resource_id=str(resource_id) if resource_id is not None else None,
        details_json=json.dumps(safe_details),
        ip_address=ip_address,
        correlation_id=correlation_id,
    )
    db.add(entry)
    return entry


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Attach correlation ID and strict HTTP security headers on every response."""

    async def dispatch(self, request: Request, call_next):
        correlation_id = request.headers.get("X-Correlation-ID") or uuid.uuid4().hex[:16]
        request.state.correlation_id = correlation_id
        response = await call_next(request)

        settings = get_settings()
        response.headers["X-Correlation-ID"] = correlation_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(self), microphone=(self)"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "img-src 'self' data: https://*.tile.openstreetmap.org https://tile.openstreetmap.org; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com; "
            "connect-src 'self' ws: wss:; "
            "frame-ancestors 'none';"
        )
        if settings.environment == "production":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response
