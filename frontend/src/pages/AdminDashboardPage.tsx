import { useCallback, useEffect, useState } from 'react';
import { Activity, AlertTriangle, RotateCcw, Shield, Users, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useAppStore } from '../store/useAppStore';
import type { AuditLogItem, User } from '../types';
import { formatIstDateTime } from '../utils/stationHelpers';

interface HealthPayload {
  status: string;
  database: string;
  station_count: number;
  charger_count: number;
  charger_status_breakdown: Record<string, number>;
  ws_public_clients: number;
  ws_private_users: number;
  monitoring_alerts: { severity: string; message: string }[];
}

export function AdminDashboardPage() {
  const user = useAppStore((s) => s.user);
  const addToast = useAppStore((s) => s.addToast);

  const [users, setUsers] = useState<User[]>([]);
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const loadAdminData = useCallback(async () => {
    setLoading(true);
    try {
      const [uRes, lRes, hRes] = await Promise.all([
        apiClient.get<User[]>('/admin/users'),
        apiClient.get<AuditLogItem[]>('/admin/audit-logs'),
        apiClient.get<HealthPayload>('/admin/health'),
      ]);
      setUsers(uRes.data);
      setLogs(lRes.data);
      setHealth(hRes.data);
    } catch {
      addToast({ title: 'Admin Access Required', message: 'Sign in as admin@chargekaro.demo.', variant: 'error' });
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    if (user?.role === 'admin') {
      loadAdminData();
    } else {
      setLoading(false);
    }
  }, [loadAdminData, user]);

  const runDemoControl = async (endpoint: string, label: string) => {
    setBusyAction(label);
    try {
      const res = await apiClient.post(endpoint);
      addToast({ title: label, message: res.data.message || 'Done.', variant: 'success' });
      await loadAdminData();
    } catch {
      addToast({ title: 'Action Failed', message: `Could not execute ${label}.`, variant: 'error' });
    } finally {
      setBusyAction(null);
    }
  };

  if (!user || user.role !== 'admin') {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12 text-center">
        <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">Admin Console</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          Please sign in as Platform Admin (admin@chargekaro.demo) to inspect audit logs and trigger demo controls.
        </p>
        <Link to="/auth" className="mt-5 inline-flex rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-slate-950">
          Go to Sign In
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[1440px] space-y-6 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-slate-900 dark:text-white">
            Admin Console &amp; Demo Controls
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Platform health, user directory, correlation-ID audit trail, and live telemetry simulation triggers.
          </p>
        </div>
      </div>

      {/* Demo Controls Panel */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">Demo Controls</h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Trigger live grid events broadcast immediately over WebSockets to all connected maps.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() => runDemoControl('/admin/demo/rush-hour', 'Simulate Rush Hour')}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
          >
            <Zap className="h-4 w-4" aria-hidden="true" />
            <span>Simulate Rush Hour</span>
          </button>
          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() => runDemoControl('/admin/demo/force-offline', 'Force Charger Offline')}
            className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
          >
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            <span>Force a Charger Offline</span>
          </button>
          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() => runDemoControl('/admin/demo/reset', 'Reset Demo Data')}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 disabled:opacity-50"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            <span>Reset Demo Data</span>
          </button>
        </div>
      </section>

      {/* Health Breakdown */}
      {!loading && health && (
        <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <Activity className="h-4 w-4 text-emerald-500" /> System &amp; Database
            </div>
            <p className="mt-1 font-display text-lg font-bold text-slate-900 dark:text-white">
              {health.status.toUpperCase()} ({health.database})
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-xs text-slate-500 dark:text-slate-400">Free / Occupied / Offline</div>
            <p className="mt-1 font-mono text-lg font-bold text-slate-900 dark:text-white tabular-nums">
              {health.charger_status_breakdown.FREE ?? 0} / {health.charger_status_breakdown.OCCUPIED ?? 0} /{' '}
              {health.charger_status_breakdown.OFFLINE ?? 0}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <Users className="h-4 w-4 text-sky-500" /> Registered Users
            </div>
            <p className="mt-1 font-mono text-lg font-bold text-slate-900 dark:text-white tabular-nums">{users.length}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <Shield className="h-4 w-4 text-amber-500" /> Active WebSocket Clients
            </div>
            <p className="mt-1 font-mono text-lg font-bold text-slate-900 dark:text-white tabular-nums">
              {health.ws_public_clients} public · {health.ws_private_users} private
            </p>
          </div>
        </section>
      )}

      {/* Users Table & Audit Logs */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 lg:col-span-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">Users</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <tr>
                  <th className="py-2 pr-3 font-semibold">Name</th>
                  <th className="py-2 pr-3 font-semibold">Email</th>
                  <th className="py-2 font-semibold">Role</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="py-2.5 pr-3 font-medium text-slate-900 dark:text-white">{u.full_name}</td>
                    <td className="py-2.5 pr-3 text-slate-600 dark:text-slate-300">{u.email}</td>
                    <td className="py-2.5 font-mono text-emerald-600 dark:text-emerald-400">{u.role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 lg:col-span-7 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
            Security Audit Log (PII Masked)
          </h2>
          <div className="mt-4 max-h-96 overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <tr>
                  <th className="py-2 pr-3 font-semibold">Time (IST)</th>
                  <th className="py-2 pr-3 font-semibold">Action</th>
                  <th className="py-2 pr-3 font-semibold">Details</th>
                  <th className="py-2 font-semibold">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono text-[11px] dark:divide-slate-800/80">
                {logs.slice(0, 40).map((l) => (
                  <tr key={l.id}>
                    <td className="py-2 pr-3 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {formatIstDateTime(l.created_at)}
                    </td>
                    <td className="py-2 pr-3 font-semibold text-sky-600 dark:text-sky-400">{l.action}</td>
                    <td className="py-2 pr-3 text-slate-700 dark:text-slate-300 max-w-[260px] truncate">{l.details_json}</td>
                    <td className="py-2 text-slate-500 dark:text-slate-400">{l.ip_address || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
