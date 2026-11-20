import { useCallback, useEffect, useState } from 'react';
import {
  Crosshair,
  ExternalLink,
  Filter,
  MapPin,
  Search,
  Star,
  X,
  Zap,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { BookingModal } from '../components/BookingModal';
import { StationMap } from '../components/StationMap';
import { StatusBadge } from '../components/StatusBadge';
import { useAppStore } from '../store/useAppStore';
import type { Charger, Station } from '../types';
import { formatInr } from '../utils/stationHelpers';

export function MapPage() {
  const stations = useAppStore((s) => s.stations);
  const setStations = useAppStore((s) => s.setStations);
  const selectedStationId = useAppStore((s) => s.selectedStationId);
  const setSelectedStationId = useAppStore((s) => s.setSelectedStationId);
  const userLocation = useAppStore((s) => s.userLocation);
  const setUserLocation = useAppStore((s) => s.setUserLocation);
  const activeRoutePlan = useAppStore((s) => s.activeRoutePlan);
  const setRoutePlan = useAppStore((s) => s.setRoutePlan);
  const recentlyUpdated = useAppStore((s) => s.recentlyUpdatedChargerIds);
  const addToast = useAppStore((s) => s.addToast);

  const [areaSearch, setAreaSearch] = useState('');
  const [connectorFilter, setConnectorFilter] = useState('');
  const [minPower, setMinPower] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [amenityFilter, setAmenityFilter] = useState('');
  const [maxDistance, setMaxDistance] = useState('');
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [sortBy, setSortBy] = useState<'nearest' | 'cheapest' | 'fastest'>('nearest');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [bookingTarget, setBookingTarget] = useState<{ station: Station; charger: Charger } | null>(null);

  const fetchStations = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const params: Record<string, string | number | boolean> = {
        lat: userLocation[0],
        lng: userLocation[1],
        sort: sortBy,
      };
      if (areaSearch.trim()) params.area = areaSearch.trim();
      if (connectorFilter) params.connector_type = connectorFilter;
      if (minPower) params.min_power = Number(minPower);
      if (maxPrice) params.max_price = Number(maxPrice);
      if (amenityFilter) params.amenity = amenityFilter;
      if (maxDistance) params.max_distance_km = Number(maxDistance);
      if (onlyAvailable) params.only_available = true;

      const res = await apiClient.get<Station[]>('/stations', { params });
      setStations(res.data);
      setLoadError(null);
    } catch {
      setLoadError('Stations are still warming up. Retrying automatically...');
    } finally {
      setLoading(false);
    }
  }, [
    amenityFilter,
    areaSearch,
    connectorFilter,
    maxDistance,
    maxPrice,
    minPower,
    onlyAvailable,
    setStations,
    sortBy,
    userLocation,
  ]);

  useEffect(() => {
    fetchStations();
  }, [fetchStations]);

  useEffect(() => {
    if (!loadError) return;
    const timer = window.setTimeout(() => {
      fetchStations();
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [loadError, fetchStations]);

  const handleUseMyLocation = () => {
    if (!navigator.geolocation) {
      setUserLocation([28.6315, 77.2167]);
      addToast({ title: 'Using Delhi Center', message: 'Geolocation unavailable; centered on Connaught Place.', variant: 'info' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLocation([pos.coords.latitude, pos.coords.longitude]);
        addToast({ title: 'Location Updated', message: 'Sorted stations by distance from your GPS.', variant: 'success' });
      },
      () => {
        setUserLocation([28.6315, 77.2167]);
        addToast({ title: 'Centered on Delhi-NCR', message: 'Location permission declined; defaulting to Connaught Place.', variant: 'info' });
      },
      { timeout: 5000 }
    );
  };

  const selectedStation = stations.find((s) => s.id === selectedStationId) ?? null;

  return (
    <main className="mx-auto flex max-w-[1440px] flex-col gap-4 px-4 pt-4 pb-24 sm:px-6">
      {/* Filter Toolbar */}
      <section aria-label="Station filters" className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" />
            <input
              type="text"
              value={areaSearch}
              onChange={(e) => setAreaSearch(e.target.value)}
              placeholder="Search area or station (e.g. Connaught Place, Saket, Cyber Hub)"
              aria-label="Search area or station"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-xs text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </div>

          <select
            aria-label="Filter by connector type"
            value={connectorFilter}
            onChange={(e) => setConnectorFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
          >
            <option value="">All Connectors</option>
            <option value="CCS2">CCS2</option>
            <option value="CHAdeMO">CHAdeMO</option>
            <option value="Type 2">Type 2</option>
            <option value="Bharat DC-001">Bharat DC-001</option>
            <option value="Bharat AC-001">Bharat AC-001</option>
          </select>

          <select
            aria-label="Minimum power"
            value={minPower}
            onChange={(e) => setMinPower(e.target.value)}
            className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
          >
            <option value="">Any Speed</option>
            <option value="22">22+ kW</option>
            <option value="50">50+ kW (Fast DC)</option>
            <option value="100">100+ kW (Ultra-Fast)</option>
          </select>

          <select
            aria-label="Maximum price"
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
            className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
          >
            <option value="">Any Price</option>
            <option value="15">Up to ₹15/kWh</option>
            <option value="18">Up to ₹18/kWh</option>
            <option value="22">Up to ₹22/kWh</option>
          </select>

          <select
            aria-label="Filter by amenity"
            value={amenityFilter}
            onChange={(e) => setAmenityFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
          >
            <option value="">All Amenities</option>
            <option value="Cafe">Cafe</option>
            <option value="Restroom">Restroom</option>
            <option value="Wi-Fi">Wi-Fi</option>
            <option value="Parking">Parking</option>
          </select>

          <select
            aria-label="Maximum distance"
            value={maxDistance}
            onChange={(e) => setMaxDistance(e.target.value)}
            className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
          >
            <option value="">Any Distance</option>
            <option value="5">Within 5 km</option>
            <option value="10">Within 10 km</option>
            <option value="20">Within 20 km</option>
          </select>

          <select
            aria-label="Sort stations"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'nearest' | 'cheapest' | 'fastest')}
            className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
          >
            <option value="nearest">Sort: Nearest</option>
            <option value="cheapest">Sort: Cheapest</option>
            <option value="fastest">Sort: Fastest</option>
          </select>

          <button
            type="button"
            onClick={() => setOnlyAvailable((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              onlyAvailable
                ? 'border-emerald-500 bg-emerald-500 text-slate-950'
                : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300'
            }`}
          >
            <Filter className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Free Now</span>
          </button>

          <button
            type="button"
            onClick={handleUseMyLocation}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:border-sky-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 whitespace-nowrap shrink-0"
          >
            <Crosshair className="h-3.5 w-3.5 text-sky-500" aria-hidden="true" />
            <span>Use My Location</span>
          </button>
        </div>

        {activeRoutePlan && (
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-xs text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200">
            <span>
              <strong>Active Route:</strong> {activeRoutePlan.summary}
            </span>
            <button
              type="button"
              onClick={() => setRoutePlan(null)}
              className="font-semibold underline"
            >
              Clear Route
            </button>
          </div>
        )}
      </section>

      {/* Main Map + List + Detail Split */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12" style={{ minHeight: 'calc(100vh - 14rem)' }}>
        {/* Left Station List */}
        <section
          aria-label="Stations list"
          className="flex max-h-[640px] flex-col gap-2.5 overflow-y-auto pr-1 lg:col-span-4"
        >
          {loading ? (
            Array.from({ length: 5 }).map((_, idx) => (
              <div key={idx} className="h-28 animate-pulse rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
            ))
          ) : loadError && stations.length === 0 ? (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-6 text-center dark:border-amber-800 dark:bg-amber-950/30">
              <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">{loadError}</p>
              <button
                type="button"
                onClick={() => fetchStations()}
                className="mt-3 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
              >
                Retry Now
              </button>
            </div>
          ) : stations.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900">
              <p className="text-sm font-semibold text-slate-900 dark:text-white">No matching stations found</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Try clearing filters or increasing maximum distance.
              </p>
            </div>
          ) : (
            stations.map((st) => {
              const selected = st.id === selectedStationId;
              return (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => setSelectedStationId(st.id)}
                  className={`w-full rounded-xl border p-4 text-left transition-colors ${
                    selected
                      ? 'border-emerald-500 bg-emerald-500/5 dark:bg-emerald-950/25'
                      : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                      {st.name}
                    </h2>
                    <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400 tabular-nums whitespace-nowrap shrink-0">
                      {st.free_chargers}/{st.total_chargers} free
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                    <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{st.area}</span>
                    {st.distance_km !== null && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">{st.distance_km} km</span>
                      </>
                    )}
                    <span aria-hidden="true">·</span>
                    <Star className="h-3 w-3 text-amber-400" aria-hidden="true" />
                    <span className="tabular-nums">{st.average_rating}</span>
                  </div>
                  <div className="mt-2.5 flex items-center justify-between text-xs text-slate-700 dark:text-slate-300 tabular-nums">
                    <span>From {formatInr(st.min_price_per_kwh)}/kWh</span>
                    <span>Up to {st.max_power_kw} kW</span>
                    <span>{st.opening_hours}</span>
                  </div>
                </button>
              );
            })
          )}
        </section>

        {/* Right Map + Selected Station Drawer (shown above list on mobile) */}
        <section className="order-first lg:order-none relative flex flex-col gap-4 lg:col-span-8">
          <div className={selectedStation ? 'h-[280px] lg:h-[340px] transition-all' : 'h-[300px] lg:h-[640px] transition-all'}>
            <StationMap
              stations={stations}
              selectedStationId={selectedStationId}
              onSelectStation={(st) => setSelectedStationId(st.id)}
              userLocation={userLocation}
              routePlan={activeRoutePlan}
            />
          </div>

          {/* Station Detail Slide-over Card */}
          {selectedStation && (
            <div
              data-testid="station-detail-panel"
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-lg dark:border-slate-700 dark:bg-slate-900"
            >
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
                <div>
                  <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span>{selectedStation.operator_name}</span>
                    <span aria-hidden="true">·</span>
                    <span>{selectedStation.opening_hours}</span>
                    {selectedStation.distance_km !== null && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">{selectedStation.distance_km} km away</span>
                      </>
                    )}
                  </div>
                  <h2 className="mt-1 font-display text-xl font-bold text-slate-900 dark:text-white">
                    {selectedStation.name}
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                    {selectedStation.address} · Amenities: {selectedStation.amenities.join(', ')}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Link
                    to={`/stations/${selectedStation.id}`}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <span>Demand &amp; Full View</span>
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                  <button
                    type="button"
                    onClick={() => setSelectedStationId(null)}
                    aria-label="Close station panel"
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {selectedStation.chargers.map((c) => {
                  const flashTs = recentlyUpdated[c.id];
                  const isRecent = flashTs && Date.now() - flashTs < 4000;
                  return (
                    <div
                      key={c.id}
                      className={`flex items-center justify-between gap-3 rounded-xl border p-3.5 transition-all ${
                        isRecent
                          ? 'border-sky-400 bg-sky-500/10'
                          : 'border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-950/60'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-display text-sm font-bold text-slate-900 dark:text-white">
                            {c.label}
                          </span>
                          <StatusBadge status={c.status} compact />
                        </div>
                        <p className="mt-1 font-mono text-xs text-slate-600 dark:text-slate-400 tabular-nums">
                          {c.connector_type} · {c.power_kw} kW · {formatInr(c.price_per_kwh)}/kWh
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={c.status === 'OFFLINE'}
                        onClick={() => setBookingTarget({ station: selectedStation, charger: c })}
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40 whitespace-nowrap shrink-0"
                      >
                        <Zap className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Book Slot</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      </div>

      {bookingTarget && (
        <BookingModal
          station={bookingTarget.station}
          charger={bookingTarget.charger}
          onClose={() => setBookingTarget(null)}
          onBooked={() => fetchStations()}
        />
      )}
    </main>
  );
}
