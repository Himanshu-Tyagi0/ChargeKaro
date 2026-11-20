import type {
  AIChatResponse,
  AuditLogItem,
  Booking,
  Charger,
  ChargerStatus,
  ConnectorType,
  DemandForecast,
  Invoice,
  NotificationItem,
  RoutePlan,
  SessionStats,
  Station,
  TimeSlot,
  User,
} from '../types';
import { isFreeCancellationEligible, recomputeStationAggregates } from '../utils/stationHelpers';

const STORAGE_KEY = 'ck_static_demo_state_v1';

interface StoredUser extends User {
  password: string;
}

interface StoredBooking extends Booking {
  payment_method: string;
  payment_reference: string;
}

interface StoredSession {
  id: number;
  booking_id: number;
  charger_id: number;
  user_id: number;
  started_at: string;
  ended_at: string | null;
  initial_battery_pct: number;
  target_battery_pct: number;
  status: 'ACTIVE' | 'COMPLETED';
  kwh_delivered: number | null;
  total_cost_inr: number | null;
}

interface PendingAiAction {
  action_id: string;
  action_type: 'create_booking' | 'cancel_booking';
  summary: string;
  details: Record<string, unknown>;
}

interface DemoState {
  users: StoredUser[];
  stations: Station[];
  bookings: StoredBooking[];
  sessions: StoredSession[];
  notifications: (NotificationItem & { user_id: number })[];
  auditLogs: AuditLogItem[];
  pendingActions: Record<string, PendingAiAction>;
  nextIds: {
    user: number;
    vehicle: number;
    station: number;
    charger: number;
    booking: number;
    session: number;
    notif: number;
    audit: number;
  };
}

const DEMO_STATIONS_META: Array<{
  name: string;
  area: string;
  address: string;
  lat: number;
  lng: number;
  operator: string;
  hours: string;
  is24: boolean;
  amenities: string[];
  rating: number;
  chargerCount: number;
}> = [
  { name: 'VoltHub Connaught Place', area: 'Connaught Place', address: 'Block B, Outer Circle, Connaught Place, New Delhi', lat: 28.6315, lng: 77.2167, operator: 'VoltHub Mobility', hours: '24x7', is24: true, amenities: ['Cafe', 'Restroom', 'Wi-Fi', 'Parking'], rating: 4.8, chargerCount: 6 },
  { name: 'GreenPlug India Gate', area: 'India Gate', address: 'C-Hexagon Parking Bay, Near India Gate, New Delhi', lat: 28.6129, lng: 77.2295, operator: 'GreenPlug India', hours: '06:00 - 23:00', is24: false, amenities: ['Parking', 'Restroom'], rating: 4.6, chargerCount: 5 },
  { name: 'ChargeZone Saket', area: 'Saket', address: 'Select Citywalk Plaza Level P1, Saket, New Delhi', lat: 28.5245, lng: 77.2066, operator: 'ChargeZone Grid', hours: '24x7', is24: true, amenities: ['Cafe', 'Restroom', 'Wi-Fi', 'Parking'], rating: 4.7, chargerCount: 6 },
  { name: 'EcoCharge Nehru Place', area: 'Nehru Place', address: 'Eros Corporate Tower Forecourt, Nehru Place, New Delhi', lat: 28.5494, lng: 77.2501, operator: 'EcoCharge Energy', hours: '07:00 - 22:30', is24: false, amenities: ['Cafe', 'Wi-Fi', 'Parking'], rating: 4.4, chargerCount: 4 },
  { name: 'PowerPoint Dwarka Sec 21', area: 'Dwarka Sector 21', address: 'Metro Mall Feeder Hub, Dwarka Sec 21, New Delhi', lat: 28.5523, lng: 77.0583, operator: 'PowerPoint EV', hours: '24x7', is24: true, amenities: ['Restroom', 'Parking'], rating: 4.5, chargerCount: 5 },
  { name: 'VoltHub Rohini', area: 'Rohini', address: 'Unity One Mall Forecourt, Sector 10, Rohini, New Delhi', lat: 28.7041, lng: 77.1025, operator: 'VoltHub Mobility', hours: '06:00 - 23:30', is24: false, amenities: ['Cafe', 'Restroom', 'Parking'], rating: 4.3, chargerCount: 3 },
  { name: 'ChargeZone Cyber Hub Gurugram', area: 'Cyber Hub Gurugram', address: 'DLF CyberHub Gate 2 EV Plaza, Gurugram', lat: 28.4950, lng: 77.0890, operator: 'ChargeZone Grid', hours: '24x7', is24: true, amenities: ['Cafe', 'Restroom', 'Wi-Fi', 'Parking'], rating: 4.9, chargerCount: 6 },
  { name: 'GreenPlug Noida Sector 18', area: 'Noida Sector 18', address: 'DLF Mall of India EV Bay, Sector 18, Noida', lat: 28.5700, lng: 77.3219, operator: 'GreenPlug India', hours: '24x7', is24: true, amenities: ['Cafe', 'Restroom', 'Wi-Fi', 'Parking'], rating: 4.7, chargerCount: 5 },
  { name: 'EcoCharge Lajpat Nagar', area: 'Lajpat Nagar', address: 'Central Market Ring Road Bay, Lajpat Nagar II, New Delhi', lat: 28.5677, lng: 77.2433, operator: 'EcoCharge Energy', hours: '07:00 - 23:00', is24: false, amenities: ['Parking', 'Wi-Fi'], rating: 4.2, chargerCount: 3 },
  { name: 'PowerPoint Karol Bagh', area: 'Karol Bagh', address: 'Ajmal Khan Road Multi-Level Parking, Karol Bagh, New Delhi', lat: 28.6519, lng: 77.1909, operator: 'PowerPoint EV', hours: '06:00 - 22:00', is24: false, amenities: ['Restroom', 'Parking'], rating: 4.1, chargerCount: 4 },
  { name: 'VoltHub Hauz Khas', area: 'Hauz Khas', address: 'Aurobindo Marg Metro Parking, Hauz Khas, New Delhi', lat: 28.5494, lng: 77.2001, operator: 'VoltHub Mobility', hours: '24x7', is24: true, amenities: ['Cafe', 'Wi-Fi', 'Parking'], rating: 4.6, chargerCount: 5 },
  { name: 'ChargeZone IGI Airport T3', area: 'IGI Airport T3', address: 'Terminal 3 Multi-Level Car Park EV Zone, New Delhi', lat: 28.5562, lng: 77.1000, operator: 'ChargeZone Grid', hours: '24x7', is24: true, amenities: ['Cafe', 'Restroom', 'Wi-Fi', 'Parking'], rating: 4.8, chargerCount: 6 },
];

const CHARGER_TEMPLATES: Array<[ConnectorType, number, number]> = [
  ['CCS2', 60, 18],
  ['CCS2', 120, 22],
  ['Type 2', 22, 14],
  ['CHAdeMO', 50, 19],
  ['Bharat DC-001', 30, 15],
  ['Bharat AC-001', 7.4, 12],
];

const LANDMARKS: Record<string, [number, number]> = {
  'connaught place': [28.6315, 77.2167],
  cp: [28.6315, 77.2167],
  'india gate': [28.6129, 77.2295],
  saket: [28.5245, 77.2066],
  'nehru place': [28.5494, 77.2501],
  dwarka: [28.5523, 77.0583],
  rohini: [28.7041, 77.1025],
  gurugram: [28.4950, 77.0890],
  'cyber hub': [28.4950, 77.0890],
  noida: [28.5700, 77.3219],
  'noida sector 18': [28.5700, 77.3219],
  'lajpat nagar': [28.5677, 77.2433],
  'karol bagh': [28.6519, 77.1909],
  'hauz khas': [28.5494, 77.2001],
  airport: [28.5562, 77.1000],
  'igi airport': [28.5562, 77.1000],
};

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 100) / 100;
}

function createInitialDemoState(nowMs = Date.now()): DemoState {
  const nowIso = new Date(nowMs).toISOString();
  const users: StoredUser[] = [
    {
      id: 1,
      email: 'driver@chargekaro.demo',
      password: 'Driver@123!',
      full_name: 'Aarav Mehta',
      role: 'driver',
      is_active: true,
      created_at: nowIso,
      vehicles: [
        {
          id: 1,
          make: 'Tata',
          model: 'Nexon EV Max',
          registration_number: 'DL3CAF9042',
          connector_type: 'CCS2',
          battery_capacity_kwh: 40.5,
          current_battery_pct: 34,
          range_km: 310,
          is_default: true,
        },
        {
          id: 2,
          make: 'MG',
          model: 'ZS EV',
          registration_number: 'DL8CBA4120',
          connector_type: 'CCS2',
          battery_capacity_kwh: 50.3,
          current_battery_pct: 52,
          range_km: 380,
          is_default: false,
        },
      ],
    },
    {
      id: 2,
      email: 'owner@chargekaro.demo',
      password: 'Owner@123!',
      full_name: 'Priya Kapoor',
      role: 'owner',
      is_active: true,
      created_at: nowIso,
      vehicles: [],
    },
    {
      id: 3,
      email: 'admin@chargekaro.demo',
      password: 'Admin@123!',
      full_name: 'Rohan Verma',
      role: 'admin',
      is_active: true,
      created_at: nowIso,
      vehicles: [],
    },
  ];

  let nextChargerId = 1;
  const allChargers: { charger: Charger; station: Station }[] = [];
  const stations: Station[] = DEMO_STATIONS_META.map((meta, idx) => {
    const stationId = idx + 1;
    const chargers: Charger[] = [];
    for (let cIdx = 0; cIdx < meta.chargerCount; cIdx++) {
      const [connector_type, power_kw, basePrice] = CHARGER_TEMPLATES[cIdx % CHARGER_TEMPLATES.length];
      const price_per_kwh = Number((basePrice + (idx % 3)).toFixed(1));
      let status: ChargerStatus = 'FREE';
      if (idx === 4 && cIdx === 2) {
        status = 'OFFLINE';
      } else if (cIdx !== 0 && (idx + cIdx) % 3 === 1) {
        status = 'OCCUPIED';
      } else if (cIdx === 4 && idx % 2 === 1) {
        status = 'OFFLINE';
      }
      const c: Charger = {
        id: nextChargerId++,
        station_id: stationId,
        label: `Charger ${cIdx + 1}`,
        connector_type,
        power_kw,
        price_per_kwh,
        status,
        last_updated: new Date(nowMs - ((idx + cIdx) % 15 + 1) * 60000).toISOString(),
        flap_count: idx === 4 && cIdx === 2 ? 2 : 0,
      };
      chargers.push(c);
    }

    const st = recomputeStationAggregates({
      id: stationId,
      owner_id: 2,
      name: meta.name,
      area: meta.area,
      address: meta.address,
      city: 'Delhi-NCR',
      latitude: meta.lat,
      longitude: meta.lng,
      operator_name: meta.operator,
      opening_hours: meta.hours,
      is_24x7: meta.is24,
      amenities: meta.amenities,
      average_rating: meta.rating,
      is_demo: true,
      distance_km: null,
      free_chargers: 0,
      total_chargers: 0,
      min_price_per_kwh: 0,
      max_power_kw: 0,
      chargers,
    });
    chargers.forEach((c) => allChargers.push({ charger: c, station: st }));
    return st;
  });

  const bookings: StoredBooking[] = [];
  const sessions: StoredSession[] = [];
  let nextBookingId = 1;
  let nextSessionId = 1;

  for (let i = 0; i < 24; i++) {
    const pair = allChargers[i % allChargers.length];
    const daysAgo = i % 7;
    const startMs = nowMs - daysAgo * 86400000 - ((i % 4) + 2) * 3600000;
    const dur = i % 2 === 0 ? 30 : 60;
    const estCost = Math.round(Math.min(960, Math.max(125, pair.charger.power_kw * (dur / 60) * 0.65 * pair.charger.price_per_kwh)));
    const bId = nextBookingId++;
    const sId = nextSessionId++;
    bookings.push({
      id: bId,
      user_id: 1,
      charger_id: pair.charger.id,
      station_id: pair.station.id,
      station_name: pair.station.name,
      station_area: pair.station.area,
      charger_label: pair.charger.label,
      connector_type: pair.charger.connector_type,
      power_kw: pair.charger.power_kw,
      price_per_kwh: pair.charger.price_per_kwh,
      vehicle_id: 1,
      vehicle_name: 'Tata Nexon EV Max',
      start_time: new Date(startMs).toISOString(),
      end_time: new Date(startMs + dur * 60000).toISOString(),
      duration_minutes: dur,
      status: 'COMPLETED',
      estimated_cost_inr: estCost,
      cancellation_fee_inr: 0,
      connector_warning: null,
      qr_token: `CKQR-${bId}-USED`,
      qr_used: true,
      session_id: sId,
      created_at: new Date(startMs - 3600000).toISOString(),
      payment_method: 'MOCK_UPI',
      payment_reference: `DEMO-${bId}A9F2`,
    });
    sessions.push({
      id: sId,
      booking_id: bId,
      charger_id: pair.charger.id,
      user_id: 1,
      started_at: new Date(startMs).toISOString(),
      ended_at: new Date(startMs + dur * 60000).toISOString(),
      initial_battery_pct: 24,
      target_battery_pct: 85,
      status: 'COMPLETED',
      kwh_delivered: Number((estCost / pair.charger.price_per_kwh).toFixed(2)),
      total_cost_inr: estCost,
    });
  }

  const upcomingOffsets = [5, 90, 180, 1440];
  upcomingOffsets.forEach((minsAhead, idx) => {
    const pair = allChargers[(idx * 5) % allChargers.length];
    if (minsAhead < 30) {
      pair.charger.status = 'BOOKED';
    }
    const startMs = nowMs + minsAhead * 60000;
    const estCost = Math.round(Math.max(95, Math.min(650, pair.charger.power_kw * 0.35 * pair.charger.price_per_kwh)));
    const bId = nextBookingId++;
    bookings.push({
      id: bId,
      user_id: 1,
      charger_id: pair.charger.id,
      station_id: pair.station.id,
      station_name: pair.station.name,
      station_area: pair.station.area,
      charger_label: pair.charger.label,
      connector_type: pair.charger.connector_type,
      power_kw: pair.charger.power_kw,
      price_per_kwh: pair.charger.price_per_kwh,
      vehicle_id: idx % 2 === 0 ? 1 : 2,
      vehicle_name: idx % 2 === 0 ? 'Tata Nexon EV Max' : 'MG ZS EV',
      start_time: new Date(startMs).toISOString(),
      end_time: new Date(startMs + 30 * 60000).toISOString(),
      duration_minutes: 30,
      status: 'CONFIRMED',
      estimated_cost_inr: estCost,
      cancellation_fee_inr: 0,
      connector_warning: null,
      qr_token: `CKQR-${bId}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      qr_used: false,
      session_id: null,
      created_at: nowIso,
      payment_method: 'MOCK_UPI',
      payment_reference: `DEMO-${bId}UP44`,
    });
  });

  const notifications = [
    {
      id: 1,
      user_id: 1,
      title: 'Upcoming Charging Slot',
      message: 'Your slot at VoltHub Connaught Place is ready for QR check-in.',
      type: 'REMINDER',
      is_read: false,
      created_at: nowIso,
    },
    {
      id: 2,
      user_id: 2,
      title: 'Evening Peak Forecast',
      message: 'Demand Prediction Agent forecasts 85% utilization at Cyber Hub Gurugram between 18:00-21:00 IST.',
      type: 'INFO',
      is_read: false,
      created_at: nowIso,
    },
  ];

  const auditLogs: AuditLogItem[] = [
    {
      id: 1,
      user_id: 3,
      action: 'DEMO_SEED_INITIALIZED',
      resource_type: 'system',
      resource_id: '1',
      details_json: JSON.stringify({ stations: stations.length, chargers: allChargers.length }),
      ip_address: '127.0.0.1',
      correlation_id: 'seed-init',
      created_at: nowIso,
    },
  ];

  const refreshedStations = stations.map((s) => recomputeStationAggregates(s));

  return {
    users,
    stations: refreshedStations,
    bookings,
    sessions,
    notifications,
    auditLogs,
    pendingActions: {},
    nextIds: {
      user: 4,
      vehicle: 3,
      station: stations.length + 1,
      charger: nextChargerId,
      booking: nextBookingId,
      session: nextSessionId,
      notif: 3,
      audit: 2,
    },
  };
}

let memoryState: DemoState | null = null;

function loadState(): DemoState {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        return JSON.parse(raw) as DemoState;
      }
    } catch {
      // Ignore corrupt storage and reseed
    }
  }
  if (!memoryState) {
    memoryState = createInitialDemoState();
    saveState(memoryState);
  }
  return memoryState;
}

function saveState(state: DemoState): void {
  memoryState = state;
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore storage quota errors
    }
  }
}

export function resetStaticDemoState(): DemoState {
  const fresh = createInitialDemoState();
  saveState(fresh);
  return fresh;
}

function stripUser(u: StoredUser): User {
  const { password: _pw, ...pub } = u;
  return pub;
}

function makeAccessToken(userId: number): string {
  return `ck-demo-token-${userId}-${Date.now()}`;
}

function parseUserIdFromToken(authHeader?: string): number | null {
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  const match = token.match(/^ck-demo-token-(\d+)-/);
  if (match) return Number(match[1]);
  return null;
}

function findCharger(state: DemoState, chargerId: number): { station: Station; charger: Charger } | null {
  for (const st of state.stations) {
    const ch = st.chargers.find((c) => c.id === chargerId);
    if (ch) return { station: st, charger: ch };
  }
  return null;
}

function throwHttp(status: number, detail: string): never {
  const err = new Error(detail) as Error & {
    response: { status: number; data: { detail: string } };
  };
  err.response = { status, data: { detail } };
  throw err;
}

function computeDemandForecast(station: Station): DemandForecast {
  const hourly_forecast = Array.from({ length: 24 }, (_, hour) => {
    let pct = 26;
    if (hour >= 8 && hour <= 11) pct = 64 + ((hour + station.id) % 12);
    else if (hour >= 17 && hour <= 21) pct = 78 + ((hour + station.id * 3) % 15);
    else if (hour >= 0 && hour <= 5) pct = 12 + ((hour + station.id) % 8);
    else pct = 38 + ((hour * 3 + station.id) % 18);
    pct = Math.min(96, Math.max(8, pct));
    const level: 'LOW' | 'MODERATE' | 'HIGH' = pct >= 70 ? 'HIGH' : pct >= 45 ? 'MODERATE' : 'LOW';
    return {
      hour,
      label: `${String(hour).padStart(2, '0')}:00`,
      predicted_utilization_pct: pct,
      level,
    };
  });
  const sorted = [...hourly_forecast].sort((a, b) => a.predicted_utilization_pct - b.predicted_utilization_pct);
  const best = sorted[0];
  const peak = sorted[sorted.length - 1];
  return {
    station_id: station.id,
    station_name: station.name,
    best_hour_label: best.label,
    peak_hour_label: peak.label,
    hint: `Quietest around ${best.label} IST (${best.predicted_utilization_pct}% load); peak rush around ${peak.label} IST (${peak.predicted_utilization_pct}%).`,
    hourly_forecast,
  };
}

function computeRoutePlan(state: DemoState, body: Record<string, unknown>): RoutePlan {
  const originLabel = String(body.origin || 'Connaught Place');
  const destLabel = String(body.destination || 'Cyber Hub Gurugram');
  const batteryPct = Number(body.battery_pct ?? 30);
  const rangeKm = Number(body.vehicle_range_km ?? 310);
  const connector = String(body.connector_type || 'CCS2');

  const resolveCoords = (label: string, fallback: [number, number]): [number, number] => {
    const key = label.trim().toLowerCase();
    for (const [k, coords] of Object.entries(LANDMARKS)) {
      if (key.includes(k)) return coords;
    }
    return fallback;
  };

  const oCoords = resolveCoords(originLabel, [28.6315, 77.2167]);
  const dCoords = resolveCoords(destLabel, [28.4950, 77.0890]);
  const straightKm = haversineKm(oCoords[0], oCoords[1], dCoords[0], dCoords[1]);
  const roadKm = Math.max(5, Math.round(straightKm * 1.25 * 10) / 10);
  const usableRange = Math.round(rangeKm * (batteryPct / 100) * 0.82 * 10) / 10;
  const needsStop = usableRange < roadKm * 1.35 || batteryPct <= 35;

  const midLat = (oCoords[0] + dCoords[0]) / 2;
  const midLng = (oCoords[1] + dCoords[1]) / 2;
  const candidates = state.stations
    .map((st) => {
      const ch =
        st.chargers.find((c) => c.connector_type === connector && c.status === 'FREE') ||
        st.chargers.find((c) => c.status === 'FREE') ||
        st.chargers[0];
      const detour = haversineKm(midLat, midLng, st.latitude, st.longitude);
      return { st, ch, detour };
    })
    .filter((x) => x.ch)
    .sort((a, b) => a.detour - b.detour);

  const recommended_stops = candidates.slice(0, needsStop ? 2 : 1).map((x, idx) => ({
    station_id: x.st.id,
    station_name: x.st.name,
    area: x.st.area,
    latitude: x.st.latitude,
    longitude: x.st.longitude,
    detour_km: x.detour,
    progress_pct: idx === 0 ? 48 : 78,
    charger_id: x.ch.id,
    charger_label: x.ch.label,
    connector_type: x.ch.connector_type,
    power_kw: x.ch.power_kw,
    price_per_kwh: x.ch.price_per_kwh,
    status: x.ch.status,
    recommended_charge_minutes: x.ch.power_kw >= 60 ? 25 : 40,
  }));

  const polyline: [number, number][] = [
    oCoords,
    ...recommended_stops.map((s) => [s.latitude, s.longitude] as [number, number]),
    dCoords,
  ];

  return {
    origin: { label: originLabel, latitude: oCoords[0], longitude: oCoords[1] },
    destination: { label: destLabel, latitude: dCoords[0], longitude: dCoords[1] },
    estimated_road_km: roadKm,
    usable_range_km: usableRange,
    needs_charging_stop: needsStop,
    recommended_stops,
    polyline,
    summary: `${originLabel} → ${destLabel} (${roadKm} km). Usable range ${usableRange} km; ${
      recommended_stops[0] ? `recommended fast stop at ${recommended_stops[0].station_name} (${recommended_stops[0].charger_label}).` : 'direct drive feasible.'
    }`,
  };
}

export function stepStaticDemoSimulator(): { charger_id: number; station_id: number; status: ChargerStatus; last_updated: string } | null {
  const state = loadState();
  const candidates: Charger[] = [];
  for (const st of state.stations) {
    for (const c of st.chargers) {
      if (c.status === 'FREE' || c.status === 'OCCUPIED') {
        candidates.push(c);
      }
    }
  }
  if (candidates.length === 0) return null;
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  pick.status = pick.status === 'FREE' ? 'OCCUPIED' : 'FREE';
  pick.last_updated = new Date().toISOString();
  state.stations = state.stations.map((s) => (s.id === pick.station_id ? recomputeStationAggregates(s) : s));
  saveState(state);
  return {
    charger_id: pick.id,
    station_id: pick.station_id,
    status: pick.status,
    last_updated: pick.last_updated,
  };
}

export function handleStaticDemoRequest(
  methodInput: string,
  urlPathInput: string,
  params: Record<string, unknown> = {},
  body: Record<string, unknown> = {},
  authHeader?: string
): unknown {
  const state = loadState();
  const method = methodInput.toUpperCase();
  const cleanPath = urlPathInput.replace(/^\/api\/v1/, '').split('?')[0] || '/';
  const currentUserId = parseUserIdFromToken(authHeader);
  const currentUser = currentUserId ? state.users.find((u) => u.id === currentUserId) ?? null : null;

  // --- AUTH ---
  if (method === 'POST' && cleanPath === '/auth/login') {
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const user = state.users.find((u) => u.email.toLowerCase() === email && u.password === password);
    if (!user) {
      throwHttp(401, 'Invalid email or password');
    }
    const token = makeAccessToken(user.id);
    return {
      access_token: token,
      csrf_token: `csrf-demo-${user.id}`,
      user: stripUser(user),
    };
  }

  if (method === 'POST' && cleanPath === '/auth/register') {
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const fullName = String(body.full_name || 'EV Driver').trim();
    const role = body.role === 'owner' ? 'owner' : 'driver';
    if (password.length < 8) {
      throwHttp(400, 'Password must be at least 8 characters long');
    }
    if (state.users.some((u) => u.email.toLowerCase() === email)) {
      throwHttp(409, 'An account with this email already exists');
    }
    const newUser: StoredUser = {
      id: state.nextIds.user++,
      email,
      password,
      full_name: fullName,
      role,
      is_active: true,
      created_at: new Date().toISOString(),
      vehicles:
        role === 'driver'
          ? [
              {
                id: state.nextIds.vehicle++,
                make: 'Tata',
                model: 'Tiago EV',
                registration_number: 'DL1EV0001',
                connector_type: 'CCS2',
                battery_capacity_kwh: 24,
                current_battery_pct: 45,
                range_km: 220,
                is_default: true,
              },
            ]
          : [],
    };
    state.users.push(newUser);
    saveState(state);
    return {
      access_token: makeAccessToken(newUser.id),
      csrf_token: `csrf-demo-${newUser.id}`,
      user: stripUser(newUser),
    };
  }

  if (method === 'POST' && cleanPath === '/auth/refresh') {
    const fallbackUser = currentUser || state.users[0];
    return {
      access_token: makeAccessToken(fallbackUser.id),
      csrf_token: `csrf-demo-${fallbackUser.id}`,
      user: stripUser(fallbackUser),
    };
  }

  if (method === 'POST' && cleanPath === '/auth/logout') {
    return { message: 'Logged out' };
  }

  if (method === 'GET' && cleanPath === '/auth/me') {
    if (!currentUser) throwHttp(401, 'Not authenticated');
    return stripUser(currentUser);
  }

  if (method === 'POST' && cleanPath === '/auth/vehicles') {
    if (!currentUser) throwHttp(401, 'Not authenticated');
    const v = {
      id: state.nextIds.vehicle++,
      make: String(body.make || 'Tata'),
      model: String(body.model || 'Nexon EV'),
      registration_number: String(body.registration_number || 'DL1EV9999').toUpperCase(),
      connector_type: (body.connector_type as ConnectorType) || 'CCS2',
      battery_capacity_kwh: Number(body.battery_capacity_kwh || 40.5),
      current_battery_pct: Number(body.current_battery_pct || 45),
      range_km: Number(body.range_km || 300),
      is_default: false,
    };
    currentUser.vehicles.push(v);
    saveState(state);
    return v;
  }

  if (method === 'GET' && cleanPath === '/auth/notifications') {
    if (!currentUser) return [];
    return state.notifications.filter((n) => n.user_id === currentUser.id);
  }

  if (method === 'POST' && cleanPath === '/auth/notifications/read-all') {
    if (!currentUser) return { marked_read: 0 };
    let count = 0;
    state.notifications.forEach((n) => {
      if (n.user_id === currentUser.id && !n.is_read) {
        n.is_read = true;
        count++;
      }
    });
    saveState(state);
    return { marked_read: count };
  }

  // --- STATIONS & CHARGERS ---
  if (method === 'GET' && cleanPath === '/stations') {
    const lat = Number(params.lat ?? 28.6315);
    const lng = Number(params.lng ?? 77.2167);
    const area = String(params.area || '').trim().toLowerCase();
    const connector = String(params.connector_type || '');
    const minPower = params.min_power ? Number(params.min_power) : 0;
    const maxPrice = params.max_price ? Number(params.max_price) : Infinity;
    const amenity = String(params.amenity || '').toLowerCase();
    const maxDist = params.max_distance_km ? Number(params.max_distance_km) : Infinity;
    const onlyAvail = params.only_available === true || params.only_available === 'true';
    const sortBy = String(params.sort || 'nearest');

    let list = state.stations.map((st) => {
      const rebuilt = recomputeStationAggregates(st);
      return {
        ...rebuilt,
        distance_km: haversineKm(lat, lng, rebuilt.latitude, rebuilt.longitude),
      };
    });

    if (area) {
      list = list.filter(
        (s) => s.name.toLowerCase().includes(area) || s.area.toLowerCase().includes(area) || s.address.toLowerCase().includes(area)
      );
    }
    if (connector) {
      list = list.filter((s) => s.chargers.some((c) => c.connector_type === connector));
    }
    if (minPower > 0) {
      list = list.filter((s) => s.chargers.some((c) => c.power_kw >= minPower));
    }
    if (Number.isFinite(maxPrice)) {
      list = list.filter((s) => s.chargers.some((c) => c.price_per_kwh <= maxPrice));
    }
    if (amenity) {
      list = list.filter((s) => s.amenities.some((a) => a.toLowerCase().includes(amenity)));
    }
    if (Number.isFinite(maxDist)) {
      list = list.filter((s) => (s.distance_km ?? 0) <= maxDist);
    }
    if (onlyAvail) {
      list = list.filter((s) => s.free_chargers > 0);
    }

    if (sortBy === 'cheapest') {
      list.sort((a, b) => a.min_price_per_kwh - b.min_price_per_kwh);
    } else if (sortBy === 'fastest') {
      list.sort((a, b) => b.max_power_kw - a.max_power_kw);
    } else {
      list.sort((a, b) => (a.distance_km ?? 0) - (b.distance_km ?? 0));
    }
    return list;
  }

  const stationDetailMatch = cleanPath.match(/^\/stations\/(\d+)$/);
  if (method === 'GET' && stationDetailMatch) {
    const id = Number(stationDetailMatch[1]);
    const lat = Number(params.lat ?? 28.6315);
    const lng = Number(params.lng ?? 77.2167);
    const st = state.stations.find((s) => s.id === id);
    if (!st) throwHttp(404, 'Station not found');
    return {
      ...recomputeStationAggregates(st),
      distance_km: haversineKm(lat, lng, st.latitude, st.longitude),
    };
  }

  if (method === 'POST' && cleanPath === '/stations') {
    if (!currentUser || (currentUser.role !== 'owner' && currentUser.role !== 'admin')) {
      throwHttp(403, 'Owner or admin role required');
    }
    const stId = state.nextIds.station++;
    const chId = state.nextIds.charger++;
    const st = recomputeStationAggregates({
      id: stId,
      owner_id: currentUser.id,
      name: String(body.name || 'New ChargeKaro Hub'),
      area: String(body.area || 'Delhi-NCR'),
      address: String(body.address || 'New Delhi'),
      city: 'Delhi-NCR',
      latitude: Number(body.latitude || 28.625),
      longitude: Number(body.longitude || 77.215),
      operator_name: String(body.operator_name || currentUser.full_name),
      opening_hours: '24x7',
      is_24x7: true,
      amenities: Array.isArray(body.amenities) ? (body.amenities as string[]) : ['Parking', 'Wi-Fi'],
      average_rating: 4.5,
      is_demo: true,
      distance_km: null,
      free_chargers: 1,
      total_chargers: 1,
      min_price_per_kwh: 18,
      max_power_kw: 60,
      chargers: [
        {
          id: chId,
          station_id: stId,
          label: 'Charger 1',
          connector_type: 'CCS2',
          power_kw: 60,
          price_per_kwh: 18,
          status: 'FREE',
          last_updated: new Date().toISOString(),
          flap_count: 0,
        },
      ],
    });
    state.stations.push(st);
    saveState(state);
    return st;
  }

  const addChargerMatch = cleanPath.match(/^\/stations\/(\d+)\/chargers$/);
  if (method === 'POST' && addChargerMatch) {
    if (!currentUser || (currentUser.role !== 'owner' && currentUser.role !== 'admin')) {
      throwHttp(403, 'Owner or admin role required');
    }
    const stId = Number(addChargerMatch[1]);
    const st = state.stations.find((s) => s.id === stId);
    if (!st) throwHttp(404, 'Station not found');
    const c: Charger = {
      id: state.nextIds.charger++,
      station_id: stId,
      label: String(body.label || `Charger ${st.chargers.length + 1}`),
      connector_type: (body.connector_type as ConnectorType) || 'CCS2',
      power_kw: Number(body.power_kw || 60),
      price_per_kwh: Number(body.price_per_kwh || 18),
      status: 'FREE',
      last_updated: new Date().toISOString(),
      flap_count: 0,
    };
    st.chargers.push(c);
    state.stations = state.stations.map((s) => (s.id === stId ? recomputeStationAggregates(s) : s));
    saveState(state);
    return c;
  }

  const patchChargerMatch = cleanPath.match(/^\/chargers\/(\d+)$/);
  if (method === 'PATCH' && patchChargerMatch) {
    if (!currentUser || (currentUser.role !== 'owner' && currentUser.role !== 'admin')) {
      throwHttp(403, 'Owner or admin role required');
    }
    const cId = Number(patchChargerMatch[1]);
    const found = findCharger(state, cId);
    if (!found) throwHttp(404, 'Charger not found');
    if (body.status) found.charger.status = body.status as ChargerStatus;
    if (body.price_per_kwh !== undefined) found.charger.price_per_kwh = Number(body.price_per_kwh);
    found.charger.last_updated = new Date().toISOString();
    state.stations = state.stations.map((s) => (s.id === found.station.id ? recomputeStationAggregates(s) : s));
    saveState(state);
    return found.charger;
  }

  // --- BOOKINGS & SESSIONS ---
  const availMatch = cleanPath.match(/^\/bookings\/availability\/(\d+)$/);
  if (method === 'GET' && availMatch) {
    const chargerId = Number(availMatch[1]);
    const found = findCharger(state, chargerId);
    if (!found) throwHttp(404, 'Charger not found');
    const targetDate = String(params.target_date || new Date().toISOString().slice(0, 10));
    const slots: TimeSlot[] = [];
    const nowMs = Date.now();
    // Generate 48 30-min IST slots (+05:30)
    for (let idx = 0; idx < 48; idx++) {
      const hh = Math.floor(idx / 2);
      const mm = idx % 2 === 0 ? '00' : '30';
      const label = `${String(hh).padStart(2, '0')}:${mm}`;
      const startIso = new Date(`${targetDate}T${label}:00+05:30`).toISOString();
      const startMs = new Date(startIso).getTime();
      const endMs = startMs + 30 * 60000;
      const endIso = new Date(endMs).toISOString();
      const overlaps = state.bookings.some(
        (b) =>
          b.charger_id === chargerId &&
          ['CONFIRMED', 'CHECKED_IN', 'CHARGING'].includes(b.status) &&
          new Date(b.start_time).getTime() < endMs &&
          new Date(b.end_time).getTime() > startMs
      );
      const inPast = endMs <= nowMs;
      const offline = found.charger.status === 'OFFLINE';
      slots.push({
        start_time: startIso,
        end_time: endIso,
        label,
        available: !overlaps && !inPast && !offline,
        reason: offline ? 'Charger offline' : overlaps ? 'Already booked' : inPast ? 'Past slot' : null,
      });
    }
    return { charger_id: chargerId, target_date: targetDate, slots };
  }

  if (method === 'POST' && cleanPath === '/bookings') {
    if (!currentUser) throwHttp(401, 'Sign in required to reserve a charging slot');
    const chargerId = Number(body.charger_id);
    const found = findCharger(state, chargerId);
    if (!found) throwHttp(404, 'Charger not found');
    if (found.charger.status === 'OFFLINE') throwHttp(409, 'Charger is currently offline');

    const startTimeIso = String(body.start_time);
    const dur = Number(body.duration_minutes || 30);
    const startMs = new Date(startTimeIso).getTime();
    const endMs = startMs + dur * 60000;
    const endIso = new Date(endMs).toISOString();

    const conflict = state.bookings.some(
      (b) =>
        b.charger_id === chargerId &&
        ['CONFIRMED', 'CHECKED_IN', 'CHARGING'].includes(b.status) &&
        new Date(b.start_time).getTime() < endMs &&
        new Date(b.end_time).getTime() > startMs
    );
    if (conflict) throwHttp(409, 'This time slot overlaps an existing reservation.');

    const vehicle = body.vehicle_id ? currentUser.vehicles.find((v) => v.id === Number(body.vehicle_id)) ?? null : null;
    const estKwh = Math.min(45, found.charger.power_kw * (dur / 60) * 0.72);
    const estCost = Math.round(Math.max(60, estKwh * found.charger.price_per_kwh));
    const bId = state.nextIds.booking++;
    const booking: StoredBooking = {
      id: bId,
      user_id: currentUser.id,
      charger_id: chargerId,
      station_id: found.station.id,
      station_name: found.station.name,
      station_area: found.station.area,
      charger_label: found.charger.label,
      connector_type: found.charger.connector_type,
      power_kw: found.charger.power_kw,
      price_per_kwh: found.charger.price_per_kwh,
      vehicle_id: vehicle ? vehicle.id : null,
      vehicle_name: vehicle ? `${vehicle.make} ${vehicle.model}` : null,
      start_time: startTimeIso,
      end_time: endIso,
      duration_minutes: dur,
      status: 'CONFIRMED',
      estimated_cost_inr: estCost,
      cancellation_fee_inr: 0,
      connector_warning:
        vehicle && vehicle.connector_type !== found.charger.connector_type
          ? `Vehicle uses ${vehicle.connector_type}, charger is ${found.charger.connector_type}`
          : null,
      qr_token: `CKQR-${bId}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      qr_used: false,
      session_id: null,
      created_at: new Date().toISOString(),
      payment_method: String(body.payment_method || 'MOCK_UPI'),
      payment_reference: `DEMO-${bId}${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    };
    state.bookings.unshift(booking);
    if (startMs - Date.now() < 30 * 60000) {
      found.charger.status = 'BOOKED';
      state.stations = state.stations.map((s) => (s.id === found.station.id ? recomputeStationAggregates(s) : s));
    }
    state.auditLogs.unshift({
      id: state.nextIds.audit++,
      user_id: currentUser.id,
      action: 'BOOKING_CREATED',
      resource_type: 'booking',
      resource_id: String(bId),
      details_json: JSON.stringify({ charger_id: chargerId, station: found.station.name }),
      ip_address: '127.0.0.1',
      correlation_id: `demo-${bId}`,
      created_at: new Date().toISOString(),
    });
    saveState(state);
    return booking;
  }

  if (method === 'GET' && cleanPath === '/bookings/mine') {
    if (!currentUser) throwHttp(401, 'Not authenticated');
    return state.bookings
      .filter((b) => b.user_id === currentUser.id)
      .sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());
  }

  const cancelMatch = cleanPath.match(/^\/bookings\/(\d+)\/cancel$/);
  if (method === 'POST' && cancelMatch) {
    if (!currentUser) throwHttp(401, 'Not authenticated');
    const bId = Number(cancelMatch[1]);
    const booking = state.bookings.find((b) => b.id === bId && (b.user_id === currentUser.id || currentUser.role === 'admin'));
    if (!booking) throwHttp(404, 'Booking not found');
    booking.status = 'CANCELLED';
    booking.cancellation_fee_inr = isFreeCancellationEligible(booking.start_time) ? 0 : 25;
    const found = findCharger(state, booking.charger_id);
    if (found && found.charger.status === 'BOOKED') {
      found.charger.status = 'FREE';
      state.stations = state.stations.map((s) => (s.id === found.station.id ? recomputeStationAggregates(s) : s));
    }
    saveState(state);
    return booking;
  }

  const reschedMatch = cleanPath.match(/^\/bookings\/(\d+)\/reschedule$/);
  if (method === 'POST' && reschedMatch) {
    if (!currentUser) throwHttp(401, 'Not authenticated');
    const bId = Number(reschedMatch[1]);
    const booking = state.bookings.find((b) => b.id === bId && b.user_id === currentUser.id);
    if (!booking) throwHttp(404, 'Booking not found');
    const newStartIso = String(body.new_start_time);
    const startMs = new Date(newStartIso).getTime();
    const endMs = startMs + booking.duration_minutes * 60000;
    const conflict = state.bookings.some(
      (b) =>
        b.id !== bId &&
        b.charger_id === booking.charger_id &&
        ['CONFIRMED', 'CHECKED_IN', 'CHARGING'].includes(b.status) &&
        new Date(b.start_time).getTime() < endMs &&
        new Date(b.end_time).getTime() > startMs
    );
    if (conflict) throwHttp(409, 'Requested reschedule time overlaps another booking');
    booking.start_time = newStartIso;
    booking.end_time = new Date(endMs).toISOString();
    saveState(state);
    return booking;
  }

  const checkinMatch = cleanPath.match(/^\/bookings\/(\d+)\/checkin$/);
  if (method === 'POST' && checkinMatch) {
    if (!currentUser) throwHttp(401, 'Not authenticated');
    const bId = Number(checkinMatch[1]);
    const booking = state.bookings.find((b) => b.id === bId && b.user_id === currentUser.id);
    if (!booking) throwHttp(404, 'Booking not found');
    if (booking.qr_used && booking.session_id) {
      const existing = state.sessions.find((s) => s.id === booking.session_id);
      if (existing) {
        return handleStaticDemoRequest('GET', `/sessions/${existing.id}`, {}, {}, authHeader);
      }
    }
    if (!body.simulate_scan && body.qr_token && body.qr_token !== booking.qr_token) {
      throwHttp(400, 'Invalid QR check-in token');
    }
    booking.qr_used = true;
    booking.status = 'CHARGING';
    const session: StoredSession = {
      id: state.nextIds.session++,
      booking_id: booking.id,
      charger_id: booking.charger_id,
      user_id: currentUser.id,
      started_at: new Date().toISOString(),
      ended_at: null,
      initial_battery_pct: 32,
      target_battery_pct: 85,
      status: 'ACTIVE',
      kwh_delivered: null,
      total_cost_inr: null,
    };
    booking.session_id = session.id;
    state.sessions.push(session);
    const found = findCharger(state, booking.charger_id);
    if (found) {
      found.charger.status = 'OCCUPIED';
      state.stations = state.stations.map((s) => (s.id === found.station.id ? recomputeStationAggregates(s) : s));
    }
    saveState(state);
    return handleStaticDemoRequest('GET', `/sessions/${session.id}`, {}, {}, authHeader);
  }

  const sessionGetMatch = cleanPath.match(/^\/sessions\/(\d+)$/);
  if (method === 'GET' && sessionGetMatch) {
    const sId = Number(sessionGetMatch[1]);
    const session = state.sessions.find((s) => s.id === sId);
    if (!session) throwHttp(404, 'Charging session not found');
    const found = findCharger(state, session.charger_id);
    const stationName = found?.station.name || 'ChargeKaro Hub';
    const chargerLabel = found?.charger.label || 'Charger 1';
    const powerKw = found?.charger.power_kw || 60;
    const price = found?.charger.price_per_kwh || 18;

    let kwh = session.kwh_delivered ?? 0;
    let currentPct = session.initial_battery_pct;
    let estRemain = 18;
    if (session.status === 'ACTIVE') {
      const elapsedHrs = ((Date.now() - new Date(session.started_at).getTime()) / 3600000) * 18;
      kwh = Number(Math.min(35, Math.max(0.25, elapsedHrs * powerKw * 0.85)).toFixed(2));
      currentPct = Number(Math.min(session.target_battery_pct, session.initial_battery_pct + (kwh / 40.5) * 100).toFixed(1));
      estRemain = Math.max(1, Math.round(((session.target_battery_pct - currentPct) / 100) * 40.5 * (60 / powerKw)));
    } else {
      currentPct = 82.0;
      estRemain = 0;
    }
    const cost = session.total_cost_inr ?? Number((kwh * price).toFixed(2));
    const stats: SessionStats = {
      id: session.id,
      booking_id: session.booking_id,
      charger_id: session.charger_id,
      station_id: found?.station.id || 1,
      station_name: stationName,
      charger_label: chargerLabel,
      power_kw: powerKw,
      price_per_kwh: price,
      started_at: session.started_at,
      ended_at: session.ended_at,
      initial_battery_pct: session.initial_battery_pct,
      current_battery_pct: currentPct,
      target_battery_pct: session.target_battery_pct,
      kwh_delivered: kwh,
      total_cost_inr: cost,
      estimated_minutes_remaining: estRemain,
      status: session.status,
    };
    return stats;
  }

  const sessionStopMatch = cleanPath.match(/^\/sessions\/(\d+)\/stop$/);
  if (method === 'POST' && sessionStopMatch) {
    const sId = Number(sessionStopMatch[1]);
    const session = state.sessions.find((s) => s.id === sId);
    if (!session) throwHttp(404, 'Charging session not found');
    const found = findCharger(state, session.charger_id);
    const booking = state.bookings.find((b) => b.id === session.booking_id);
    const stats = handleStaticDemoRequest('GET', `/sessions/${sId}`, {}, {}, authHeader) as SessionStats;

    if (session.status === 'ACTIVE') {
      session.status = 'COMPLETED';
      session.ended_at = new Date().toISOString();
      session.kwh_delivered = Math.max(1.2, stats.kwh_delivered);
      session.total_cost_inr = Number((session.kwh_delivered * stats.price_per_kwh).toFixed(2));
      if (booking) booking.status = 'COMPLETED';
      if (found) {
        found.charger.status = 'FREE';
        state.stations = state.stations.map((s) => (s.id === found.station.id ? recomputeStationAggregates(s) : s));
      }
      saveState(state);
    }

    const kwh = session.kwh_delivered ?? stats.kwh_delivered;
    const rate = stats.price_per_kwh;
    const energy = Number((kwh * rate).toFixed(2));
    const fee = 10;
    const gst = Number(((energy + fee) * 0.18).toFixed(2));
    const total = Number((energy + fee + gst).toFixed(2));
    const ownerUser = state.users.find((u) => u.id === session.user_id);

    const invoice: Invoice = {
      invoice_number: `CK-INV-${String(session.id).padStart(5, '0')}`,
      booking_id: session.booking_id,
      session_id: session.id,
      driver_name: ownerUser?.full_name || 'Demo Driver',
      station_name: found?.station.name || 'ChargeKaro Hub',
      station_address: found?.station.address || 'Delhi-NCR',
      charger_label: found?.charger.label || 'Charger 1',
      connector_type: found?.charger.connector_type || 'CCS2',
      power_kw: found?.charger.power_kw || 60,
      started_at: session.started_at,
      ended_at: session.ended_at || new Date().toISOString(),
      kwh_delivered: kwh,
      rate_per_kwh_inr: rate,
      energy_charge_inr: energy,
      platform_fee_inr: fee,
      gst_inr: gst,
      total_paid_inr: total,
      payment_method: booking?.payment_method || 'MOCK_UPI',
      payment_reference: booking?.payment_reference || `DEMO-${session.id}`,
      is_demo: true,
    };
    return invoice;
  }

  // --- AI & ROUTE ---
  const demandMatch = cleanPath.match(/^\/ai\/predict-demand\/(\d+)$/);
  if (method === 'GET' && demandMatch) {
    const st = state.stations.find((s) => s.id === Number(demandMatch[1]));
    if (!st) throwHttp(404, 'Station not found');
    return computeDemandForecast(st);
  }

  if (method === 'POST' && cleanPath === '/ai/plan-route') {
    return computeRoutePlan(state, body);
  }

  if (method === 'POST' && (cleanPath === '/ai/chat' || cleanPath === '/ai/voice-intent')) {
    const message = String(body.message || '').trim();
    const lower = message.toLowerCase();
    const lang = body.language === 'hi-IN' ? 'hi-IN' : 'en-IN';
    const confirmId = body.confirm_action_id ? String(body.confirm_action_id) : null;
    const lat = Number(body.user_lat ?? 28.6315);
    const lng = Number(body.user_lng ?? 77.2167);

    if (confirmId && state.pendingActions[confirmId]) {
      const pending = state.pendingActions[confirmId];
      delete state.pendingActions[confirmId];
      if (!currentUser) {
        saveState(state);
        return {
          reply: 'Please sign in as a Driver first so I can complete your reservation.',
          speak_text: 'Please sign in as a Driver first.',
          agent_used: 'Smart Booking Agent',
          provider: 'standalone-demo-rule',
          tool_calls: [{ tool_name: 'confirm_booking', arguments: pending.details, status: 'auth_required', summary: 'Driver sign-in required' }],
          recommendations: [],
          route_plan: null,
          pending_action: null,
          executed_booking: null,
        } satisfies AIChatResponse;
      }
      const created = handleStaticDemoRequest('POST', '/bookings', {}, pending.details, authHeader) as Booking;
      return {
        reply: `Confirmed! Reserved ${created.charger_label} at ${created.station_name} for ${created.duration_minutes} minutes.`,
        speak_text: `Booking confirmed at ${created.station_name}.`,
        agent_used: 'Smart Booking Agent',
        provider: 'standalone-demo-rule',
        tool_calls: [{ tool_name: 'create_booking', arguments: pending.details, status: 'ok', summary: `Booked #${created.id}` }],
        recommendations: [],
        route_plan: null,
        pending_action: null,
        executed_booking: created,
      } satisfies AIChatResponse;
    }

    if (lower.includes('route') || lower.includes('to ')) {
      const rp = computeRoutePlan(state, { origin: 'Connaught Place', destination: 'Cyber Hub Gurugram', battery_pct: body.battery_pct ?? 35 });
      return {
        reply: rp.summary,
        speak_text: rp.summary,
        agent_used: 'Route & Range Agent',
        provider: 'standalone-demo-rule',
        tool_calls: [{ tool_name: 'plan_ev_route', arguments: { message }, status: 'ok', summary: `Plotted ${rp.recommended_stops.length} stop(s)` }],
        recommendations: [],
        route_plan: rp,
        pending_action: null,
        executed_booking: null,
      } satisfies AIChatResponse;
    }

    if (lower.includes('book') || lower.includes('reserve')) {
      const targetStation = state.stations.find((s) => lower.includes(s.area.toLowerCase()) || lower.includes(s.name.toLowerCase())) || state.stations[0];
      const freeCharger = targetStation.chargers.find((c) => c.status === 'FREE') || targetStation.chargers[0];
      const startTime = new Date(Date.now() + 30 * 60000).toISOString();
      const actionId = `act-${Date.now()}`;
      const pending: PendingAiAction = {
        action_id: actionId,
        action_type: 'create_booking',
        summary: `Reserve ${freeCharger.label} (${freeCharger.connector_type}, ${freeCharger.power_kw} kW) at ${targetStation.name} for 30 min`,
        details: {
          charger_id: freeCharger.id,
          vehicle_id: currentUser?.vehicles?.[0]?.id ?? null,
          start_time: startTime,
          duration_minutes: 30,
          payment_method: 'MOCK_UPI',
        },
      };
      state.pendingActions[actionId] = pending;
      saveState(state);
      return {
        reply: `I found ${freeCharger.label} free at ${targetStation.name} (₹${freeCharger.price_per_kwh}/kWh). Please confirm below to lock the slot.`,
        speak_text: `Found ${freeCharger.label} at ${targetStation.name}. Confirm to reserve.`,
        agent_used: 'Smart Booking Agent',
        provider: 'standalone-demo-rule',
        tool_calls: [{ tool_name: 'stage_booking', arguments: { station: targetStation.name, charger: freeCharger.label }, status: 'ok', summary: 'Awaiting user confirmation' }],
        recommendations: [],
        route_plan: null,
        pending_action: pending,
        executed_booking: null,
      } satisfies AIChatResponse;
    }

    const wantCheapest = lower.includes('cheap') || lower.includes('sasta');
    const ranked = state.stations
      .map((s) => ({
        station: recomputeStationAggregates(s),
        dist: haversineKm(lat, lng, s.latitude, s.longitude),
      }))
      .filter((x) => x.station.free_chargers > 0)
      .sort((a, b) =>
        wantCheapest ? a.station.min_price_per_kwh - b.station.min_price_per_kwh : a.dist - b.dist
      )
      .slice(0, 3);

    const top = ranked[0];
    const reply = top
      ? lang === 'hi-IN'
        ? `${top.station.name} (${top.dist} km door) abhi sabse badhiya hai — ${top.station.free_chargers}/${top.station.total_chargers} chargers free hain, shuruat ₹${top.station.min_price_per_kwh}/kWh se.`
        : `Top match: ${top.station.name} (${top.dist} km away) has ${top.station.free_chargers}/${top.station.total_chargers} chargers free, starting at ₹${top.station.min_price_per_kwh}/kWh up to ${top.station.max_power_kw} kW.`
      : 'All nearby stations are currently busy.';

    return {
      reply,
      speak_text: reply,
      agent_used: 'Recommendation Agent',
      provider: 'standalone-demo-rule',
      tool_calls: [{ tool_name: 'search_stations', arguments: { query: message, sort: wantCheapest ? 'cheapest' : 'nearest' }, status: 'ok', summary: `Ranked ${ranked.length} Delhi-NCR stations` }],
      recommendations: ranked.map((x) => ({
        station_id: x.station.id,
        station_name: x.station.name,
        price_per_kwh: x.station.min_price_per_kwh,
        distance_km: x.dist,
      })),
      route_plan: null,
      pending_action: null,
      executed_booking: null,
    } satisfies AIChatResponse;
  }

  // --- OWNER & ADMIN ---
  if (method === 'GET' && cleanPath === '/owner/dashboard') {
    if (!currentUser || (currentUser.role !== 'owner' && currentUser.role !== 'admin')) {
      throwHttp(403, 'Owner or admin access required');
    }
    const stations = state.stations.map((s) => recomputeStationAggregates(s));
    const allChargers = stations.flatMap((s) => s.chargers);
    const activeNow = allChargers.filter((c) => c.status === 'OCCUPIED' || c.status === 'BOOKED').length;
    const revenue = state.bookings
      .filter((b) => b.status !== 'CANCELLED')
      .reduce((acc, b) => acc + b.estimated_cost_inr, 0);

    const revenue_series = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(Date.now() - (6 - i) * 86400000);
      return {
        date: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
        revenue_inr: 1400 + ((i * 530) % 2100),
      };
    });

    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const heatmap = days.map((day, dIdx) => ({
      day,
      hours: Array.from({ length: 24 }, (_, hour) => {
        let intensity = dIdx < 5 ? 24 : 32;
        if (hour >= 9 && hour <= 11) intensity += 36;
        else if (hour >= 17 && hour <= 21) intensity += 52;
        else if (hour <= 5) intensity -= 12;
        return { hour, intensity: Math.min(100, Math.max(8, intensity)) };
      }),
    }));

    return {
      kpis: {
        total_stations: stations.length,
        total_chargers: allChargers.length,
        total_bookings: state.bookings.length,
        total_revenue_inr: Math.round(revenue),
        live_utilization_pct: allChargers.length ? Math.round((activeNow / allChargers.length) * 1000) / 10 : 0,
      },
      stations,
      bookings: state.bookings.slice(0, 30),
      revenue_series,
      station_utilization: stations.map((s) => {
        const busy = s.chargers.filter((c) => c.status === 'OCCUPIED' || c.status === 'BOOKED').length;
        return {
          station_id: s.id,
          station_name: s.name,
          utilization_pct: s.chargers.length ? Math.round((busy / s.chargers.length) * 1000) / 10 : 0,
          free_count: s.free_chargers,
          total_count: s.total_chargers,
        };
      }),
      heatmap,
      demand_insights: stations.slice(0, 3).map((s) => computeDemandForecast(s)),
      monitoring_alerts: allChargers
        .filter((c) => c.status === 'OFFLINE')
        .slice(0, 4)
        .map((c) => ({
          severity: 'WARNING',
          station_name: stations.find((s) => s.id === c.station_id)?.name || 'Hub',
          charger_label: c.label,
          issue: 'OFFLINE',
          message: `${c.label} at ${stations.find((s) => s.id === c.station_id)?.name || 'Hub'} is offline and needs inspection.`,
        })),
    };
  }

  if (method === 'GET' && cleanPath === '/admin/users') {
    if (!currentUser || currentUser.role !== 'admin') throwHttp(403, 'Admin role required');
    return state.users.map(stripUser);
  }

  if (method === 'GET' && cleanPath === '/admin/audit-logs') {
    if (!currentUser || currentUser.role !== 'admin') throwHttp(403, 'Admin role required');
    return state.auditLogs;
  }

  if (method === 'GET' && cleanPath === '/admin/health') {
    if (!currentUser || currentUser.role !== 'admin') throwHttp(403, 'Admin role required');
    const chargers = state.stations.flatMap((s) => s.chargers);
    const counts: Record<string, number> = { FREE: 0, OCCUPIED: 0, BOOKED: 0, OFFLINE: 0 };
    chargers.forEach((c) => {
      counts[c.status] = (counts[c.status] || 0) + 1;
    });
    return {
      status: 'healthy',
      database: 'standalone-demo-storage',
      station_count: state.stations.length,
      charger_count: chargers.length,
      charger_status_breakdown: counts,
      ws_public_clients: 1,
      ws_private_users: 1,
      monitoring_alerts: [],
    };
  }

  if (method === 'POST' && cleanPath === '/admin/demo/rush-hour') {
    if (!currentUser || currentUser.role !== 'admin') throwHttp(403, 'Admin role required');
    let updated = 0;
    state.stations.forEach((s) => {
      s.chargers.forEach((c, idx) => {
        if (c.status === 'FREE' && idx % 2 === 1) {
          c.status = 'OCCUPIED';
          c.last_updated = new Date().toISOString();
          updated++;
        }
      });
    });
    state.stations = state.stations.map((s) => recomputeStationAggregates(s));
    saveState(state);
    return { message: `Simulated rush hour across ${updated} chargers.`, updated };
  }

  if (method === 'POST' && cleanPath === '/admin/demo/force-offline') {
    if (!currentUser || currentUser.role !== 'admin') throwHttp(403, 'Admin role required');
    const target = state.stations[0]?.chargers.find((c) => c.status !== 'OFFLINE');
    if (target) {
      target.status = 'OFFLINE';
      target.last_updated = new Date().toISOString();
      state.stations = state.stations.map((s) => recomputeStationAggregates(s));
      saveState(state);
    }
    return { message: 'Forced charger offline for monitoring & re-routing demo.', broadcasts: [] };
  }

  if (method === 'POST' && cleanPath === '/admin/demo/reset') {
    if (!currentUser || currentUser.role !== 'admin') throwHttp(403, 'Admin role required');
    resetStaticDemoState();
    return { message: 'Demo data reset to clean initial state.' };
  }

  throwHttp(404, `Demo route not found: ${method} ${cleanPath}`);
}
