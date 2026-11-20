"""Seed script for ChargeKaro Delhi-NCR demo data (12 stations, 3 roles, 2 EVs, ~30 bookings)."""

import json
import random
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.core.database import Base, SessionLocal, engine
from app.models.audit import AuditLog, Notification
from app.models.booking import Booking, ChargingSession, Payment
from app.models.enums import (
    BookingStatus,
    ChargerStatus,
    ConnectorType,
    NotificationType,
    PaymentStatus,
    SessionStatus,
    UserRole,
)
from app.models.station import Charger, Station, StatusEvent
from app.models.user import RefreshToken, User, Vehicle
from app.security.passwords import hash_password

DEMO_STATIONS = [
    ("VoltHub Connaught Place", "Connaught Place", "Block B, Outer Circle, Connaught Place, New Delhi", 28.6315, 77.2167, "VoltHub Mobility", "24x7", True, ["Cafe", "Restroom", "Wi-Fi", "Parking"], 4.8),
    ("GreenPlug India Gate", "India Gate", "C-Hexagon Parking Bay, Near India Gate, New Delhi", 28.6129, 77.2295, "GreenPlug India", "06:00 - 23:00", False, ["Parking", "Restroom"], 4.6),
    ("ChargeZone Saket", "Saket", "Select Citywalk Plaza Level P1, Saket, New Delhi", 28.5245, 77.2066, "ChargeZone Grid", "24x7", True, ["Cafe", "Restroom", "Wi-Fi", "Parking"], 4.7),
    ("EcoCharge Nehru Place", "Nehru Place", "Eros Corporate Tower Forecourt, Nehru Place, New Delhi", 28.5494, 77.2501, "EcoCharge Energy", "07:00 - 22:30", False, ["Cafe", "Wi-Fi", "Parking"], 4.4),
    ("PowerPoint Dwarka Sec 21", "Dwarka Sector 21", "Metro Mall Feeder Hub, Dwarka Sec 21, New Delhi", 28.5523, 77.0583, "PowerPoint EV", "24x7", True, ["Restroom", "Parking"], 4.5),
    ("VoltHub Rohini", "Rohini", "Unity One Mall Forecourt, Sector 10, Rohini, New Delhi", 28.7041, 77.1025, "VoltHub Mobility", "06:00 - 23:30", False, ["Cafe", "Restroom", "Parking"], 4.3),
    ("ChargeZone Cyber Hub Gurugram", "Cyber Hub Gurugram", "DLF CyberHub Gate 2 EV Plaza, Gurugram", 28.4950, 77.0890, "ChargeZone Grid", "24x7", True, ["Cafe", "Restroom", "Wi-Fi", "Parking"], 4.9),
    ("GreenPlug Noida Sector 18", "Noida Sector 18", "DLF Mall of India EV Bay, Sector 18, Noida", 28.5700, 77.3219, "GreenPlug India", "24x7", True, ["Cafe", "Restroom", "Wi-Fi", "Parking"], 4.7),
    ("EcoCharge Lajpat Nagar", "Lajpat Nagar", "Central Market Ring Road Bay, Lajpat Nagar II, New Delhi", 28.5677, 77.2433, "EcoCharge Energy", "07:00 - 23:00", False, ["Parking", "Wi-Fi"], 4.2),
    ("PowerPoint Karol Bagh", "Karol Bagh", "Ajmal Khan Road Multi-Level Parking, Karol Bagh, New Delhi", 28.6519, 77.1909, "PowerPoint EV", "06:00 - 22:00", False, ["Restroom", "Parking"], 4.1),
    ("VoltHub Hauz Khas", "Hauz Khas", "Aurobindo Marg Metro Parking, Hauz Khas, New Delhi", 28.5494, 77.2001, "VoltHub Mobility", "24x7", True, ["Cafe", "Wi-Fi", "Parking"], 4.6),
    ("ChargeZone IGI Airport T3", "IGI Airport T3", "Terminal 3 Multi-Level Car Park EV Zone, New Delhi", 28.5562, 77.1000, "ChargeZone Grid", "24x7", True, ["Cafe", "Restroom", "Wi-Fi", "Parking"], 4.8),
]

CHARGER_TEMPLATES = [
    (ConnectorType.CCS2, 60.0, 18.0),
    (ConnectorType.CCS2, 120.0, 22.0),
    (ConnectorType.TYPE_2, 22.0, 14.0),
    (ConnectorType.CHADEMO, 50.0, 19.0),
    (ConnectorType.BHARAT_DC_001, 30.0, 15.0),
    (ConnectorType.BHARAT_AC_001, 7.4, 12.0),
]


def seed_database(reset: bool = False) -> None:
    """Populate database with deterministic Delhi-NCR demo data."""
    Base.metadata.create_all(bind=engine)
    rng = random.Random(42)

    with SessionLocal() as db:
        if reset:
            for model in [Payment, ChargingSession, Booking, StatusEvent, Charger, Station, Vehicle, Notification, AuditLog, RefreshToken, User]:
                db.query(model).delete()
            db.commit()
        else:
            existing_user = db.scalar(select(User.id).limit(1))
            if existing_user:
                return

        # 1. Demo Users (Driver, Station Owner, Admin)
        driver = User(
            email="driver@chargekaro.demo",
            full_name="Aarav Mehta",
            phone="+91-9811001122",
            password_hash=hash_password("Driver@123!"),
            role=UserRole.DRIVER,
        )
        owner = User(
            email="owner@chargekaro.demo",
            full_name="Priya Kapoor",
            phone="+91-9811003344",
            password_hash=hash_password("Owner@123!"),
            role=UserRole.OWNER,
        )
        admin = User(
            email="admin@chargekaro.demo",
            full_name="Rohan Verma",
            phone="+91-9811005566",
            password_hash=hash_password("Admin@123!"),
            role=UserRole.ADMIN,
        )
        db.add_all([driver, owner, admin])
        db.flush()

        # 2. Demo Vehicles for Driver
        v1 = Vehicle(
            user_id=driver.id,
            make="Tata",
            model="Nexon EV Max",
            registration_number="DL3CAF9042",
            connector_type=ConnectorType.CCS2,
            battery_capacity_kwh=40.5,
            current_battery_pct=34,
            range_km=310,
            is_default=True,
        )
        v2 = Vehicle(
            user_id=driver.id,
            make="MG",
            model="ZS EV",
            registration_number="DL8CBA4120",
            connector_type=ConnectorType.CCS2,
            battery_capacity_kwh=50.3,
            current_battery_pct=52,
            range_km=380,
            is_default=False,
        )
        db.add_all([v1, v2])
        db.flush()

        # 3. 12 Delhi-NCR Demo Stations + 3-6 Chargers each
        now_utc = datetime.now(timezone.utc)
        all_chargers: list[Charger] = []

        for idx, (name, area, addr, lat, lng, op, hrs, is24, amens, rating) in enumerate(DEMO_STATIONS):
            st = Station(
                owner_id=owner.id,
                name=name,
                area=area,
                address=addr,
                city="Delhi-NCR",
                latitude=lat,
                longitude=lng,
                operator_name=op,
                opening_hours=hrs,
                is_24x7=is24,
                amenities_json=json.dumps(amens),
                average_rating=rating,
                is_demo=True,
            )
            db.add(st)
            db.flush()

            num_chargers = 4 if idx % 3 == 0 else (5 if idx % 3 == 1 else 3)
            if idx in (0, 2, 6, 11):
                num_chargers = 6

            for c_idx in range(num_chargers):
                conn, pwr, base_price = CHARGER_TEMPLATES[c_idx % len(CHARGER_TEMPLATES)]
                price = round(base_price + (idx % 3), 1)
                # Ensure realistic mix of FREE, OCCUPIED, and rare OFFLINE
                if c_idx == 0:
                    st_status = ChargerStatus.FREE
                elif idx == 4 and c_idx == 2:
                    st_status = ChargerStatus.OFFLINE
                else:
                    st_status = rng.choices(
                        [ChargerStatus.FREE, ChargerStatus.OCCUPIED, ChargerStatus.OFFLINE],
                        weights=[0.58, 0.35, 0.07],
                        k=1,
                    )[0]

                c = Charger(
                    station_id=st.id,
                    label=f"Charger {c_idx + 1}",
                    connector_type=conn,
                    power_kw=pwr,
                    price_per_kwh=price,
                    status=st_status,
                    last_updated=now_utc - timedelta(minutes=rng.randint(1, 25)),
                    flap_count=2 if (idx == 4 and c_idx == 2) else 0,
                )
                db.add(c)
                db.flush()
                all_chargers.append(c)

                # Historical StatusEvents for Demand Prediction Agent
                for ev_i in range(6):
                    ev_time = now_utc - timedelta(hours=rng.randint(2, 120))
                    db.add(
                        StatusEvent(
                            charger_id=c.id,
                            previous_status=ChargerStatus.FREE,
                            new_status=ChargerStatus.OCCUPIED,
                            source="HISTORICAL_SEED",
                            created_at=ev_time,
                        )
                    )

        # 4. ~30 Past & Future Demo Bookings
        # 26 completed past bookings across the last 7 days for rich charts & demand curves
        for b_i in range(26):
            c = all_chargers[b_i % len(all_chargers)]
            days_ago = rng.randint(0, 6)
            ist_hour = rng.choice([9, 10, 14, 18, 19, 20, 21])
            start_t = (now_utc - timedelta(days=days_ago)).replace(
                hour=(ist_hour - 5) % 24, minute=rng.choice([0, 30]), second=0, microsecond=0
            )
            if start_t >= now_utc - timedelta(hours=1):
                start_t -= timedelta(days=1)
            dur = rng.choice([30, 60])
            cost = round(c.power_kw * (dur / 60.0) * 0.65 * c.price_per_kwh, 2)
            cost = min(980.0, max(120.0, cost))
            bk = Booking(
                user_id=driver.id,
                charger_id=c.id,
                vehicle_id=v1.id,
                start_time=start_t,
                end_time=start_t + timedelta(minutes=dur),
                duration_minutes=dur,
                status=BookingStatus.COMPLETED,
                estimated_cost_inr=cost,
                qr_token_jti=uuid.uuid4().hex,
                qr_used=True,
                created_at=start_t - timedelta(hours=2),
            )
            db.add(bk)
            db.flush()
            db.add(
                ChargingSession(
                    booking_id=bk.id,
                    charger_id=c.id,
                    user_id=driver.id,
                    started_at=start_t,
                    ended_at=start_t + timedelta(minutes=dur),
                    initial_battery_pct=24,
                    current_battery_pct=82.0,
                    target_battery_pct=85,
                    kwh_delivered=round(cost / c.price_per_kwh, 2),
                    total_cost_inr=cost,
                    status=SessionStatus.COMPLETED,
                )
            )
            db.add(
                Payment(
                    booking_id=bk.id,
                    user_id=driver.id,
                    amount_inr=cost,
                    method="MOCK_UPI",
                    reference_id=f"DEMO-{uuid.uuid4().hex[:8].upper()}",
                    status=PaymentStatus.PAID,
                )
            )

        # 4 Upcoming confirmed bookings for the demo driver (ready for immediate Check-In demo!)
        upcoming_offsets = [5, 90, 180, 1440]  # 5 mins from now (ready to check in!), 1.5h, 3h, tomorrow
        for u_i, mins_ahead in enumerate(upcoming_offsets):
            c = all_chargers[(u_i * 5) % len(all_chargers)]
            c.status = ChargerStatus.BOOKED if mins_ahead < 30 else ChargerStatus.FREE
            start_t = now_utc + timedelta(minutes=mins_ahead)
            dur = 30
            cost = round(max(95.0, min(650.0, c.power_kw * 0.35 * c.price_per_kwh)), 2)
            bk = Booking(
                user_id=driver.id,
                charger_id=c.id,
                vehicle_id=v1.id if u_i % 2 == 0 else v2.id,
                start_time=start_t,
                end_time=start_t + timedelta(minutes=dur),
                duration_minutes=dur,
                status=BookingStatus.CONFIRMED,
                estimated_cost_inr=cost,
                qr_token_jti=uuid.uuid4().hex,
                qr_used=False,
            )
            db.add(bk)
            db.flush()
            db.add(
                Payment(
                    booking_id=bk.id,
                    user_id=driver.id,
                    amount_inr=cost,
                    method="MOCK_UPI",
                    reference_id=f"DEMO-{uuid.uuid4().hex[:8].upper()}",
                    status=PaymentStatus.PAID,
                )
            )

        # 5. Initial Notifications & Audit log
        db.add_all([
            Notification(
                user_id=driver.id,
                title="Upcoming Charging Slot",
                message="Your slot at VoltHub Connaught Place is ready for QR check-in.",
                type=NotificationType.REMINDER,
            ),
            Notification(
                user_id=owner.id,
                title="Evening Peak Forecast",
                message="Demand Prediction Agent forecasts 85% utilization at Cyber Hub Gurugram between 18:00-21:00 IST.",
                type=NotificationType.INFO,
            ),
        ])
        db.add(
            AuditLog(
                user_id=admin.id,
                action="DEMO_SEED_INITIALIZED",
                resource_type="system",
                details_json=json.dumps({"stations": len(DEMO_STATIONS), "chargers": len(all_chargers)}),
                ip_address="127.0.0.1",
            )
        )
        db.commit()


if __name__ == "__main__":
    seed_database(reset=True)
    print("Seeded ChargeKaro Delhi-NCR demo database successfully.")
