export type UserRole = 'driver' | 'owner' | 'admin';

export type ConnectorType =
  | 'CCS2'
  | 'CHAdeMO'
  | 'Type 2'
  | 'Bharat AC-001'
  | 'Bharat DC-001';

export type ChargerStatus = 'FREE' | 'OCCUPIED' | 'BOOKED' | 'OFFLINE';

export type BookingStatus =
  | 'PENDING_PAYMENT'
  | 'CONFIRMED'
  | 'CHECKED_IN'
  | 'CHARGING'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW'
  | 'EXPIRED';

export interface Vehicle {
  id: number;
  make: string;
  model: string;
  registration_number: string;
  connector_type: ConnectorType;
  battery_capacity_kwh: number;
  current_battery_pct: number;
  range_km: number;
  is_default: boolean;
}

export interface User {
  id: number;
  email: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  vehicles: Vehicle[];
}

export interface Charger {
  id: number;
  station_id: number;
  label: string;
  connector_type: ConnectorType;
  power_kw: number;
  price_per_kwh: number;
  status: ChargerStatus;
  last_updated: string;
  flap_count: number;
}

export interface Station {
  id: number;
  owner_id: number;
  name: string;
  area: string;
  address: string;
  city: string;
  latitude: number;
  longitude: number;
  operator_name: string;
  opening_hours: string;
  is_24x7: boolean;
  amenities: string[];
  average_rating: number;
  is_demo: boolean;
  distance_km: number | null;
  free_chargers: number;
  total_chargers: number;
  min_price_per_kwh: number;
  max_power_kw: number;
  chargers: Charger[];
}

export interface TimeSlot {
  start_time: string;
  end_time: string;
  label: string;
  available: boolean;
  reason: string | null;
}

export interface Booking {
  id: number;
  user_id: number;
  charger_id: number;
  station_id: number;
  station_name: string;
  station_area: string;
  charger_label: string;
  connector_type: ConnectorType;
  power_kw: number;
  price_per_kwh: number;
  vehicle_id: number | null;
  vehicle_name: string | null;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  status: BookingStatus;
  estimated_cost_inr: number;
  cancellation_fee_inr: number;
  connector_warning: string | null;
  qr_token: string | null;
  qr_used: boolean;
  session_id: number | null;
  created_at: string;
}

export interface SessionStats {
  id: number;
  booking_id: number;
  charger_id: number;
  station_id: number;
  station_name: string;
  charger_label: string;
  power_kw: number;
  price_per_kwh: number;
  started_at: string;
  ended_at: string | null;
  initial_battery_pct: number;
  current_battery_pct: number;
  target_battery_pct: number;
  kwh_delivered: number;
  total_cost_inr: number;
  estimated_minutes_remaining: number;
  status: 'ACTIVE' | 'COMPLETED';
}

export interface Invoice {
  invoice_number: string;
  booking_id: number;
  session_id: number;
  driver_name: string;
  station_name: string;
  station_address: string;
  charger_label: string;
  connector_type: ConnectorType;
  power_kw: number;
  started_at: string;
  ended_at: string;
  kwh_delivered: number;
  rate_per_kwh_inr: number;
  energy_charge_inr: number;
  platform_fee_inr: number;
  gst_inr: number;
  total_paid_inr: number;
  payment_method: string;
  payment_reference: string;
  is_demo: boolean;
}

export interface HourlyDemandPoint {
  hour: number;
  label: string;
  predicted_utilization_pct: number;
  level: 'LOW' | 'MODERATE' | 'HIGH';
}

export interface DemandForecast {
  station_id: number;
  station_name: string;
  best_hour_label: string;
  peak_hour_label: string;
  hint: string;
  hourly_forecast: HourlyDemandPoint[];
}

export interface RouteStop {
  station_id: number;
  station_name: string;
  area: string;
  latitude: number;
  longitude: number;
  detour_km: number;
  progress_pct: number;
  charger_id: number;
  charger_label: string;
  connector_type: string;
  power_kw: number;
  price_per_kwh: number;
  status: ChargerStatus;
  recommended_charge_minutes: number;
}

export interface RoutePlan {
  origin: { label: string; latitude: number; longitude: number };
  destination: { label: string; latitude: number; longitude: number };
  estimated_road_km: number;
  usable_range_km: number;
  needs_charging_stop: boolean;
  recommended_stops: RouteStop[];
  polyline: [number, number][];
  summary: string;
}

export interface ToolCallTrace {
  tool_name: string;
  arguments: Record<string, unknown>;
  status: string;
  summary: string;
}

export interface PendingConfirmation {
  action_id: string;
  action_type: string;
  summary: string;
  details: Record<string, unknown>;
}

export interface AIChatResponse {
  reply: string;
  speak_text: string;
  agent_used: string;
  provider: string;
  tool_calls: ToolCallTrace[];
  recommendations: Array<Record<string, unknown>>;
  route_plan: RoutePlan | null;
  pending_action: PendingConfirmation | null;
  executed_booking: Booking | null;
}

export interface NotificationItem {
  id: number;
  title: string;
  message: string;
  type: string;
  is_read: boolean;
  created_at: string;
}

export interface AuditLogItem {
  id: number;
  user_id: number | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  details_json: string;
  ip_address: string | null;
  correlation_id: string | null;
  created_at: string;
}
