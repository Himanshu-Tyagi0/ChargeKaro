import { useCallback, useEffect, useState } from 'react';
import { Calendar, Clock, QrCode, RefreshCw, XCircle, Zap } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { Link, useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useAppStore } from '../store/useAppStore';
import type { Booking } from '../types';
import { formatInr, formatIstDateTime, isFreeCancellationEligible } from '../utils/stationHelpers';

export function BookingsPage() {
  const navigate = useNavigate();
  const user = useAppStore((s) => s.user);
  const addToast = useAppStore((s) => s.addToast);

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'upcoming' | 'active' | 'past'>('upcoming');
  const [qrModalBooking, setQrModalBooking] = useState<Booking | null>(null);
  const [manualQrInput, setManualQrInput] = useState('');
  const [rescheduleTarget, setRescheduleTarget] = useState<Booking | null>(null);
  const [newTimeLocal, setNewTimeLocal] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);

  const loadBookings = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await apiClient.get<Booking[]>('/bookings/mine');
      setBookings(res.data);
    } catch {
      addToast({ title: 'Load Error', message: 'Could not load your bookings.', variant: 'error' });
    } finally {
      setLoading(false);
    }
  }, [addToast, user]);

  useEffect(() => {
    loadBookings();
  }, [loadBookings]);

  const handleCancel = async (b: Booking) => {
    setBusyId(b.id);
    try {
      await apiClient.post(`/bookings/${b.id}/cancel`);
      const free = isFreeCancellationEligible(b.start_time);
      addToast({
        title: 'Booking Cancelled',
        message: free ? 'Free cancellation applied.' : 'Late cancellation fee ₹25 applied.',
        variant: 'info',
      });
      await loadBookings();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Cancel failed.';
      addToast({ title: 'Cannot Cancel', message: msg, variant: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  const handleCheckIn = async (b: Booking, simulateScan: boolean, qrToken?: string) => {
    setBusyId(b.id);
    try {
      const res = await apiClient.post(`/bookings/${b.id}/checkin`, {
        simulate_scan: simulateScan,
        qr_token: qrToken || undefined,
      });
      setQrModalBooking(null);
      navigate(`/session/${res.data.id}`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Check-in failed.';
      addToast({ title: 'Check-In Failed', message: msg, variant: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  const handleReschedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rescheduleTarget || !newTimeLocal) return;
    setBusyId(rescheduleTarget.id);
    try {
      await apiClient.post(`/bookings/${rescheduleTarget.id}/reschedule`, {
        new_start_time: new Date(newTimeLocal).toISOString(),
      });
      addToast({ title: 'Booking Rescheduled', message: 'Your time slot has been updated.', variant: 'success' });
      setRescheduleTarget(null);
      await loadBookings();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Reschedule failed.';
      addToast({ title: 'Slot Unavailable', message: msg, variant: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  if (!user) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12 text-center">
        <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">Sign in to view your bookings</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          Use the Demo Driver account on the Sign In page to inspect upcoming QR passes and charging history.
        </p>
        <Link
          to="/auth"
          className="mt-5 inline-flex rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400"
        >
          Sign In
        </Link>
      </main>
    );
  }

  const upcoming = bookings.filter((b) => ['CONFIRMED', 'PENDING_PAYMENT'].includes(b.status));
  const active = bookings.filter((b) => ['CHECKED_IN', 'CHARGING'].includes(b.status));
  const past = bookings.filter((b) => ['COMPLETED', 'CANCELLED', 'NO_SHOW', 'EXPIRED'].includes(b.status));

  const visibleList = tab === 'upcoming' ? upcoming : tab === 'active' ? active : past;

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-slate-900 dark:text-white">My Bookings</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Free cancellation up to 15 min before start. Unchecked slots release automatically after 10 min.
          </p>
        </div>

        {/* Segmented Tabs */}
        <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-900">
          <button
            type="button"
            onClick={() => setTab('upcoming')}
            className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
              tab === 'upcoming'
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Upcoming ({upcoming.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('active')}
            className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
              tab === 'active'
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Active ({active.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('past')}
            className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
              tab === 'past'
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Past ({past.length})
          </button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />
          ))}
        </div>
      ) : visibleList.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-slate-900">
          <p className="text-base font-semibold text-slate-900 dark:text-white">No {tab} bookings</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Find an available fast charger on the live map and lock in a 30-minute slot.
          </p>
          <Link
            to="/map"
            className="mt-4 inline-flex rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
          >
            Browse Stations
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleList.map((b) => {
            const freeCancel = isFreeCancellationEligible(b.start_time);
            return (
              <div
                key={b.id}
                className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-center dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">#{b.id}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">{b.status}</span>
                    <span aria-hidden="true">·</span>
                    <span>{b.connector_type} ({b.power_kw} kW)</span>
                    {b.vehicle_name && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{b.vehicle_name}</span>
                      </>
                    )}
                  </div>
                  <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                    {b.station_name} — {b.charger_label}
                  </h2>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 dark:text-slate-300 tabular-nums">
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                      {formatIstDateTime(b.start_time)}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                      {b.duration_minutes} min
                    </span>
                    <span className="font-semibold text-slate-900 dark:text-white">
                      Est. {formatInr(b.estimated_cost_inr)}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {b.status === 'CONFIRMED' && (
                    <>
                      <button
                        type="button"
                        disabled={busyId === b.id}
                        onClick={() => handleCheckIn(b, true)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 whitespace-nowrap"
                      >
                        <Zap className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Simulate Scan &amp; Charge</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setQrModalBooking(b);
                          setManualQrInput(b.qr_token || '');
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
                      >
                        <QrCode className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>QR Pass</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRescheduleTarget(b);
                          setNewTimeLocal(new Date(Date.now() + 3600000).toISOString().slice(0, 16));
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
                      >
                        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Reschedule</span>
                      </button>
                      <button
                        type="button"
                        disabled={busyId === b.id}
                        onClick={() => handleCancel(b)}
                        title={freeCancel ? 'Free cancellation' : 'Late cancellation fee ₹25'}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-2 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:border-rose-900/60 dark:text-rose-400 dark:hover:bg-rose-950/40 whitespace-nowrap"
                      >
                        <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>{freeCancel ? 'Cancel (Free)' : 'Cancel (₹25)'}</span>
                      </button>
                    </>
                  )}

                  {b.status === 'CHARGING' && b.session_id && (
                    <Link
                      to={`/session/${b.session_id}`}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400 whitespace-nowrap"
                    >
                      <Zap className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Open Live Session</span>
                    </Link>
                  )}

                  {b.status === 'COMPLETED' && b.session_id && (
                    <Link
                      to={`/session/${b.session_id}`}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
                    >
                      View Session Summary
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* QR Check-In Modal */}
      {qrModalBooking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
              Station Check-In QR Pass
            </h2>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
              {qrModalBooking.station_name} · {qrModalBooking.charger_label}
            </p>
            {qrModalBooking.qr_token && (
              <div className="my-5 flex justify-center rounded-xl bg-white p-4">
                <QRCodeSVG value={qrModalBooking.qr_token} size={172} />
              </div>
            )}
            <label htmlFor="qr-token-input" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Signed QR Token (Single-Use)
            </label>
            <input
              id="qr-token-input"
              type="text"
              value={manualQrInput}
              onChange={(e) => setManualQrInput(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setQrModalBooking(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => handleCheckIn(qrModalBooking, false, manualQrInput)}
                className="rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
              >
                Verify Token &amp; Start
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reschedule Modal */}
      {rescheduleTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4" role="dialog" aria-modal="true">
          <form
            onSubmit={handleReschedule}
            className="w-full max-w-md space-y-4 rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900"
          >
            <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
              Reschedule Booking #{rescheduleTarget.id}
            </h2>
            <div>
              <label htmlFor="reschedule-dt" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                New Start Time
              </label>
              <input
                id="reschedule-dt"
                type="datetime-local"
                required
                value={newTimeLocal}
                onChange={(e) => setNewTimeLocal(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRescheduleTarget(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busyId === rescheduleTarget.id}
                className="rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
              >
                Confirm New Time
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
