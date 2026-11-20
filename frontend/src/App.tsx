import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { apiClient } from './api/client';
import { AssistantDrawer } from './components/AssistantDrawer';
import { ToastStack } from './components/ToastStack';
import { TopNav } from './components/TopNav';
import { useWebSockets } from './hooks/useWebSockets';
import { AdminDashboardPage } from './pages/AdminDashboardPage';
import { AuthPage } from './pages/AuthPage';
import { BookingsPage } from './pages/BookingsPage';
import { LandingPage } from './pages/LandingPage';
import { MapPage } from './pages/MapPage';
import { OwnerDashboardPage } from './pages/OwnerDashboardPage';
import { SessionPage } from './pages/SessionPage';
import { StationDetailPage } from './pages/StationDetailPage';
import { useAppStore } from './store/useAppStore';

function AppShell() {
  const setAuth = useAppStore((s) => s.setAuth);
  const setAuthChecked = useAppStore((s) => s.setAuthChecked);

  const user = useAppStore((s) => s.user);
  const accessToken = useAppStore((s) => s.accessToken);

  useWebSockets();

  useEffect(() => {
    if (user && accessToken) {
      setAuthChecked(true);
      return;
    }
    const hasSessionHint = typeof window !== 'undefined' && window.localStorage.getItem('ck_has_session') === '1';
    if (!hasSessionHint) {
      setAuthChecked(true);
      return;
    }
    // Attempt silent session restore from httpOnly refresh cookie on boot
    apiClient
      .post('/auth/refresh', {})
      .then((res) => {
        setAuth(res.data.user, res.data.access_token, res.data.csrf_token);
      })
      .catch(() => {
        if (typeof window !== 'undefined') {
          window.localStorage.removeItem('ck_has_session');
        }
        setAuthChecked(true);
      });
  }, [accessToken, setAuth, setAuthChecked, user]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-[#080D17] dark:text-slate-100">
      <TopNav />
      <ToastStack />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/map" element={<MapPage />} />
        <Route path="/stations/:id" element={<StationDetailPage />} />
        <Route path="/bookings" element={<BookingsPage />} />
        <Route path="/session/:id" element={<SessionPage />} />
        <Route path="/owner" element={<OwnerDashboardPage />} />
        <Route path="/admin" element={<AdminDashboardPage />} />
        <Route path="*" element={<Navigate to="/map" replace />} />
      </Routes>
      <AssistantDrawer />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}
