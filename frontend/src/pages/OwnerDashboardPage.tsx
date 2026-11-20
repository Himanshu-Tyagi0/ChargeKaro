import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, BarChart3, Plus, Wrench } from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { StatusBadge } from '../components/StatusBadge';
import { useAppStore } from '../store/useAppStore';
import type { Booking, ChargerStatus, ConnectorType, DemandForecast, Station } from '../types';
import { formatInr, formatIstDateTime } from '../utils/stationHelpers';

interface OwnerDashboardPayload {
  kpis: {
    total_stations: number;
    total_chargers: number;
    total_bookings: number;
    total_revenue_inr: number;
    live_utilization_pct: number;
  };
  stations: Station[];
  bookings: Booking[];
  revenue_series: { date: string; revenue_inr: number }[];
  station_utilization: { station_id: number; station_name: string; utilization_pct: number; free_count: number; total_count: number }[];
  heatmap: { day: string; hours: { hour: number; intensity: number }[] }[];
  demand_insights: DemandForecast[];
  monitoring_alerts: { severity: string; station_name: string; charger_label: string; issue: string; message: string }[];
}

export function OwnerDashboardPage() {
  const user = useAppStore((s) => s.user);
  const addToast = useAppStore((s) => s.addToast);

  const [data, setData] = useState<OwnerDashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddStation, setShowAddStation] = useState(false);
  const [newStationName, setNewStationName] = useState('');
  const [newStationArea, setNewStationArea] = useState('');
  const [newStationAddr, setNewStationAddr] = useState('');
  const [newChargerStationId, setNewChargerStationId] = useState<number | null>(null);
  const [newChargerLabel, setNewChargerLabel] = useState('Charger New');
  const [newChargerConnector, setNewChargerConnector] = useState<ConnectorType>('CCS2');
  const [newChargerPower, setNewChargerPower] = useState(60);
  const [newChargerPrice, setNewChargerPrice] = useState(18);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<OwnerDashboardPayload>('/owner/dashboard');
      setData(res.data);
    } catch {
      addToast({ title: 'Access Denied', message: 'Owner or Admin account required.', variant: 'error' });
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    if (user && (user.role === 'owner' || user.role === 'admin')) {
      loadDashboard();
    } else {
      setLoading(false);
    }
  }, [loadDashboard, user]);

  const handleToggleMaintenance = async (chargerId: number, currentStatus: ChargerStatus) => {
    const nextStatus: ChargerStatus = currentStatus === 'OFFLINE' ? 'FREE' : 'OFFLINE';
    try {
      await apiClient.patch(`/chargers/${chargerId}`, { status: nextStatus });
      addToast({ title: 'Charger Updated', message: `Status set to ${nextStatus}.`, variant: 'info' });
      await loadDashboard();
    } catch {
      addToast({ title: 'Update Failed', message: 'Could not change charger status.', variant: 'error' });
    }
  };

  const handleUpdatePrice = async (chargerId: number, currentPrice: number) => {
    const nextPrice = currentPrice >= 22 ? 15 : currentPrice + 2;
    try {
      await apiClient.patch(`/chargers/${chargerId}`, { price_per_kwh: nextPrice });
      addToast({ title: 'Pricing Updated', message: `Tariff set to ₹${nextPrice}/kWh.`, variant: 'success' });
      await loadDashboard();
    } catch {
      addToast({ title: 'Update Failed', message: 'Could not update tariff.', variant: 'error' });
    }
  };

  const handleCreateStation = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiClient.post('/stations', {
        name: newStationName,
        area: newStationArea,
        address: newStationAddr,
        latitude: 28.625,
        longitude: 77.215,
        operator_name: user?.full_name || 'ChargeKaro Partner',
        amenities: ['Parking', 'Wi-Fi'],
      });
      setShowAddStation(false);
      setNewStationName('');
      setNewStationArea('');
      setNewStationAddr('');
      addToast({ title: 'Station Added', message: 'New charging hub is live.', variant: 'success' });
      await loadDashboard();
    } catch {
      addToast({ title: 'Create Failed', message: 'Verify station details and try again.', variant: 'error' });
    }
  };

  const handleAddCharger = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChargerStationId) return;
    try {
      await apiClient.post(`/stations/${newChargerStationId}/chargers`, {
        label: newChargerLabel,
        connector_type: newChargerConnector,
        power_kw: newChargerPower,
        price_per_kwh: newChargerPrice,
      });
      setNewChargerStationId(null);
      addToast({ title: 'Charger Added', message: `${newChargerLabel} commissioned.`, variant: 'success' });
      await loadDashboard();
    } catch {
      addToast({ title: 'Add Charger Failed', message: 'Check values and retry.', variant: 'error' });
    }
  };

  if (!user || (user.role !== 'owner' && user.role !== 'admin')) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12 text-center">
        <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">Station Owner Portal</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          Please sign in with the Demo Station Owner account (owner@chargekaro.demo) to manage stations and view AI demand insights.
        </p>
        <Link to="/auth" className="mt-5 inline-flex rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-slate-950">
          Go to Sign In
        </Link>
      </main>
    );
  }

  if (loading || !data) {
    return (
      <main className="mx-auto max-w-[1440px] space-y-4 px-4 py-8 sm:px-6">
        <div className="h-28 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
        <div className="h-72 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
      </main>
    );
  }

  const maxRev = Math.max(100, ...data.revenue_series.map((r) => r.revenue_inr));

  return (
    <main className="mx-auto max-w-[1440px] space-y-6 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-slate-900 dark:text-white">
            Station Owner Dashboard
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Manage chargers, dynamic pricing, maintenance overrides, peak heatmaps, and AI demand forecasts.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAddStation((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 whitespace-nowrap shrink-0"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span>Add Station</span>
        </button>
      </div>

      {/* Add Station Form */}
      {showAddStation && (
        <form
          onSubmit={handleCreateStation}
          className="grid grid-cols-1 gap-3 rounded-2xl border border-slate-200 bg-white p-5 sm:grid-cols-4 dark:border-slate-800 dark:bg-slate-900"
        >
          <input
            type="text"
            required
            placeholder="Station Name"
            value={newStationName}
            onChange={(e) => setNewStationName(e.target.value)}
            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          />
          <input
            type="text"
            required
            placeholder="Area (e.g. Janakpuri)"
            value={newStationArea}
            onChange={(e) => setNewStationArea(e.target.value)}
            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          />
          <input
            type="text"
            required
            placeholder="Street Address"
            value={newStationAddr}
            onChange={(e) => setNewStationAddr(e.target.value)}
            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          />
          <button
            type="submit"
            className="rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400"
          >
            Create Hub
          </button>
        </form>
      )}

      {/* KPI Row */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">Stations / Chargers</p>
          <p className="mt-1 font-mono text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
            {data.kpis.total_stations} / {data.kpis.total_chargers}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">Total Bookings</p>
          <p className="mt-1 font-mono text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
            {data.kpis.total_bookings}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">Demo Revenue</p>
          <p className="mt-1 font-mono text-2xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
            {formatInr(data.kpis.total_revenue_inr)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">Live Grid Utilization</p>
          <p className="mt-1 font-mono text-2xl font-bold text-sky-600 dark:text-sky-400 tabular-nums">
            {data.kpis.live_utilization_pct}%
          </p>
        </div>
      </section>

      {/* Monitoring Alerts */}
      {data.monitoring_alerts.length > 0 && (
        <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800/70 dark:bg-amber-950/30">
          <div className="flex items-center gap-2 text-xs font-bold text-amber-900 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            <span>Monitoring Agent Alerts ({data.monitoring_alerts.length})</span>
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {data.monitoring_alerts.slice(0, 4).map((a, idx) => (
              <div key={idx} className="rounded-lg border border-amber-200 bg-white/80 p-2.5 text-xs text-amber-950 dark:border-amber-900/60 dark:bg-slate-950/60 dark:text-amber-200">
                <span className="font-semibold">{a.severity}</span> · {a.message}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Charts Row: Revenue + Utilization */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">7-Day Revenue Trend (INR)</h2>
          <div className="mt-5 flex h-44 items-end gap-3">
            {data.revenue_series.map((pt) => (
              <div key={pt.date} className="flex flex-1 flex-col items-center gap-1.5">
                <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
                  {pt.revenue_inr > 0 ? `₹${pt.revenue_inr}` : '₹0'}
                </span>
                <div className="flex h-28 w-full items-end">
                  <div
                    className="w-full rounded-t-md bg-emerald-500/90"
                    style={{ height: `${Math.max(8, (pt.revenue_inr / maxRev) * 100)}%` }}
                  />
                </div>
                <span className="text-[11px] text-slate-600 dark:text-slate-400">{pt.date}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">Live Station Utilization</h2>
          <div className="mt-4 max-h-48 space-y-2.5 overflow-y-auto pr-1">
            {data.station_utilization.map((u) => (
              <div key={u.station_id}>
                <div className="flex justify-between text-xs">
                  <span className="font-medium text-slate-800 dark:text-slate-200">{u.station_name}</span>
                  <span className="font-mono text-slate-600 dark:text-slate-400 tabular-nums">
                    {u.utilization_pct}% ({u.free_count}/{u.total_count} free)
                  </span>
                </div>
                <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                  <div
                    className="h-full rounded-full bg-sky-500"
                    style={{ width: `${Math.max(4, u.utilization_pct)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Peak Hour Heatmap + AI Demand Insights */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 lg:col-span-7 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
            Weekly Peak Hour Heatmap (IST)
          </h2>
          <div className="mt-4 space-y-1.5 overflow-x-auto">
            {data.heatmap.map((row) => (
              <div key={row.day} className="flex items-center gap-1.5">
                <span className="w-8 shrink-0 font-mono text-[11px] text-slate-500 dark:text-slate-400">{row.day}</span>
                <div className="flex flex-1 gap-1">
                  {row.hours.map((cell) => {
                    const bg =
                      cell.intensity >= 72
                        ? 'bg-emerald-500'
                        : cell.intensity >= 48
                          ? 'bg-emerald-500/60'
                          : cell.intensity >= 28
                            ? 'bg-emerald-500/30'
                            : 'bg-slate-200 dark:bg-slate-800';
                    return (
                      <div
                        key={cell.hour}
                        title={`${row.day} ${cell.hour}:00 IST — ${cell.intensity}% load`}
                        className={`h-5 min-w-[10px] flex-1 rounded-sm ${bg}`}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 lg:col-span-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2 text-xs font-semibold text-sky-600 dark:text-sky-400">
            <BarChart3 className="h-4 w-4" aria-hidden="true" />
            <span>AI Demand Insights (Ridge Forecast)</span>
          </div>
          <div className="mt-3 space-y-3">
            {data.demand_insights.map((ins) => (
              <div key={ins.station_id} className="rounded-xl border border-slate-200 p-3 text-xs dark:border-slate-800">
                <div className="font-bold text-slate-900 dark:text-white">{ins.station_name}</div>
                <p className="mt-1 text-slate-600 dark:text-slate-300">{ins.hint}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Station & Charger Management Table */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
            Chargers, Pricing &amp; Maintenance Controls
          </h2>
        </div>

        {newChargerStationId && (
          <form
            onSubmit={handleAddCharger}
            className="mt-4 grid grid-cols-1 gap-2 rounded-xl border border-sky-300 bg-sky-50/60 p-4 sm:grid-cols-5 dark:border-sky-800 dark:bg-sky-950/30"
          >
            <input
              type="text"
              required
              value={newChargerLabel}
              onChange={(e) => setNewChargerLabel(e.target.value)}
              placeholder="Label"
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950"
            />
            <select
              value={newChargerConnector}
              onChange={(e) => setNewChargerConnector(e.target.value as ConnectorType)}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950"
            >
              <option value="CCS2">CCS2</option>
              <option value="CHAdeMO">CHAdeMO</option>
              <option value="Type 2">Type 2</option>
              <option value="Bharat DC-001">Bharat DC-001</option>
            </select>
            <input
              type="number"
              value={newChargerPower}
              onChange={(e) => setNewChargerPower(Number(e.target.value))}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950"
            />
            <input
              type="number"
              value={newChargerPrice}
              onChange={(e) => setNewChargerPrice(Number(e.target.value))}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950"
            />
            <div className="flex gap-2">
              <button type="submit" className="flex-1 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-slate-950">
                Save
              </button>
              <button
                type="button"
                onClick={() => setNewChargerStationId(null)}
                className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs dark:border-slate-700"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        <div className="mt-4 space-y-4">
          {data.stations.slice(0, 6).map((st) => (
            <div key={st.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
                <div>
                  <span className="font-display text-sm font-bold text-slate-900 dark:text-white">{st.name}</span>
                  <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">{st.area}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setNewChargerStationId(st.id)}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:border-emerald-500 dark:border-slate-700 dark:text-slate-200"
                >
                  <Plus className="h-3.5 w-3.5" /> Add Charger
                </button>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {st.chargers.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 p-2.5 text-xs dark:border-slate-800 dark:bg-slate-950"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-900 dark:text-white">{c.label}</span>
                        <StatusBadge status={c.status} compact />
                      </div>
                      <div className="mt-1 font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                        {c.power_kw} kW · ₹{c.price_per_kwh}/kWh
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <button
                        type="button"
                        onClick={() => handleUpdatePrice(c.id, c.price_per_kwh)}
                        className="rounded border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-white dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        Tariff +₹2
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleMaintenance(c.id, c.status)}
                        className="inline-flex items-center justify-center gap-1 rounded border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-white dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        <Wrench className="h-3 w-3" />
                        <span>{c.status === 'OFFLINE' ? 'Restore' : 'Maint.'}</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Recent Bookings Table */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">Recent Station Bookings</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
              <tr>
                <th className="py-2 pr-4 font-semibold">ID</th>
                <th className="py-2 pr-4 font-semibold">Station &amp; Charger</th>
                <th className="py-2 pr-4 font-semibold">Start Time (IST)</th>
                <th className="py-2 pr-4 font-semibold">Status</th>
                <th className="py-2 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 tabular-nums">
              {data.bookings.slice(0, 12).map((b) => (
                <tr key={b.id}>
                  <td className="py-2.5 pr-4 font-mono text-slate-600 dark:text-slate-400">#{b.id}</td>
                  <td className="py-2.5 pr-4 font-medium text-slate-900 dark:text-white">
                    {b.station_name} · {b.charger_label}
                  </td>
                  <td className="py-2.5 pr-4 text-slate-600 dark:text-slate-300">{formatIstDateTime(b.start_time)}</td>
                  <td className="py-2.5 pr-4 font-semibold text-emerald-600 dark:text-emerald-400">{b.status}</td>
                  <td className="py-2.5 text-right font-mono font-semibold text-slate-900 dark:text-white">
                    {formatInr(b.estimated_cost_inr)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
