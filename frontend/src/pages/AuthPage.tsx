import { useState } from 'react';
import { AlertTriangle, Lock, Mail, User as UserIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useAppStore } from '../store/useAppStore';

export function AuthPage() {
  const navigate = useNavigate();
  const setAuth = useAppStore((s) => s.setAuth);
  const addToast = useAppStore((s) => s.addToast);

  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<'driver' | 'owner'>('driver');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const endpoint = tab === 'login' ? '/auth/login' : '/auth/register';
      const body =
        tab === 'login'
          ? { email, password }
          : { email, password, full_name: fullName, role };
      const res = await apiClient.post(endpoint, body);
      setAuth(res.data.user, res.data.access_token, res.data.csrf_token);
      addToast({
        title: tab === 'login' ? 'Signed In' : 'Account Created',
        message: `Welcome, ${res.data.user.full_name}`,
        variant: 'success',
      });
      const r = res.data.user.role;
      navigate(r === 'admin' ? '/admin' : r === 'owner' ? '/owner' : '/map');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Authentication failed. Please check your credentials.';
      setErrorMsg(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const fillDemo = (demoEmail: string, demoPassword: string) => {
    setTab('login');
    setEmail(demoEmail);
    setPassword(demoPassword);
    setErrorMsg(null);
  };

  return (
    <main className="mx-auto flex max-w-md flex-col px-4 py-12">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-6 flex rounded-xl bg-slate-100 p-1 dark:bg-slate-950">
          <button
            type="button"
            onClick={() => {
              setTab('login');
              setErrorMsg(null);
            }}
            className={`flex-1 rounded-lg py-2 text-xs font-semibold transition-colors ${
              tab === 'login'
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('register');
              setErrorMsg(null);
            }}
            className={`flex-1 rounded-lg py-2 text-xs font-semibold transition-colors ${
              tab === 'register'
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Create Account
          </button>
        </div>

        <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
          {tab === 'login' ? 'Sign in to ChargeKaro' : 'Create your ChargeKaro account'}
        </h1>

        {errorMsg && (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-rose-300 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-200">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {tab === 'register' && (
            <>
              <div>
                <label htmlFor="auth-name" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Full Name
                </label>
                <div className="relative mt-1">
                  <UserIcon className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    id="auth-name"
                    type="text"
                    required
                    minLength={2}
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Aarav Mehta"
                    className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="auth-role" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Account Role
                </label>
                <select
                  id="auth-role"
                  value={role}
                  onChange={(e) => setRole(e.target.value as 'driver' | 'owner')}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                >
                  <option value="driver">EV Driver</option>
                  <option value="owner">Station Owner</option>
                </select>
              </div>
            </>
          )}

          <div>
            <label htmlFor="auth-email" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Email Address
            </label>
            <div className="relative mt-1">
              <Mail className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                id="auth-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="driver@chargekaro.demo"
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
            </div>
          </div>

          <div>
            <label htmlFor="auth-password" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Password
            </label>
            <div className="relative mt-1">
              <Lock className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                id="auth-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
            </div>
            {tab === 'register' && (
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                Min 8 chars, including uppercase, lowercase, number, and symbol.
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-emerald-500 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
          >
            {submitting ? 'Please wait...' : tab === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        {/* Demo Credentials Helper */}
        <div className="mt-6 border-t border-slate-200 pt-5 dark:border-slate-800">
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Fill Demo Credentials</p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => fillDemo('driver@chargekaro.demo', 'Driver@123!')}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-emerald-500 dark:border-slate-700 dark:text-slate-300"
            >
              Driver
            </button>
            <button
              type="button"
              onClick={() => fillDemo('owner@chargekaro.demo', 'Owner@123!')}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-sky-500 dark:border-slate-700 dark:text-slate-300"
            >
              Station Owner
            </button>
            <button
              type="button"
              onClick={() => fillDemo('admin@chargekaro.demo', 'Admin@123!')}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-amber-500 dark:border-slate-700 dark:text-slate-300"
            >
              Admin
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
