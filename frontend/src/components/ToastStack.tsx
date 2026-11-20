import { useEffect } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';

export function ToastStack() {
  const toasts = useAppStore((s) => s.toasts);
  const dismissToast = useAppStore((s) => s.dismissToast);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((t) => window.setTimeout(() => dismissToast(t.id), 5000));
    return () => timers.forEach((tm) => window.clearTimeout(tm));
  }, [toasts, dismissToast]);

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed bottom-20 right-5 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 no-print"
    >
      {toasts.map((t) => {
        const Icon =
          t.variant === 'success'
            ? CheckCircle2
            : t.variant === 'warning'
              ? AlertTriangle
              : t.variant === 'error'
                ? XCircle
                : Info;
        const borderClass =
          t.variant === 'success'
            ? 'border-emerald-500/50'
            : t.variant === 'warning'
              ? 'border-amber-500/50'
              : t.variant === 'error'
                ? 'border-rose-500/50'
                : 'border-sky-500/50';
        const iconColor =
          t.variant === 'success'
            ? 'text-emerald-500'
            : t.variant === 'warning'
              ? 'text-amber-500'
              : t.variant === 'error'
                ? 'text-rose-500'
                : 'text-sky-500';

        return (
          <div
            key={t.id}
            role="status"
            className={`flex items-start gap-2.5 rounded-xl border ${borderClass} bg-white p-3 shadow-lg dark:bg-slate-900`}
          >
            <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconColor}`} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-slate-900 dark:text-white">{t.title}</p>
              <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">{t.message}</p>
            </div>
            <button
              type="button"
              onClick={() => dismissToast(t.id)}
              aria-label="Dismiss notification"
              className="rounded p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
