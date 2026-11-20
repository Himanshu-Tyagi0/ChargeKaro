import axios, { type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { useAppStore } from '../store/useAppStore';
import { API_BASE_URL, API_HEALTH_URL, HAS_EXTERNAL_API_BASE } from './config';
import { handleStaticDemoRequest } from './staticDemoRuntime';

let standaloneDemoMode = false;
let backendProbePromise: Promise<boolean> | null = null;

function isHtmlPayload(data: unknown): boolean {
  return typeof data === 'string' && /^\s*<!doctype\s+html/i.test(data);
}

async function detectMissingBackend(): Promise<boolean> {
  if (standaloneDemoMode) return true;
  if (HAS_EXTERNAL_API_BASE) return false;
  if (backendProbePromise) return backendProbePromise;

  backendProbePromise = (async () => {
    try {
      const res = await fetch(API_HEALTH_URL, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(2500),
      });
      if (res.status === 404 || res.status === 405) {
        standaloneDemoMode = true;
        useAppStore.getState().setDemoRuntimeMode('standalone');
        return true;
      }
      const ctype = (res.headers.get('content-type') || '').toLowerCase();
      if (ctype.includes('text/html')) {
        standaloneDemoMode = true;
        useAppStore.getState().setDemoRuntimeMode('standalone');
        return true;
      }
      if (res.ok) {
        const json = (await res.json().catch(() => null)) as { service?: string } | null;
        if (json?.service === 'chargekaro-api') {
          return false;
        }
      }
      return false;
    } catch {
      return false;
    } finally {
      backendProbePromise = null;
    }
  })();

  return backendProbePromise;
}

function executeStandaloneAdapter(config: InternalAxiosRequestConfig) {
  const method = (config.method || 'get').toUpperCase();
  const url = config.url || '/';
  const params = (config.params as Record<string, unknown>) || {};
  let body: Record<string, unknown> = {};
  if (typeof config.data === 'string') {
    try {
      body = JSON.parse(config.data) as Record<string, unknown>;
    } catch {
      body = {};
    }
  } else if (config.data && typeof config.data === 'object') {
    body = config.data as Record<string, unknown>;
  }
  const authHeader =
    (config.headers?.Authorization as string | undefined) ||
    (useAppStore.getState().accessToken ? `Bearer ${useAppStore.getState().accessToken}` : undefined);

  const data = handleStaticDemoRequest(method, url, params, body, authHeader);
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  };
}

const defaultAdapter: AxiosAdapter = axios.getAdapter(axios.defaults.adapter);

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  timeout: 25000,
  adapter: async (config) => {
    if (standaloneDemoMode) {
      return executeStandaloneAdapter(config);
    }
    const response = await defaultAdapter(config);
    if (!HAS_EXTERNAL_API_BASE && isHtmlPayload(response.data)) {
      const noBackend = await detectMissingBackend();
      if (noBackend) {
        return executeStandaloneAdapter(config);
      }
    }
    return response;
  },
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
    const htmlFallback = isHtmlPayload(error.response?.data);

    if (original && !HAS_EXTERNAL_API_BASE && (status === 404 || status === 405 || htmlFallback)) {
      const noBackend = await detectMissingBackend();
      if (noBackend) {
        return executeStandaloneAdapter(original);
      }
    }

    const isTransient = !error.response || status === 502 || status === 503 || status === 504;
    const method = (original?.method || 'get').toLowerCase();
    const canRetryTransient =
      original &&
      !standaloneDemoMode &&
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
          refreshPromise = apiClient
            .post('/auth/refresh', {})
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
