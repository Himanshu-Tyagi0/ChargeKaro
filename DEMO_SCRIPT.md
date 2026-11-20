# ChargeKaro — 3-Minute Hackathon Pitch & Demo Script

**Goal:** Show ChargeKaro solving Delhi-NCR EV charging anxiety end-to-end in 3 minutes using live WebSockets, voice AI agents, database concurrency locks, and owner analytics.

---

### 0:00 – 0:25 | Step 1: Open Live Map & Watch Real-Time Telemetry
1. Open **http://localhost:3000** and click **Demo Driver** on the landing page (auto-signs in as `driver@chargekaro.demo` and opens `/map`).
2. Point out the slim **Demo Mode** banner (`Live stream active`) and the 12 Delhi-NCR stations on OpenStreetMap with `free/total` counters (`green` = free, `amber` = limited, `red` = busy, `grey` = offline).
3. Wait ~6 seconds so judges see a marker count and charger badge transition automatically over WebSockets without refreshing the page.

### 0:25 – 0:50 | Step 2: Filter & Pick a Station
1. In the filter bar, select **CCS2** connector, **50+ kW (Fast DC)**, and toggle **Free Now**.
2. Click **VoltHub Connaught Place** on the map or list to open the Station Detail Panel.
3. Point out distance, amenities (`Cafe, Restroom, Wi-Fi`), individual gun statuses, kW ratings, and ₹/kWh pricing.

### 0:50 – 1:30 | Step 3: Book a Slot by Voice (AI & Agent Activity)
1. Click the floating **AI & Voice** button in the bottom-right corner.
2. Click the microphone (or click the quick chip): **"Book Charger 2 at ChargeZone Saket for 6 PM"** (or test Hinglish: **"Mere paas sabse sasta charger dhundo"**).
3. Show the **Agent Activity** trace revealing the exact whitelisted tool call (`propose_booking`) and arguments.
4. Highlight the **Confirmation Required** card — explain that the AI **never** executes write actions without explicit user confirmation. Click **Confirm & Execute** to create the booking with a signed single-use QR pass.

### 1:30 – 1:55 | Step 4: Demonstrate Double-Booking Protection
1. Click **Book Slot** on a charger -> select an occupied/already-reserved slot (crossed out in the 30-min grid), or explain how `backend/app/tests/test_booking_concurrency.py` fires 6 simultaneous threads on the exact same slot and proves via `BEGIN IMMEDIATE` + overlap check that **1 succeeds (201)** and **5 fail (409 Conflict)**.

### 1:55 – 2:25 | Step 5: Check In & Run Live Charging Session
1. Go to **My Bookings** (`/bookings`) -> click **Simulate Scan & Charge** on your confirmed upcoming slot.
2. Show the **Live Charging Session** screen: animated battery % ring, kWh delivered, live ₹ cost ticker, and time remaining.
3. Click **Stop Charging & Generate Invoice** -> show the printable GST invoice and confirm the charger returned to `FREE` on the map.

### 2:25 – 2:50 | Step 6: Station Owner Dashboard & AI Demand Insights
1. Click **Sign Out** -> sign in as **Station Owner** (`owner@chargekaro.demo` / `Owner@123!`) -> **Owner Portal** (`/owner`).
2. Show the 7-day Revenue chart, Live Utilization bars, 24x7 Peak Hour Heatmap, and **AI Demand Insights** (Ridge regression predicting quietest vs busiest IST hours).
3. Toggle a charger to **Maint. (Offline)** to show instant WebSocket propagation and automatic alternative proposals for affected drivers.

### 2:50 – 3:00 | Step 7: Security & Admin Controls Wrap-Up
1. Open **Admin Console** (`/admin` as `admin@chargekaro.demo` / `Admin@123!`), show **Audit Logs** (masked PII + correlation IDs) and **Demo Controls** (`Simulate Rush Hour`, `Force a Charger Offline`).
2. Summarize security highlights: Argon2id passwords, rotating httpOnly refresh cookies + CSRF, backend RBAC/IDOR checks, strict Pydantic schemas, signed single-use QR tokens, and AI tool whitelisting.
