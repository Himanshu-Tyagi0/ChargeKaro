import axios from 'axios';
import { useAppStore } from '../store/useAppStore';

export const apiClient = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,
  timeout: 25000,
});

apiClient.interceptors.request.use((config) => {
  const { accessToken, csrfToken } = useAppStore.getState();
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  if (csrfToken) {
    config.headers['X-CSRF-Token'] = csrfToken;
  }
  return config;
});

let refreshPromise: Promise<string | null> | null = null;

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config as (typeof error.config & { _retry?: boolean; _transientRetries?: number }) | undefined;
    const status = error.response?.status;
    const isTransient = !error.response || status === 502 || status === 503 || status === 504;
    const method = (original?.method || 'get').toLowerCase();
    const canRetryTransient =
      original &&
      isTransient &&
      (method === 'get' || original.url?.includes('/auth/login') || original.url?.includes('/auth/refresh')) &&
      (original._transientRetries ?? 0) < 3;

    if (canRetryTransient && original) {
      original._transientRetries = (original._transientRetries ?? 0) + 1;
      const delayMs = original._transientRetries * 1200;
      await new Promise((r) => setTimeout(r, delayMs));
      return apiClient(original);
    }

    if (
      status === 401 &&
      original &&
      !original._retry &&
      !original.url?.includes('/auth/login') &&
      !original.url?.includes('/auth/refresh')
    ) {
      original._retry = true;
      try {
        if (!refreshPromise) {
          refreshPromise = axios
            .post('/api/v1/auth/refresh', {}, { withCredentials: true })
            .then((res) => {
              const data = res.data;
              useAppStore.getState().setAuth(data.user, data.access_token, data.csrf_token);
              return data.access_token as string;
            })
            .catch(() => {
              useAppStore.getState().clearAuth();
              return null;
            })
            .finally(() => {
              refreshPromise = null;
            });
        }
        const newToken = await refreshPromise;
        if (newToken) {
          original.headers.Authorization = `Bearer ${newToken}`;
          return apiClient(original);
        }
      } catch {
        useAppStore.getState().clearAuth();
      }
    }
    return Promise.reject(error);
  }
);
