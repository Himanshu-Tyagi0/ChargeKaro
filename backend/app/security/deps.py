"""Authentication, RBAC, CSRF verification, and rate limiting dependencies."""

from typing import Callable

import jwt
from fastapi import Cookie, Depends, Header, HTTPException, Request, status
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.enums import UserRole
from app.models.user import User
from app.security.tokens import decode_access_token, verify_csrf_token


def _rate_limit_key(request: Request) -> str:
    """Rate limit by authenticated user hint + forwarded client IP address."""
    forwarded = request.headers.get("X-Forwarded-For", "")
    ip = forwarded.split(",")[0].strip() if forwarded else get_remote_address(request)
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        try:
            payload = decode_access_token(auth.split(" ", 1)[1].strip())
            return f"user:{payload.get('sub')}:{ip}"
        except Exception:
            pass
    return f"ip:{ip}"


limiter = Limiter(key_func=_rate_limit_key, default_limits=["180/minute"])


def _extract_token(request: Request, authorization: str | None, access_cookie: str | None) -> str | None:
    if authorization and authorization.startswith("Bearer "):
        return authorization.split(" ", 1)[1].strip()
    if access_cookie:
        return access_cookie.strip()
    return None


def get_optional_user(
    request: Request,
    authorization: str | None = Header(default=None),
    ck_access: str | None = Cookie(default=None),
    db: Session = Depends(get_db),
) -> User | None:
    """Return the authenticated User if a valid access token exists, else None."""
    token = _extract_token(request, authorization, ck_access)
    if not token:
        return None
    try:
        payload = decode_access_token(token)
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, ValueError, KeyError):
        return None
    user = db.get(User, user_id)
    if not user or not user.is_active:
        return None
    return user


def get_current_user(
    request: Request,
    authorization: str | None = Header(default=None),
    ck_access: str | None = Cookie(default=None),
    db: Session = Depends(get_db),
) -> User:
    """Require a valid JWT access token and return the active User."""
    token = _extract_token(request, authorization, ck_access)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    try:
        payload = decode_access_token(token)
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, ValueError, KeyError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired access token")

    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account is inactive or not found")
    return user


def require_roles(*roles: UserRole) -> Callable:
    """Enforce backend Role-Based Access Control (RBAC)."""
    allowed = {r.value for r in roles}

    def _checker(user: User = Depends(get_current_user)) -> User:
        if user.role.value not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions for this operation",
            )
        return user

    return _checker


def require_csrf(
    request: Request,
    ck_csrf: str | None = Cookie(default=None),
    x_csrf_token: str | None = Header(default=None),
) -> None:
    """Double-submit CSRF protection for cookie-authenticated mutating requests.

    When a request authenticates via httpOnly cookies without an explicit
    Authorization Bearer header, require matching signed CSRF cookie + header.
    """
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        # If CSRF header is provided anyway, validate it; otherwise Bearer tokens are immune to CSRF
        if x_csrf_token and ck_csrf and (x_csrf_token != ck_csrf or not verify_csrf_token(x_csrf_token)):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid CSRF token")
        return

    # Cookie-only state-changing request
    if request.cookies.get("ck_access") or request.cookies.get("ck_refresh"):
        if not ck_csrf or not x_csrf_token or ck_csrf != x_csrf_token or not verify_csrf_token(x_csrf_token):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="CSRF validation failed")
