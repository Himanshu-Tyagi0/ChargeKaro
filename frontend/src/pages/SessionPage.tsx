import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, BatteryCharging, CheckCircle2, Printer, StopCircle, Zap } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useAppStore } from '../store/useAppStore';
import type { Invoice, SessionStats } from '../types';
import { formatInr, formatIstDateTime } from '../utils/stationHelpers';

export function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const addToast = useAppStore((s) => s.addToast);

  const [session, setSession] = useState<SessionStats | null>(null);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [stopping, setStopping] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchSession = useCallback(async () => {
    if (!id) return;
    try {
      const res = await apiClient.get<SessionStats>(`/sessions/${id}`);
      setSession(res.data);
    } catch {
      // Ignore transient poll error
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  useEffect(() => {
    if (!session || session.status !== 'ACTIVE') return;
    const timer = window.setInterval(fetchSession, 1500);
    return () => window.clearInterval(timer);
  }, [fetchSession, session?.status]);

  const handleStopSession = async () => {
    if (!id) return;
    setStopping(true);
    try {
      const res = await apiClient.post<Invoice>(`/sessions/${id}/stop`);
      setInvoice(res.data);
      await fetchSession();
      addToast({
        title: 'Charging Stopped',
        message: `Delivered ${res.data.kwh_delivered} kWh · Charger returned to FREE.`,
        variant: 'success',
      });
    } catch {
      addToast({ title: 'Stop Failed', message: 'Could not stop session.', variant: 'error' });
    } finally {
      setStopping(false);
    }
  };

  if (loading) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <div className="h-72 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
      </main>
    );
  }

  if (!session) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12 text-center">
        <p className="text-base font-semibold text-slate-900 dark:text-white">Charging session not found</p>
        <Link to="/bookings" className="mt-3 inline-block text-sm font-medium text-emerald-500 hover:underline">
          Back to My Bookings
        </Link>
      </main>
    );
  }

  const pct = Math.min(100, Math.max(0, session.current_battery_pct));
  const radius = 64;
  const circumference = 2 * Math.PI * radius;
  const strokeOffset = circumference - (pct / 100) * circumference;

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
      <div className="no-print">
        <Link
          to="/bookings"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span>Back to My Bookings</span>
        </Link>
      </div>

      {/* Live Telemetry Card */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 dark:border-slate-800 dark:bg-slate-900 no-print">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
          <div>
            <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              {session.status === 'ACTIVE' ? 'Live Charging Telemetry' : 'Session Completed'}
            </p>
            <h1 className="mt-1 font-display text-2xl font-bold text-slate-900 dark:text-white">
              {session.station_name} · {session.charger_label}
            </h1>
          </div>
          <span className="font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums">
            {session.power_kw} kW · {formatInr(session.price_per_kwh)}/kWh
          </span>
        </div>

        <div className="mt-6 grid grid-cols-1 items-center gap-8 sm:grid-cols-12">
          {/* SVG Radial Battery Gauge */}
          <div className="flex flex-col items-center justify-center sm:col-span-5">
            <div className="relative h-44 w-44">
              <svg className="h-full w-full -rotate-90" viewBox="0 0 160 160">
                <circle
                  cx="80"
                  cy="80"
                  r={radius}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="12"
                  className="text-slate-200 dark:text-slate-800"
                />
                <circle
                  cx="80"
                  cy="80"
                  r={radius}
                  fill="none"
                  stroke="#10B981"
                  strokeWidth="12"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeOffset}
                  className="transition-all duration-700"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <BatteryCharging className="h-5 w-5 text-emerald-500" aria-hidden="true" />
                <span className="mt-1 font-mono text-3xl font-bold text-slate-900 dark:text-white tabular-nums">
                  {pct.toFixed(1)}%
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  Target {session.target_battery_pct}%
                </span>
              </div>
            </div>
          </div>

          {/* Live Counters */}
          <div className="grid grid-cols-2 gap-4 sm:col-span-7">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
              <div className="text-xs text-slate-500 dark:text-slate-400">Energy Delivered</div>
              <div className="mt-1 font-mono text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
                {session.kwh_delivered.toFixed(2)} kWh
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
              <div className="text-xs text-slate-500 dark:text-slate-400">Cost So Far</div>
              <div className="mt-1 font-mono text-2xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                {formatInr(session.total_cost_inr)}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
              <div className="text-xs text-slate-500 dark:text-slate-400">Est. Time Left</div>
              <div className="mt-1 font-mono text-xl font-bold text-slate-900 dark:text-white tabular-nums">
                {session.estimated_minutes_remaining} min
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
              <div className="text-xs text-slate-500 dark:text-slate-400">Started At</div>
              <div className="mt-1 text-xs font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
                {formatIstDateTime(session.started_at)}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 pt-5 dark:border-slate-800">
          {session.status === 'ACTIVE' ? (
            <button
              type="button"
              disabled={stopping}
              onClick={handleStopSession}
              className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
            >
              <StopCircle className="h-4 w-4" aria-hidden="true" />
              <span>{stopping ? 'Stopping...' : 'Stop Charging & Generate Invoice'}</span>
            </button>
          ) : (
            !invoice && (
              <button
                type="button"
                onClick={handleStopSession}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400"
              >
                <Zap className="h-4 w-4" aria-hidden="true" />
                <span>Load Printable Invoice</span>
              </button>
            )
          )}
        </div>
      </section>

      {/* Printable Invoice */}
      {invoice && (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
            <div>
              <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                <span>Demo Tax Invoice</span>
              </div>
              <h2 className="mt-1 font-display text-xl font-bold text-slate-900 dark:text-white">
                {invoice.invoice_number}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Driver: {invoice.driver_name} · Ref: {invoice.payment_reference}
              </p>
            </div>
            <button
              type="button"
              onClick={() => window.print()}
              className="no-print inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Printer className="h-4 w-4" aria-hidden="true" />
              <span>Print / Save PDF</span>
            </button>
          </div>

          <div className="mt-4 space-y-2 text-sm tabular-nums">
            <div className="flex justify-between">
              <span className="text-slate-600 dark:text-slate-400">Station</span>
              <span className="font-medium text-slate-900 dark:text-white">
                {invoice.station_name} ({invoice.charger_label})
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600 dark:text-slate-400">Energy Delivered</span>
              <span className="font-mono text-slate-900 dark:text-white">
                {invoice.kwh_delivered} kWh @ {formatInr(invoice.rate_per_kwh_inr)}/kWh
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600 dark:text-slate-400">Energy Charge</span>
              <span className="font-mono text-slate-900 dark:text-white">{formatInr(invoice.energy_charge_inr)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600 dark:text-slate-400">Platform Convenience Fee</span>
              <span className="font-mono text-slate-900 dark:text-white">{formatInr(invoice.platform_fee_inr)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600 dark:text-slate-400">GST (18%)</span>
              <span className="font-mono text-slate-900 dark:text-white">{formatInr(invoice.gst_inr)}</span>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-3 text-base font-bold dark:border-slate-800">
              <span className="text-slate-900 dark:text-white">Total Demo Paid ({invoice.payment_method})</span>
              <span className="font-mono text-emerald-600 dark:text-emerald-400">{formatInr(invoice.total_paid_inr)}</span>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
