import { useState } from 'react';
import { Bell, LogOut, Menu, Moon, Sun, X, Zap } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useAppStore } from '../store/useAppStore';

export function TopNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const user = useAppStore((s) => s.user);
  const theme = useAppStore((s) => s.theme);
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const clearAuth = useAppStore((s) => s.clearAuth);
  const notifications = useAppStore((s) => s.notifications);
  const setNotifications = useAppStore((s) => s.setNotifications);
  const wsConnected = useAppStore((s) => s.wsConnected);

  const [notifOpen, setNotifOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const handleLogout = async () => {
    try {
      await apiClient.post('/auth/logout');
    } catch {
      // Ignore network error on logout
    }
    clearAuth();
    navigate('/');
  };

  const handleMarkAllRead = async () => {
    try {
      await apiClient.post('/auth/notifications/read-all');
      setNotifications(notifications.map((n) => ({ ...n, is_read: true })));
    } catch {
      // Ignore
    }
  };

  const navLinks = [
    { to: '/map', label: 'Live Map', visible: true },
    { to: '/bookings', label: 'My Bookings', visible: true },
    { to: '/owner', label: 'Owner Portal', visible: user?.role === 'owner' || user?.role === 'admin' },
    { to: '/admin', label: 'Admin Console', visible: user?.role === 'admin' },
  ].filter((l) => l.visible);

  return (
    <header className="sticky top-0 z-40 no-print">
      {/* Main 3-Zone Top Bar */}
      <div className="border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-[#0B1120]/95">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-8 px-4 sm:px-6">
          {/* Zone 1: Single-line Brand Wordmark */}
          <Link
            to="/"
            className="flex items-center gap-2 font-display text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0"
          >
            <Zap className="h-5 w-5 text-emerald-500 shrink-0" aria-hidden="true" />
            <span>ChargeKaro</span>
          </Link>

          {/* Zone 2: Concise single-line navigation links */}
          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600 dark:text-slate-300" aria-label="Main navigation">
            {navLinks.map((link) => {
              const active = location.pathname.startsWith(link.to);
              return (
                <Link
                  key={link.to}
                  to={link.to}
                  className={`whitespace-nowrap shrink-0 py-1 transition-colors hover:text-slate-900 dark:hover:text-white ${
                    active ? 'text-emerald-600 dark:text-emerald-400 border-b-2 border-emerald-500' : ''
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>

          {/* Zone 3: Account & Utility Controls */}
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            {user && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setNotifOpen((v) => !v)}
                  aria-label="Notifications"
                  aria-expanded={notifOpen}
                  className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors"
                >
                  <Bell className="h-4 w-4" />
                  {unreadCount > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-bold text-slate-950 tabular-nums">
                      {unreadCount}
                    </span>
                  )}
                </button>

                {notifOpen && (
                  <div className="absolute right-0 mt-2 w-80 rounded-xl border border-slate-200 bg-white p-3 shadow-xl dark:border-slate-800 dark:bg-slate-900">
                    <div className="mb-2 flex items-center justify-between border-b border-slate-200 pb-2 dark:border-slate-800">
                      <span className="text-sm font-semibold text-slate-900 dark:text-white">Notifications</span>
                      {unreadCount > 0 && (
                        <button
                          type="button"
                          onClick={handleMarkAllRead}
                          className="text-xs font-medium text-emerald-600 hover:underline dark:text-emerald-400"
                        >
                          Mark all read
                        </button>
                      )}
                    </div>
                    <div className="max-h-72 space-y-2 overflow-y-auto">
                      {notifications.length === 0 ? (
                        <p className="py-4 text-center text-xs text-slate-500 dark:text-slate-400">
                          No notifications yet.
                        </p>
                      ) : (
                        notifications.map((n) => (
                          <div
                            key={n.id}
                            className={`rounded-lg border p-2.5 text-xs ${
                              n.is_read
                                ? 'border-slate-100 bg-slate-50/50 dark:border-slate-800/60 dark:bg-slate-950/40'
                                : 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/60 dark:bg-emerald-950/30'
                            }`}
                          >
                            <div className="font-semibold text-slate-900 dark:text-slate-100">{n.title}</div>
                            <p className="mt-0.5 text-slate-600 dark:text-slate-300">{n.message}</p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {user ? (
              <div className="hidden sm:flex items-center gap-2">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">
                  {user.full_name} ({user.role})
                </span>
                <button
                  type="button"
                  onClick={handleLogout}
                  aria-label="Sign out"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                >
                  <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Sign Out</span>
                </button>
              </div>
            ) : (
              <Link
                to="/auth"
                className="inline-flex items-center rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 transition-colors whitespace-nowrap shrink-0"
              >
                Sign In
              </Link>
            )}

            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label="Toggle mobile menu"
              className="inline-flex md:hidden h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-700 dark:border-slate-800 dark:text-slate-200"
            >
              {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* Slim Demo Mode Banner */}
      <div className="border-b border-sky-200/70 bg-sky-50 px-4 py-1 text-center text-xs text-sky-900 dark:border-sky-900/50 dark:bg-sky-950/60 dark:text-sky-200">
        <span>Demo Mode: Simulated Delhi-NCR stations, live telemetry &amp; mock UPI payments</span>
        <span aria-hidden="true"> · </span>
        <span className="font-mono text-[11px]">
          {wsConnected ? 'Live stream active' : 'Reconnecting stream...'}
        </span>
      </div>

      {/* Mobile Dropdown Nav */}
      {mobileMenuOpen && (
        <div className="border-b border-slate-200 bg-white px-4 py-3 md:hidden dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-col gap-2">
            {navLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {link.label}
              </Link>
            ))}
            {user && (
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  handleLogout();
                }}
                className="rounded-lg px-3 py-2 text-left text-sm font-medium text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
              >
                Sign Out ({user.full_name})
              </button>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
