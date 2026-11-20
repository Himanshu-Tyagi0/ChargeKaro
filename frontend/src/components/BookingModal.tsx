import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Calendar, CheckCircle2, Clock, CreditCard, QrCode, Smartphone, X, Zap } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useAppStore } from '../store/useAppStore';
import type { Booking, Charger, Station, TimeSlot } from '../types';
import { formatInr, formatIstDateTime } from '../utils/stationHelpers';

interface BookingModalProps {
  station: Station;
  charger: Charger;
  onClose: () => void;
  onBooked?: (booking: Booking) => void;
}

export function BookingModal({ station, charger, onClose, onBooked }: BookingModalProps) {
  const navigate = useNavigate();
  const user = useAppStore((s) => s.user);
  const addToast = useAppStore((s) => s.addToast);

  const dateOptions = useMemo(() => {
    const list: { value: string; label: string }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(Date.now() + i * 86400000);
      const ist = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      const yyyy = ist.getFullYear();
      const mm = String(ist.getMonth() + 1).padStart(2, '0');
      const dd = String(ist.getDate()).padStart(2, '0');
      const val = `${yyyy}-${mm}-${dd}`;
      const lbl = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : ist.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
      list.push({ value: val, label: lbl });
    }
    return list;
  }, []);

  const [selectedDate, setSelectedDate] = useState(dateOptions[0].value);
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(true);
  const [selectedSlotStart, setSelectedSlotStart] = useState<string | null>(null);
  const [duration, setDuration] = useState<30 | 60 | 90>(30);
  const [vehicleId, setVehicleId] = useState<number | null>(user?.vehicles?.[0]?.id ?? null);
  const [paymentMethod, setPaymentMethod] = useState<'MOCK_UPI' | 'MOCK_CARD'>('MOCK_UPI');
  const [upiId, setUpiId] = useState('driver@demoupi');
  const [step, setStep] = useState<'slot' | 'payment' | 'confirmed'>('slot');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [confirmedBooking, setConfirmedBooking] = useState<Booking | null>(null);
  const [idempotencyKey] = useState(() => `ck-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  useEffect(() => {
    setLoadingSlots(true);
    setSelectedSlotStart(null);
    apiClient
      .get<{ slots: TimeSlot[] }>(`/bookings/availability/${charger.id}`, {
        params: { target_date: selectedDate },
      })
      .then((res) => {
        setSlots(res.data.slots);
        const firstFree = res.data.slots.find((s) => s.available);
        if (firstFree) setSelectedSlotStart(firstFree.start_time);
      })
      .catch(() => setSlots([]))
      .finally(() => setLoadingSlots(false));
  }, [charger.id, selectedDate]);

  const selectedVehicle = user?.vehicles?.find((v) => v.id === vehicleId) ?? null;
  const connectorMismatch =
    selectedVehicle && selectedVehicle.connector_type !== charger.connector_type;

  const estimatedCost = useMemo(() => {
    const estKwh = Math.min(45, charger.power_kw * (duration / 60) * 0.72);
    return Math.round(Math.max(60, estKwh * charger.price_per_kwh));
  }, [charger.power_kw, charger.price_per_kwh, duration]);

  const handleConfirmPayment = async () => {
    if (!user) {
      navigate('/auth');
      return;
    }
    if (!selectedSlotStart) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await apiClient.post<Booking>(
        '/bookings',
        {
          charger_id: charger.id,
          vehicle_id: vehicleId,
          start_time: selectedSlotStart,
          duration_minutes: duration,
          payment_method: paymentMethod,
          upi_id: paymentMethod === 'MOCK_UPI' ? upiId : undefined,
          idempotency_key: idempotencyKey,
        },
        { headers: { 'Idempotency-Key': idempotencyKey } }
      );
      setConfirmedBooking(res.data);
      setStep('confirmed');
      addToast({
        title: 'Slot Reserved',
        message: `${charger.label} at ${station.name} confirmed.`,
        variant: 'success',
      });
      onBooked?.(res.data);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Booking failed. That slot may have just been taken.';
      setErrorMsg(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSimulateCheckin = async () => {
    if (!confirmedBooking) return;
    setSubmitting(true);
    try {
      const res = await apiClient.post(`/bookings/${confirmedBooking.id}/checkin`, {
        qr_token: confirmedBooking.qr_token,
        simulate_scan: false,
      });
      onClose();
      navigate(`/session/${res.data.id}`);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Could not check in.';
      setErrorMsg(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="booking-modal-title"
    >
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
          <div>
            <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
              {station.name} · {station.area}
            </p>
            <h2 id="booking-modal-title" className="mt-1 font-display text-xl font-bold text-slate-900 dark:text-white">
              {step === 'confirmed' ? 'Booking Confirmed' : `Reserve ${charger.label}`}
            </h2>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 tabular-nums">
              {charger.connector_type} · {charger.power_kw} kW · {formatInr(charger.price_per_kwh)}/kWh
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close booking dialog"
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {!user && (
          <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-200">
            Please sign in as a Driver to complete your reservation.{' '}
            <button
              type="button"
              onClick={() => navigate('/auth')}
              className="font-semibold underline"
            >
              Go to Sign In
            </button>
          </div>
        )}

        {errorMsg && (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-rose-300 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-200">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {step === 'slot' && (
          <div className="mt-5 space-y-5">
            {/* Vehicle Selection + Compatibility Check */}
            {user && user.vehicles.length > 0 && (
              <div>
                <label htmlFor="vehicle-select" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Select EV
                </label>
                <select
                  id="vehicle-select"
                  value={vehicleId ?? ''}
                  onChange={(e) => setVehicleId(e.target.value ? Number(e.target.value) : null)}
                  className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                >
                  {user.vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.make} {v.model} ({v.connector_type} · {v.current_battery_pct}% SoC)
                    </option>
                  ))}
                </select>
                {connectorMismatch && (
                  <div className="mt-2 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>
                      Compatibility warning: {selectedVehicle?.make} {selectedVehicle?.model} uses {selectedVehicle?.connector_type}, whereas {charger.label} is {charger.connector_type}.
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Date Picker + Duration */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                  <Calendar className="h-3.5 w-3.5" /> Date (up to 7 days)
                </span>
                <select
                  aria-label="Booking date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                >
                  {dateOptions.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label} ({d.value})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                  <Clock className="h-3.5 w-3.5" /> Duration
                </span>
                <div className="mt-1.5 grid grid-cols-3 gap-2">
                  {([30, 60, 90] as const).map((dur) => (
                    <button
                      key={dur}
                      type="button"
                      onClick={() => setDuration(dur)}
                      className={`rounded-lg border px-3 py-2 text-xs font-semibold tabular-nums transition-colors ${
                        duration === dur
                          ? 'border-emerald-500 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                          : 'border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
                      }`}
                    >
                      {dur} min
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 30-Minute Slot Grid */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Available 30-Min Start Times (IST)
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  Free cancellation up to 15 min before start
                </span>
              </div>
              {loadingSlots ? (
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <div key={i} className="h-9 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800" />
                  ))}
                </div>
              ) : (
                <div className="grid max-h-52 grid-cols-4 gap-2 overflow-y-auto pr-1 sm:grid-cols-6">
                  {slots.map((slot) => {
                    const isSelected = selectedSlotStart === slot.start_time;
                    return (
                      <button
                        key={slot.start_time}
                        type="button"
                        disabled={!slot.available}
                        onClick={() => setSelectedSlotStart(slot.start_time)}
                        title={slot.reason ?? 'Available'}
                        className={`rounded-lg border px-2 py-2 font-mono text-xs font-medium tabular-nums transition-colors ${
                          !slot.available
                            ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400 line-through dark:border-slate-800 dark:bg-slate-950 dark:text-slate-600'
                            : isSelected
                              ? 'border-emerald-500 bg-emerald-500 text-slate-950 font-bold'
                              : 'border-slate-200 bg-white text-slate-800 hover:border-emerald-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:border-emerald-500'
                        }`}
                      >
                        {slot.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer Price & Next Step */}
            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 pt-4 dark:border-slate-800">
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400">Estimated Energy Hold</p>
                <p className="font-display text-xl font-bold text-slate-900 dark:text-white tabular-nums">
                  {formatInr(estimatedCost)}
                </p>
              </div>
              <button
                type="button"
                disabled={!selectedSlotStart || !user}
                onClick={() => setStep('payment')}
                className="rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Continue to Demo Checkout
              </button>
            </div>
          </div>
        )}

        {step === 'payment' && (
          <div className="mt-5 space-y-5">
            <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-200">
              Demo Payment Sandbox: No real money or real card details are collected.
            </div>

            <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-600 dark:text-slate-400">Slot Time</span>
                <span className="font-medium text-slate-900 dark:text-white tabular-nums">
                  {selectedSlotStart ? formatIstDateTime(selectedSlotStart) : '-'} ({duration} min)
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between text-sm">
                <span className="text-slate-600 dark:text-slate-400">Estimated Hold</span>
                <span className="font-display text-base font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                  {formatInr(estimatedCost)}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setPaymentMethod('MOCK_UPI')}
                className={`flex items-center justify-center gap-2 rounded-xl border p-3 text-sm font-semibold ${
                  paymentMethod === 'MOCK_UPI'
                    ? 'border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : 'border-slate-200 text-slate-700 dark:border-slate-700 dark:text-slate-300'
                }`}
              >
                <Smartphone className="h-4 w-4" /> Mock UPI
              </button>
              <button
                type="button"
                onClick={() => setPaymentMethod('MOCK_CARD')}
                className={`flex items-center justify-center gap-2 rounded-xl border p-3 text-sm font-semibold ${
                  paymentMethod === 'MOCK_CARD'
                    ? 'border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : 'border-slate-200 text-slate-700 dark:border-slate-700 dark:text-slate-300'
                }`}
              >
                <CreditCard className="h-4 w-4" /> Mock Card
              </button>
            </div>

            {paymentMethod === 'MOCK_UPI' ? (
              <div>
                <label htmlFor="demo-upi-input" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Demo UPI Handle
                </label>
                <input
                  id="demo-upi-input"
                  type="text"
                  value={upiId}
                  onChange={(e) => setUpiId(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                />
              </div>
            ) : (
              <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                Using pre-authorized demo card token •••• 4242 (no card input stored).
              </p>
            )}

            <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setStep('slot')}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Back
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleConfirmPayment}
                className="rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
              >
                {submitting ? 'Reserving Slot...' : `Pay ${formatInr(estimatedCost)} & Reserve`}
              </button>
            </div>
          </div>
        )}

        {step === 'confirmed' && confirmedBooking && (
          <div className="mt-5 space-y-5 text-center">
            <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-500">
              <CheckCircle2 className="h-7 w-7" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-white">
                Booking #{confirmedBooking.id} Confirmed
              </p>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                {formatIstDateTime(confirmedBooking.start_time)} · {confirmedBooking.duration_minutes} min
              </p>
            </div>

            {confirmedBooking.qr_token && (
              <div className="mx-auto inline-flex flex-col items-center rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700">
                <QRCodeSVG value={confirmedBooking.qr_token} size={156} />
                <span className="mt-2 inline-flex items-center gap-1 font-mono text-[11px] text-slate-600">
                  <QrCode className="h-3.5 w-3.5" /> Signed Single-Use Check-In Pass
                </span>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              <button
                type="button"
                disabled={submitting}
                onClick={handleSimulateCheckin}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400"
              >
                <Zap className="h-4 w-4" />
                <span>Simulate QR Scan &amp; Start Charging</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  navigate('/bookings');
                }}
                className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                View My Bookings
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
