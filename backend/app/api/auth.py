"""Authentication, vehicle, and notification routes (/api/v1/auth)."""

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.core.config import get_settings
from app.core.database import get_db
from app.models.audit import Notification
from app.models.enums import UserRole
from app.models.user import RefreshToken, User, Vehicle
from app.schemas.ai import NotificationOut
from app.schemas.auth import AuthResponse, LoginRequest, RegisterRequest, UserOut, VehicleCreateRequest, VehicleOut
from app.security.deps import get_current_user, limiter, require_csrf
from app.security.middleware import get_client_ip, record_audit_log
from app.security.passwords import hash_password, validate_password_strength, verify_password
from app.security.tokens import create_access_token, generate_csrf_token, generate_refresh_token, hash_token

router = APIRouter(prefix="/auth", tags=["auth"])


def _is_https_request(request: Request | None) -> bool:
    if not request:
        return False
    proto = request.headers.get("x-forwarded-proto", "").lower()
    origin = request.headers.get("origin", "").lower()
    return proto == "https" or request.url.scheme == "https" or origin.startswith("https://")


def _set_auth_cookies(
    response: Response,
    access_token: str,
    refresh_raw: str,
    csrf_token: str,
    request: Request | None = None,
) -> None:
    settings = get_settings()
    is_https = _is_https_request(request) or settings.environment == "production"
    samesite_val = "none" if is_https else "lax"
    response.set_cookie(
        key="ck_access",
        value=access_token,
        httponly=True,
        secure=is_https,
        samesite=samesite_val,
        max_age=settings.access_token_expire_minutes * 60,
        path="/",
    )
    response.set_cookie(
        key="ck_refresh",
        value=refresh_raw,
        httponly=True,
        secure=is_https,
        samesite=samesite_val,
        max_age=settings.refresh_token_expire_days * 86400,
        path="/api/v1/auth",
    )
    response.set_cookie(
        key="ck_csrf",
        value=csrf_token,
        httponly=False,
        secure=is_https,
        samesite=samesite_val,
        max_age=settings.refresh_token_expire_days * 86400,
        path="/",
    )


def _clear_auth_cookies(response: Response) -> None:
    response.delete_cookie("ck_access", path="/")
    response.delete_cookie("ck_refresh", path="/api/v1/auth")
    response.delete_cookie("ck_csrf", path="/")


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("10/minute")
def register(
    request: Request,
    payload: RegisterRequest,
    response: Response,
    db: Session = Depends(get_db),
):
    ok, msg = validate_password_strength(payload.password)
    if not ok:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=msg)

    # Prevent self-assigning admin role via public registration
    assigned_role = payload.role if payload.role in {UserRole.DRIVER, UserRole.OWNER} else UserRole.DRIVER

    existing = db.scalar(select(User).where(User.email == payload.email.lower()))
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="An account with this email already exists")

    user = User(
        email=payload.email.lower(),
        full_name=payload.full_name.strip(),
        phone=payload.phone,
        password_hash=hash_password(payload.password),
        role=assigned_role,
    )
    db.add(user)
    db.flush()

    refresh_raw, refresh_hash = generate_refresh_token()
    settings = get_settings()
    db.add(
        RefreshToken(
            user_id=user.id,
            token_hash=refresh_hash,
            family_id=uuid.uuid4().hex,
            expires_at=datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days),
        )
    )
    record_audit_log(
        db,
        action="USER_REGISTERED",
        resource_type="user",
        resource_id=user.id,
        user_id=user.id,
        details={"email": user.email, "role": assigned_role.value},
        ip_address=get_client_ip(request),
        correlation_id=getattr(request.state, "correlation_id", None),
    )
    db.commit()

    user_loaded = db.scalar(select(User).options(joinedload(User.vehicles)).where(User.id == user.id))
    access = create_access_token(user.id, user.role.value, user.email)
    csrf = generate_csrf_token()
    _set_auth_cookies(response, access, refresh_raw, csrf, request)
    return AuthResponse(access_token=access, csrf_token=csrf, user=UserOut.model_validate(user_loaded))


@router.post("/login", response_model=AuthResponse)
@limiter.limit("60/minute")
def login(
    request: Request,
    payload: LoginRequest,
    response: Response,
    db: Session = Depends(get_db),
):
    now_utc = datetime.now(timezone.utc)
    user = db.scalar(select(User).options(joinedload(User.vehicles)).where(User.email == payload.email.lower()))
    ip = get_client_ip(request)
    corr = getattr(request.state, "correlation_id", None)

    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    if user.locked_until:
        locked = user.locked_until if user.locked_until.tzinfo else user.locked_until.replace(tzinfo=timezone.utc)
        if locked > now_utc:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Account temporarily locked due to repeated failed login attempts. Try again in a few minutes.",
            )

    if not verify_password(payload.password, user.password_hash):
        user.failed_login_attempts += 1
        if user.failed_login_attempts >= 5:
            user.locked_until = now_utc + timedelta(minutes=5)
        record_audit_log(
            db,
            action="LOGIN_FAILED",
            resource_type="user",
            resource_id=user.id,
            user_id=user.id,
            details={"email": user.email, "attempts": user.failed_login_attempts},
            ip_address=ip,
            correlation_id=corr,
        )
        db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    user.failed_login_attempts = 0
    user.locked_until = None

    refresh_raw, refresh_hash = generate_refresh_token()
    settings = get_settings()
    db.add(
        RefreshToken(
            user_id=user.id,
            token_hash=refresh_hash,
            family_id=uuid.uuid4().hex,
            expires_at=now_utc + timedelta(days=settings.refresh_token_expire_days),
        )
    )
    record_audit_log(
        db,
        action="LOGIN_SUCCESS",
        resource_type="user",
        resource_id=user.id,
        user_id=user.id,
        details={"email": user.email, "role": user.role.value},
        ip_address=ip,
        correlation_id=corr,
    )
    db.commit()

    access = create_access_token(user.id, user.role.value, user.email)
    csrf = generate_csrf_token()
    _set_auth_cookies(response, access, refresh_raw, csrf, request)
    return AuthResponse(access_token=access, csrf_token=csrf, user=UserOut.model_validate(user))


@router.post("/refresh", response_model=AuthResponse)
@limiter.limit("30/minute")
def refresh_token(
    request: Request,
    response: Response,
    ck_refresh: str | None = Cookie(default=None),
    db: Session = Depends(get_db),
):
    if not ck_refresh:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh cookie missing")

    now_utc = datetime.now(timezone.utc)
    token_hash = hash_token(ck_refresh)
    stored = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
    if not stored:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")

    exp = stored.expires_at if stored.expires_at.tzinfo else stored.expires_at.replace(tzinfo=timezone.utc)
    if stored.revoked or exp <= now_utc:
        # Token reuse detection: revoke entire family
        family_tokens = db.scalars(select(RefreshToken).where(RefreshToken.family_id == stored.family_id)).all()
        for ft in family_tokens:
            ft.revoked = True
        db.commit()
        _clear_auth_cookies(response)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token expired or revoked")

    user = db.scalar(select(User).options(joinedload(User.vehicles)).where(User.id == stored.user_id))
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User inactive")

    # Rotate refresh token
    stored.revoked = True
    new_raw, new_hash = generate_refresh_token()
    settings = get_settings()
    db.add(
        RefreshToken(
            user_id=user.id,
            token_hash=new_hash,
            family_id=stored.family_id,
            expires_at=now_utc + timedelta(days=settings.refresh_token_expire_days),
        )
    )
    db.commit()

    access = create_access_token(user.id, user.role.value, user.email)
    csrf = generate_csrf_token()
    _set_auth_cookies(response, access, new_raw, csrf, request)
    return AuthResponse(access_token=access, csrf_token=csrf, user=UserOut.model_validate(user))


@router.post("/logout")
def logout(
    response: Response,
    ck_refresh: str | None = Cookie(default=None),
    db: Session = Depends(get_db),
):
    if ck_refresh:
        stored = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_token(ck_refresh)))
        if stored:
            stored.revoked = True
            db.commit()
    _clear_auth_cookies(response)
    return {"message": "Logged out"}


@router.get("/me", response_model=UserOut)
def get_me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    loaded = db.scalar(select(User).options(joinedload(User.vehicles)).where(User.id == user.id))
    return UserOut.model_validate(loaded)


@router.post("/vehicles", response_model=VehicleOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_csrf)])
def add_vehicle(
    payload: VehicleCreateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    vehicle = Vehicle(
        user_id=user.id,
        make=payload.make.strip(),
        model=payload.model.strip(),
        registration_number=payload.registration_number.strip().upper(),
        connector_type=payload.connector_type,
        battery_capacity_kwh=payload.battery_capacity_kwh,
        current_battery_pct=payload.current_battery_pct,
        range_km=payload.range_km,
        is_default=False,
    )
    db.add(vehicle)
    db.commit()
    db.refresh(vehicle)
    return VehicleOut.model_validate(vehicle)


@router.get("/notifications", response_model=list[NotificationOut])
def list_notifications(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(Notification).where(Notification.user_id == user.id).order_by(Notification.created_at.desc()).limit(25)
    ).all()
    return [NotificationOut.model_validate(n) for n in rows]


@router.post("/notifications/read-all", dependencies=[Depends(require_csrf)])
def mark_notifications_read(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(Notification).where(Notification.user_id == user.id, Notification.is_read == False)  # noqa: E712
    ).all()
    for n in rows:
        n.is_read = True
    db.commit()
    return {"marked_read": len(rows)}
