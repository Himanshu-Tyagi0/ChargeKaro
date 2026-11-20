import { create } from 'zustand';
import type { ChargerStatus, NotificationItem, RoutePlan, Station, User } from '../types';
import { recomputeStationAggregates } from '../utils/stationHelpers';

export interface ToastMessage {
  id: string;
  title: string;
  message: string;
  variant: 'info' | 'success' | 'warning' | 'error';
}

interface AppState {
  user: User | null;
  accessToken: string | null;
  csrfToken: string | null;
  authChecked: boolean;
  theme: 'dark' | 'light';

  stations: Station[];
  selectedStationId: number | null;
  recentlyUpdatedChargerIds: Record<number, number>;
  userLocation: [number, number];
  activeRoutePlan: RoutePlan | null;

  notifications: NotificationItem[];
  toasts: ToastMessage[];
  wsConnected: boolean;
  demoRuntimeMode: 'backend' | 'standalone';

  assistantOpen: boolean;
  assistantDraftPrompt: string | null;

  setAuth: (user: User, accessToken: string | null, csrfToken: string | null) => void;
  setAuthChecked: (checked: boolean) => void;
  clearAuth: () => void;
  toggleTheme: () => void;
  setStations: (stations: Station[]) => void;
  setSelectedStationId: (id: number | null) => void;
  setUserLocation: (coords: [number, number]) => void;
  setRoutePlan: (plan: RoutePlan | null) => void;
  applyChargerStatusDelta: (chargerId: number, stationId: number, status: ChargerStatus, lastUpdated: string) => void;
  setNotifications: (items: NotificationItem[]) => void;
  addToast: (toast: Omit<ToastMessage, 'id'>) => void;
  dismissToast: (id: string) => void;
  setWsConnected: (connected: boolean) => void;
  setDemoRuntimeMode: (mode: 'backend' | 'standalone') => void;
  openAssistant: (prompt?: string) => void;
  closeAssistant: () => void;
  clearDraftPrompt: () => void;
}

const initialTheme: 'dark' | 'light' =
  typeof window !== 'undefined' && window.localStorage.getItem('ck_theme') === 'light' ? 'light' : 'dark';

if (typeof document !== 'undefined') {
  document.documentElement.classList.toggle('dark', initialTheme === 'dark');
}

function loadTabSession(): { user: User | null; accessToken: string | null; csrfToken: string | null } {
  if (typeof window === 'undefined') {
    return { user: null, accessToken: null, csrfToken: null };
  }
  try {
    const raw = window.sessionStorage.getItem('ck_tab_session');
    if (!raw) return { user: null, accessToken: null, csrfToken: null };
    const parsed = JSON.parse(raw) as { user?: User; accessToken?: string; csrfToken?: string };
    return {
      user: parsed.user ?? null,
      accessToken: parsed.accessToken ?? null,
      csrfToken: parsed.csrfToken ?? null,
    };
  } catch {
    return { user: null, accessToken: null, csrfToken: null };
  }
}

const initialTabSession = loadTabSession();

export const useAppStore = create<AppState>((set) => ({
  user: initialTabSession.user,
  accessToken: initialTabSession.accessToken,
  csrfToken: initialTabSession.csrfToken,
  authChecked: Boolean(initialTabSession.user && initialTabSession.accessToken),
  theme: initialTheme,

  stations: [],
  selectedStationId: null,
  recentlyUpdatedChargerIds: {},
  userLocation: [28.6315, 77.2167], // Delhi Connaught Place default
  activeRoutePlan: null,

  notifications: [],
  toasts: [],
  wsConnected: false,
  demoRuntimeMode: 'backend',

  assistantOpen: false,
  assistantDraftPrompt: null,

  setAuth: (user, accessToken, csrfToken) => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('ck_has_session', '1');
      try {
        window.sessionStorage.setItem('ck_tab_session', JSON.stringify({ user, accessToken, csrfToken }));
      } catch {
        // Ignore storage quota errors
      }
    }
    set({ user, accessToken, csrfToken, authChecked: true });
  },
  setAuthChecked: (authChecked) => set({ authChecked }),
  clearAuth: () => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('ck_has_session');
      window.sessionStorage.removeItem('ck_tab_session');
    }
    set({ user: null, accessToken: null, csrfToken: null, notifications: [], authChecked: true });
  },

  toggleTheme: () =>
    set((state) => {
      const next = state.theme === 'dark' ? 'light' : 'dark';
      if (typeof document !== 'undefined') {
        document.documentElement.classList.toggle('dark', next === 'dark');
      }
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('ck_theme', next);
      }
      return { theme: next };
    }),

  setStations: (stations) => set({ stations }),
  setSelectedStationId: (selectedStationId) => set({ selectedStationId }),
  setUserLocation: (userLocation) => set({ userLocation }),
  setRoutePlan: (activeRoutePlan) => set({ activeRoutePlan }),

  applyChargerStatusDelta: (chargerId, stationId, status, lastUpdated) =>
    set((state) => ({
      stations: state.stations.map((st) => {
        if (st.id !== stationId) return st;
        const updatedChargers = st.chargers.map((c) =>
          c.id === chargerId ? { ...c, status, last_updated: lastUpdated } : c
        );
        return recomputeStationAggregates({ ...st, chargers: updatedChargers });
      }),
      recentlyUpdatedChargerIds: {
        ...state.recentlyUpdatedChargerIds,
        [chargerId]: Date.now(),
      },
    })),

  setNotifications: (notifications) => set({ notifications }),

  addToast: (toast) =>
    set((state) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      return { toasts: [...state.toasts.slice(-3), { ...toast, id }] };
    }),

  dismissToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),

  setWsConnected: (wsConnected) => set({ wsConnected }),
  setDemoRuntimeMode: (demoRuntimeMode) => set({ demoRuntimeMode }),

  openAssistant: (prompt) =>
    set({ assistantOpen: true, assistantDraftPrompt: prompt ?? null }),
  closeAssistant: () => set({ assistantOpen: false }),
  clearDraftPrompt: () => set({ assistantDraftPrompt: null }),
}));
