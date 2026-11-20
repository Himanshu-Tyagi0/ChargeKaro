const rawApiOrigin = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');

export const HAS_EXTERNAL_API_BASE = Boolean(rawApiOrigin);

export const API_BASE_URL = rawApiOrigin
  ? rawApiOrigin.endsWith('/api/v1')
    ? rawApiOrigin
    : `${rawApiOrigin}/api/v1`
  : '/api/v1';

export const API_HEALTH_URL = rawApiOrigin
  ? `${rawApiOrigin.replace(/\/api\/v1$/, '')}/api/health`
  : '/api/health';

export function getWsBaseUrl(): string {
  if (rawApiOrigin) {
    const clean = rawApiOrigin.replace(/\/api\/v1$/, '');
    return clean.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}`;
}
