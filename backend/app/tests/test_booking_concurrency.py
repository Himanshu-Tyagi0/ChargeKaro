"""Concurrency test proving strict database-level double-booking prevention."""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

from app.core.database import SessionLocal
from app.models.station import Charger
from app.models.user import User
from app.services.booking_service import create_booking_transactional
from sqlalchemy import select


def test_concurrent_booking_prevents_double_booking(client):
    """Fire 6 simultaneous booking attempts on the exact same charger & slot; only 1 may succeed."""
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == "driver@chargekaro.demo"))
        charger = db.scalar(select(Charger).where(Charger.status == "FREE"))
        assert user is not None and charger is not None
        user_id = user.id
        charger_id = charger.id

    target_slot = (datetime.now(timezone.utc) + timedelta(days=3)).replace(
        hour=12, minute=0, second=0, microsecond=0
    )

    def attempt(idx: int) -> int:
        with SessionLocal() as thread_db:
            thread_user = thread_db.get(User, user_id)
            try:
                create_booking_transactional(
                    db=thread_db,
                    user=thread_user,
                    charger_id=charger_id,
                    start_time=target_slot,
                    duration_minutes=30,
                    idempotency_key=f"concurrent-test-{idx}",
                )
                return 201
            except Exception as exc:
                return getattr(exc, "status_code", 409)

    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(attempt, range(6)))

    successes = [code for code in results if code == 201]
    conflicts = [code for code in results if code == 409]
    assert len(successes) == 1, f"Expected exactly 1 booking to succeed, got {results}"
    assert len(conflicts) == 5, f"Expected 5 conflict rejections, got {results}"


def test_idempotency_key_returns_same_booking_without_duplicate(client):
    """Retrying a booking request with the same Idempotency-Key returns the existing booking."""
    login = client.post(
        "/api/v1/auth/login",
        json={"email": "driver@chargekaro.demo", "password": "Driver@123!"},
    )
    assert login.status_code == 200
    token = login.json()["access_token"]
    csrf = login.json()["csrf_token"]

    with SessionLocal() as db:
        charger = db.scalar(select(Charger).where(Charger.status == "FREE"))
        charger_id = charger.id

    slot = (datetime.now(timezone.utc) + timedelta(days=4)).replace(
        hour=15, minute=0, second=0, microsecond=0
    ).isoformat()

    headers = {"Authorization": f"Bearer {token}", "X-CSRF-Token": csrf}
    body = {
        "charger_id": charger_id,
        "start_time": slot,
        "duration_minutes": 30,
        "idempotency_key": "idem-unique-key-001",
    }
    r1 = client.post("/api/v1/bookings", json=body, headers=headers)
    r2 = client.post("/api/v1/bookings", json=body, headers=headers)
    assert r1.status_code == 201
    assert r2.status_code == 201
    assert r1.json()["id"] == r2.json()["id"]
