import { useEffect } from 'react';
import { apiClient } from '../api/client';
import { useAppStore } from '../store/useAppStore';
import type { ChargerStatus, Station } from '../types';

export function useWebSockets(onRefreshStations?: () => void) {
  const accessToken = useAppStore((s) => s.accessToken);
  const user = useAppStore((s) => s.user);
  const applyDelta = useAppStore((s) => s.applyChargerStatusDelta);
  const setWsConnected = useAppStore((s) => s.setWsConnected);
  const addToast = useAppStore((s) => s.addToast);
  const setNotifications = useAppStore((s) => s.setNotifications);
  const setStations = useAppStore((s) => s.setStations);
  const userLocation = useAppStore((s) => s.userLocation);

  // Public live charger status stream
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let closedByUser = false;

    const connect = () => {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${proto}//${window.location.host}/ws/status`);

      ws.onopen = () => {
        setWsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'charger_status' && msg.charger_id && msg.station_id && msg.status) {
            applyDelta(
              Number(msg.charger_id),
              Number(msg.station_id),
              msg.status as ChargerStatus,
              msg.last_updated || new Date().toISOString()
            );
          } else if (msg.type === 'full_refresh') {
            if (onRefreshStations) {
              onRefreshStations();
            } else {
              apiClient
                .get<Station[]>('/stations', {
                  params: { lat: userLocation[0], lng: userLocation[1] },
                })
                .then((res) => setStations(res.data))
                .catch(() => {});
            }
          }
        } catch {
          // Ignore malformed WS frame
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (!closedByUser) {
          reconnectTimer = window.setTimeout(connect, 3500);
        }
      };

      ws.onerror = () => {
        ws?.close();
      };
    };

    connect();
    return () => {
      closedByUser = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [applyDelta, onRefreshStations, setStations, setWsConnected, userLocation]);

  // Authenticated private user notification & booking alert stream
  useEffect(() => {
    if (!user || !accessToken) return;
    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let closedByUser = false;

    const fetchNotifications = () => {
      apiClient
        .get('/auth/notifications')
        .then((res) => setNotifications(res.data))
        .catch(() => {});
    };
    fetchNotifications();

    const connectPrivate = () => {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${proto}//${window.location.host}/ws/me?token=${encodeURIComponent(accessToken)}`);

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'booking_confirmed') {
            addToast({
              title: 'Booking Confirmed',
              message: `${msg.charger_label} at ${msg.station_name} is reserved.`,
              variant: 'success',
            });
            fetchNotifications();
          } else if (msg.type === 'booking_alert' || msg.type === 'monitoring_alert') {
            addToast({
              title: msg.title || 'Live Alert',
              message: msg.message || 'Check your notifications for details.',
              variant: 'warning',
            });
            fetchNotifications();
          } else if (msg.type === 'session_complete') {
            addToast({
              title: 'Session Complete',
              message: `Delivered ${msg.kwh_delivered} kWh · Total ₹${msg.total_paid_inr}`,
              variant: 'success',
            });
            fetchNotifications();
          } else if (msg.type === 'booking_expired') {
            addToast({
              title: 'Booking Expired (No-Show)',
              message: 'Your slot expired 10 minutes past start time without check-in.',
              variant: 'warning',
            });
            fetchNotifications();
          }
        } catch {
          // Ignore malformed private WS frame
        }
      };

      ws.onclose = () => {
        if (!closedByUser) {
          reconnectTimer = window.setTimeout(connectPrivate, 4000);
        }
      };
    };

    connectPrivate();
    return () => {
      closedByUser = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [accessToken, addToast, setNotifications, user]);
}
