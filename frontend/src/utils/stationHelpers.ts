import type { Charger, ChargerStatus, Station } from '../types';

export type StationHealthColor = 'green' | 'amber' | 'red' | 'grey';

/**
 * Compute aggregate marker color for a station:
 * - grey: all chargers offline
 * - green: >= 50% of chargers free (or >= 2 free)
 * - amber: limited availability (at least 1 free)
 * - red: 0 chargers free (all busy/booked/offline)
 */
export function getStationMarkerColor(chargers: Charger[]): StationHealthColor {
  if (!chargers || chargers.length === 0) return 'grey';
  const offlineCount = chargers.filter((c) => c.status === 'OFFLINE').length;
  if (offlineCount === chargers.length) return 'grey';

  const freeCount = chargers.filter((c) => c.status === 'FREE').length;
  if (freeCount === 0) return 'red';
  if (freeCount >= Math.ceil(chargers.length / 2)) return 'green';
  return 'amber';
}

export function recomputeStationAggregates(station: Station): Station {
  const free = station.chargers.filter((c) => c.status === 'FREE').length;
  const total = station.chargers.length;
  const minPrice = total > 0 ? Math.min(...station.chargers.map((c) => c.price_per_kwh)) : 0;
  const maxPower = total > 0 ? Math.max(...station.chargers.map((c) => c.power_kw)) : 0;
  return {
    ...station,
    free_chargers: free,
    total_chargers: total,
    min_price_per_kwh: minPrice,
    max_power_kw: maxPower,
  };
}

export function getStatusLabel(status: ChargerStatus): string {
  switch (status) {
    case 'FREE':
      return 'Free';
    case 'OCCUPIED':
      return 'Occupied';
    case 'BOOKED':
      return 'Booked';
    case 'OFFLINE':
      return 'Offline';
  }
}

export function formatInr(amount: number): string {
  return `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function formatIstDateTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export function isFreeCancellationEligible(startTimeIso: string, nowMs = Date.now()): boolean {
  const startMs = new Date(startTimeIso).getTime();
  return (startMs - nowMs) / 60000 >= 15;
}
