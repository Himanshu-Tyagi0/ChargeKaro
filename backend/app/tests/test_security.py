"""Security tests: RBAC, IDOR prevention, input validation, QR single-use, AI confirmation gate."""

from datetime import datetime, timedelta, timezone

from app.core.database import SessionLocal
from app.models.station import Charger
from app.security.passwords import validate_password_strength
from sqlalchemy import select


def _login(client, email: str, password: str) -> tuple[str, str]:
    res = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert res.status_code == 200, res.text
    data = res.json()
    return data["access_token"], data["csrf_token"]


def test_password_policy_rejects_weak_passwords():
    ok, _ = validate_password_strength("weak")
    assert not ok
    ok2, _ = validate_password_strength("alllowercase123!")
    assert not ok2
    ok3, _ = validate_password_strength("StrongPass@2026")
    assert ok3


def test_rbac_blocks_driver_from_owner_and_admin_endpoints(client):
    token, csrf = _login(client, "driver@chargekaro.demo", "Driver@123!")
    headers = {"Authorization": f"Bearer {token}", "X-CSRF-Token": csrf}

    r_owner = client.get("/api/v1/owner/dashboard", headers=headers)
    assert r_owner.status_code == 403

    r_admin = client.get("/api/v1/admin/users", headers=headers)
    assert r_admin.status_code == 403

    r_demo = client.post("/api/v1/admin/demo/rush-hour", headers=headers)
    assert r_demo.status_code == 403


def test_idor_prevents_other_user_from_cancelling_booking(client):
    # Create second driver
    reg = client.post(
        "/api/v1/auth/register",
        json={
            "email": "otherdriver@chargekaro.demo",
            "full_name": "Other Driver",
            "password": "OtherUser@123!",
            "role": "driver",
        },
    )
    assert reg.status_code == 201
    other_token = reg.json()["access_token"]
    other_csrf = reg.json()["csrf_token"]

    # Driver 1 creates a booking
    d1_token, d1_csrf = _login(client, "driver@chargekaro.demo", "Driver@123!")
    with SessionLocal() as db:
        charger = db.scalar(select(Charger).where(Charger.status == "FREE"))
        cid = charger.id
    slot = (datetime.now(timezone.utc) + timedelta(days=5)).replace(hour=10, minute=0, second=0, microsecond=0).isoformat()
    bk = client.post(
        "/api/v1/bookings",
        json={"charger_id": cid, "start_time": slot, "duration_minutes": 30},
        headers={"Authorization": f"Bearer {d1_token}", "X-CSRF-Token": d1_csrf},
    )
    assert bk.status_code == 201
    booking_id = bk.json()["id"]

    # Other driver tries to cancel Driver 1's booking -> must get 403 Forbidden
    idor = client.post(
        f"/api/v1/bookings/{booking_id}/cancel",
        headers={"Authorization": f"Bearer {other_token}", "X-CSRF-Token": other_csrf},
    )
    assert idor.status_code == 403


def test_strict_schema_rejects_unexpected_fields(client):
    token, _ = _login(client, "driver@chargekaro.demo", "Driver@123!")
    res = client.post(
        "/api/v1/ai/chat",
        json={"message": "Find fast charger", "injected_sql": "DROP TABLE users;"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 422


def test_qr_token_is_single_use(client):
    token, csrf = _login(client, "driver@chargekaro.demo", "Driver@123!")
    headers = {"Authorization": f"Bearer {token}", "X-CSRF-Token": csrf}

    with SessionLocal() as db:
        charger = db.scalar(select(Charger).where(Charger.status == "FREE"))
        cid = charger.id
    slot = (datetime.now(timezone.utc) + timedelta(days=5)).replace(hour=16, minute=0, second=0, microsecond=0).isoformat()
    bk = client.post(
        "/api/v1/bookings",
        json={"charger_id": cid, "start_time": slot, "duration_minutes": 30},
        headers=headers,
    )
    assert bk.status_code == 201
    booking_id = bk.json()["id"]
    qr_token = bk.json()["qr_token"]
    assert qr_token

    c1 = client.post(f"/api/v1/bookings/{booking_id}/checkin", json={"qr_token": qr_token}, headers=headers)
    assert c1.status_code == 200

    # Reusing the same QR token must be rejected
    c2 = client.post(f"/api/v1/bookings/{booking_id}/checkin", json={"qr_token": qr_token}, headers=headers)
    assert c2.status_code in (400, 409)


def test_ai_booking_requires_explicit_confirmation(client):
    token, _ = _login(client, "driver@chargekaro.demo", "Driver@123!")
    headers = {"Authorization": f"Bearer {token}"}
    res = client.post(
        "/api/v1/ai/chat",
        json={"message": "Book Charger 1 at VoltHub Connaught Place for 6 PM"},
        headers=headers,
    )
    assert res.status_code == 200
    data = res.json()
    assert data["pending_action"] is not None
    assert data["executed_booking"] is None
