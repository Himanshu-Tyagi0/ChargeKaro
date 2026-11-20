import { AlertTriangle, CalendarCheck2, CheckCircle2, Zap } from 'lucide-react';
import type { ChargerStatus } from '../types';
import { getStatusLabel } from '../utils/stationHelpers';

interface StatusBadgeProps {
  status: ChargerStatus;
  compact?: boolean;
}

export function StatusBadge({ status, compact = false }: StatusBadgeProps) {
  const styles: Record<ChargerStatus, string> = {
    FREE: 'text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-950/60 dark:border-emerald-800/80',
    OCCUPIED: 'text-rose-700 bg-rose-50 border-rose-200 dark:text-rose-300 dark:bg-rose-950/60 dark:border-rose-800/80',
    BOOKED: 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-950/60 dark:border-amber-800/80',
    OFFLINE: 'text-slate-600 bg-slate-100 border-slate-300 dark:text-slate-400 dark:bg-slate-800/70 dark:border-slate-700',
  };

  const Icon =
    status === 'FREE'
      ? CheckCircle2
      : status === 'OCCUPIED'
        ? Zap
        : status === 'BOOKED'
          ? CalendarCheck2
          : AlertTriangle;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border font-medium whitespace-nowrap shrink-0 ${
        compact ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs'
      } ${styles[status]}`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{getStatusLabel(status)}</span>
    </span>
  );
}
