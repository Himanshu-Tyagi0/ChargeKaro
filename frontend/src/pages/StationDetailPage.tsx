import { useEffect, useState } from 'react';
import { ArrowLeft, BarChart3, Clock, MapPin, Star, Zap } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { apiClient } from '../api/client';
import { BookingModal } from '../components/BookingModal';
import { StatusBadge } from '../components/StatusBadge';
import { useAppStore } from '../store/useAppStore';
import type { Charger, DemandForecast, Station } from '../types';
import { formatInr } from '../utils/stationHelpers';

export function StationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const userLocation = useAppStore((s) => s.userLocation);
  const storeStations = useAppStore((s) => s.stations);

  const [station, setStation] = useState<Station | null>(null);
  const [forecast, setForecast] = useState<DemandForecast | null>(null);
  const [loading, setLoading] = useState(true);
  const [bookingCharger, setBookingCharger] = useState<Charger | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      apiClient.get<Station>(`/stations/${id}`, { params: { lat: userLocation[0], lng: userLocation[1] } }),
      apiClient.get<DemandForecast>(`/ai/predict-demand/${id}`),
    ])
      .then(([stRes, demRes]) => {
        setStation(stRes.data);
        setForecast(demRes.data);
      })
      .finally(() => setLoading(false));
  }, [id, userLocation]);

  // Sync live WebSocket updates from store if available
  const liveStation = storeStations.find((s) => s.id === Number(id)) || station;

  if (loading) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="h-48 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
      </main>
    );
  }

  if (!liveStation) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-12 text-center">
        <p className="text-base font-semibold text-slate-900 dark:text-white">Station not found</p>
        <Link to="/map" className="mt-3 inline-block text-sm font-medium text-emerald-500 hover:underline">
          Back to Live Map
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
      <Link
        to="/map"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        <span>Back to Live Map</span>
      </Link>

      {/* Station Header Card */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
              {liveStation.operator_name} · {liveStation.area}
            </p>
            <h1 className="mt-1 font-display text-2xl font-extrabold text-slate-900 sm:text-3xl dark:text-white">
              {liveStation.name}
            </h1>
            <p className="mt-1 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
              <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{liveStation.address}</span>
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-600 dark:text-slate-300">
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" aria-hidden="true" /> {liveStation.opening_hours}
              </span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1 tabular-nums">
                <Star className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" /> {liveStation.average_rating}
              </span>
              <span aria-hidden="true">·</span>
              <span>Amenities: {liveStation.amenities.join(', ')}</span>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-right dark:border-slate-800 dark:bg-slate-950">
            <div className="text-xs text-slate-500 dark:text-slate-400">Live Availability</div>
            <div className="mt-0.5 font-mono text-2xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
              {liveStation.free_chargers}/{liveStation.total_chargers}
            </div>
          </div>
        </div>
      </section>

      {/* Individual Chargers Grid */}
      <section aria-label="Station chargers" className="space-y-3">
        <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
          Individual Chargers
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {liveStation.chargers.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
            >
              <div>
                <div className="flex items-center gap-2.5">
                  <span className="font-display text-base font-bold text-slate-900 dark:text-white">{c.label}</span>
                  <StatusBadge status={c.status} />
                </div>
                <p className="mt-1.5 font-mono text-xs text-slate-600 dark:text-slate-400 tabular-nums">
                  {c.connector_type} · {c.power_kw} kW · {formatInr(c.price_per_kwh)}/kWh
                </p>
              </div>

              <button
                type="button"
                disabled={c.status === 'OFFLINE'}
                onClick={() => setBookingCharger(c)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40 whitespace-nowrap shrink-0"
              >
                <Zap className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Book Slot</span>
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* AI Demand Prediction Chart */}
      {forecast && (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold text-sky-600 dark:text-sky-400">
                <BarChart3 className="h-4 w-4" aria-hidden="true" />
                <span>AI Demand Prediction Agent</span>
              </div>
              <h2 className="mt-1 font-display text-lg font-bold text-slate-900 dark:text-white">
                Hourly Station Busy / Quiet Forecast (IST)
              </h2>
            </div>
            <span className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
              Best time to charge: {forecast.best_hour_label} IST
            </span>
          </div>

          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{forecast.hint}</p>

          <div className="mt-5 flex h-40 items-end gap-1.5 overflow-x-auto pb-2">
            {forecast.hourly_forecast.map((pt) => {
              const barColor =
                pt.level === 'HIGH'
                  ? 'bg-rose-500'
                  : pt.level === 'MODERATE'
                    ? 'bg-amber-500'
                    : 'bg-emerald-500';
              return (
                <div key={pt.hour} className="flex min-w-[22px] flex-1 flex-col items-center gap-1">
                  <div className="flex h-28 w-full items-end">
                    <div
                      title={`${pt.label}: ${pt.predicted_utilization_pct}% (${pt.level})`}
                      className={`w-full rounded-t ${barColor} transition-all`}
                      style={{ height: `${Math.max(10, pt.predicted_utilization_pct)}%` }}
                    />
                  </div>
                  <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
                    {pt.hour % 3 === 0 ? `${pt.hour}h` : ''}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {bookingCharger && (
        <BookingModal
          station={liveStation}
          charger={bookingCharger}
          onClose={() => setBookingCharger(null)}
        />
      )}
    </main>
  );
}
