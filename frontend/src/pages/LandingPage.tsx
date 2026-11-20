import { useState } from 'react';
import { ArrowRight, Bot, CalendarCheck, MapPin, ShieldCheck, Zap } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useAppStore } from '../store/useAppStore';

export function LandingPage() {
  const navigate = useNavigate();
  const setAuth = useAppStore((s) => s.setAuth);
  const addToast = useAppStore((s) => s.addToast);
  const openAssistant = useAppStore((s) => s.openAssistant);
  const [loggingInRole, setLoggingInRole] = useState<string | null>(null);

  const quickLogin = async (email: string, password: string, redirect: string, roleLabel: string) => {
    setLoggingInRole(roleLabel);
    try {
      const res = await apiClient.post('/auth/login', { email, password });
      setAuth(res.data.user, res.data.access_token, res.data.csrf_token);
      addToast({
        title: `Signed in as ${roleLabel}`,
        message: `Welcome, ${res.data.user.full_name}`,
        variant: 'success',
      });
      navigate(redirect);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Backend is warming up — please try again in a second.';
      addToast({ title: 'Demo Login Failed', message: msg, variant: 'error' });
    } finally {
      setLoggingInRole(null);
    }
  };

  return (
    <main className="mx-auto max-w-[1440px] px-4 pt-8 pb-24 sm:px-6 lg:pt-10">
      {/* Hero Split */}
      <section className="grid grid-cols-1 items-stretch gap-8 lg:grid-cols-12">
        <div className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-7 sm:p-10 lg:col-span-6 dark:border-slate-800 dark:bg-slate-900">
          <div>
            <p className="text-xs font-semibold tracking-wide text-emerald-600 dark:text-emerald-400">
              Delhi-NCR EV Charging Grid · Live Demo
            </p>
            <h1 className="mt-3 max-w-xl font-display text-3xl font-extrabold tracking-tight text-slate-900 sm:text-5xl dark:text-white [text-wrap:balance]">
              Know which EV charger is free before you drive there.
            </h1>
            <p className="mt-4 max-w-lg text-base leading-relaxed text-slate-600 dark:text-slate-300">
              ChargeKaro tracks live status for every individual gun across 12 Delhi-NCR hubs, prevents double-bookings at the database layer, and books slots via English or Hinglish voice commands.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                to="/map"
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-emerald-400 transition-colors whitespace-nowrap shrink-0"
              >
                <span>Open Live Map</span>
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <button
                type="button"
                onClick={() => openAssistant('Find a fast charger near Connaught Place')}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
              >
                <Bot className="h-4 w-4 text-sky-500" aria-hidden="true" />
                <span>Try AI Voice Assistant</span>
              </button>
            </div>
          </div>

          {/* 1-Click Demo Role Access */}
          <div className="mt-8 border-t border-slate-200 pt-6 dark:border-slate-800">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Instant Demo Accounts (No Setup Required)
            </p>
            <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              <button
                type="button"
                disabled={loggingInRole !== null}
                onClick={() => quickLogin('driver@chargekaro.demo', 'Driver@123!', '/map', 'Driver')}
                className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-left hover:border-emerald-500 disabled:opacity-60 dark:border-slate-800 dark:bg-slate-950 dark:hover:border-emerald-500 transition-colors"
              >
                <div className="text-xs font-bold text-slate-900 dark:text-white">
                  {loggingInRole === 'Driver' ? 'Signing in...' : 'Demo Driver'}
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">Nexon EV · Book &amp; Charge</div>
              </button>
              <button
                type="button"
                disabled={loggingInRole !== null}
                onClick={() => quickLogin('owner@chargekaro.demo', 'Owner@123!', '/owner', 'Owner')}
                className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-left hover:border-sky-500 disabled:opacity-60 dark:border-slate-800 dark:bg-slate-950 dark:hover:border-sky-500 transition-colors"
              >
                <div className="text-xs font-bold text-slate-900 dark:text-white">
                  {loggingInRole === 'Owner' ? 'Signing in...' : 'Station Owner'}
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">Pricing, Heatmap &amp; AI</div>
              </button>
              <button
                type="button"
                disabled={loggingInRole !== null}
                onClick={() => quickLogin('admin@chargekaro.demo', 'Admin@123!', '/admin', 'Admin')}
                className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-left hover:border-amber-500 disabled:opacity-60 dark:border-slate-800 dark:bg-slate-950 dark:hover:border-amber-500 transition-colors"
              >
                <div className="text-xs font-bold text-slate-900 dark:text-white">
                  {loggingInRole === 'Admin' ? 'Signing in...' : 'Platform Admin'}
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">Audit Logs &amp; Demo Controls</div>
              </button>
            </div>
          </div>
        </div>

        {/* Hero Photograph */}
        <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-900 lg:col-span-6 dark:border-slate-800 min-h-[340px]">
          <img
            src="/src/assets/images/hero_ev_station_1795028497742.jpg"
            alt="Electric SUV fast charging at a Delhi-NCR ChargeKaro plaza at twilight"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/30 to-transparent" />
          <div className="absolute bottom-6 left-6 right-6 flex flex-wrap items-end justify-between gap-4 text-white">
            <div>
              <p className="text-xs font-medium text-emerald-400">Connaught Place · Cyber Hub · Noida Sec 18 · IGI T3</p>
              <p className="mt-1 font-display text-lg font-bold">12 Live Demo Stations · 50+ Individual Chargers</p>
            </div>
            <span className="font-mono text-xs text-slate-300 tabular-nums">CCS2 · CHAdeMO · Type 2</span>
          </div>
        </div>
      </section>

      {/* 4-Column Capability Strip */}
      <section className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <MapPin className="h-5 w-5 text-emerald-500" aria-hidden="true" />
          <h2 className="mt-3 font-display text-base font-bold text-slate-900 dark:text-white">Live Gun-Level Map</h2>
          <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
            WebSocket telemetry updates every charger status (Free, Occupied, Booked, Offline) without page refresh.
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <CalendarCheck className="h-5 w-5 text-sky-500" aria-hidden="true" />
          <h2 className="mt-3 font-display text-base font-bold text-slate-900 dark:text-white">Double-Booking Lock</h2>
          <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
            Serialized transactions and idempotency keys guarantee two drivers can never reserve the same 30-min slot.
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <Zap className="h-5 w-5 text-amber-500" aria-hidden="true" />
          <h2 className="mt-3 font-display text-base font-bold text-slate-900 dark:text-white">QR Check-In &amp; Session</h2>
          <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
            Single-use signed QR pass triggers live battery %, kWh delivered, INR cost metering, and printable invoices.
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <ShieldCheck className="h-5 w-5 text-emerald-500" aria-hidden="true" />
          <h2 className="mt-3 font-display text-base font-bold text-slate-900 dark:text-white">5 Specialized AI Agents</h2>
          <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
            Recommendation, Smart Booking, Scikit-learn Demand, Route Corridor, and Monitoring agents with tool logs.
          </p>
        </div>
      </section>

      {/* Secondary Visual Proof Strip */}
      <section className="mt-8 grid grid-cols-1 items-center gap-6 rounded-2xl border border-slate-200 bg-white p-6 lg:grid-cols-12 dark:border-slate-800 dark:bg-slate-900">
        <div className="overflow-hidden rounded-xl lg:col-span-5">
          <img
            src="/src/assets/images/station_urban_hub_1795028497738.jpg"
            alt="Solar-canopy urban EV DC fast charging kiosk bay"
            referrerPolicy="no-referrer"
            className="h-60 w-full object-cover"
          />
        </div>
        <div className="space-y-3 lg:col-span-7 lg:pl-4">
          <p className="text-xs font-semibold text-sky-600 dark:text-sky-400">Built for Indian EV Infrastructure</p>
          <h2 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Supports Tata Nexon EV, MG ZS EV, CCS2, CHAdeMO, Type 2, and Bharat AC/DC-001.
          </h2>
          <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            Before confirming a reservation, ChargeKaro checks your selected vehicle&apos;s connector compatibility, forecasts busy hours with Ridge regression, and re-routes you if a booked charger goes offline.
          </p>
          <div className="pt-1">
            <Link
              to="/map"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-600 hover:underline dark:text-emerald-400"
            >
              <span>Browse all 12 Delhi-NCR stations</span>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
