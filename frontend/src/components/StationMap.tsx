import { useEffect, useRef } from 'react';
import L from 'leaflet';
import type { RoutePlan, Station } from '../types';
import { getStationMarkerColor } from '../utils/stationHelpers';

interface StationMapProps {
  stations: Station[];
  selectedStationId: number | null;
  onSelectStation: (station: Station) => void;
  userLocation: [number, number];
  routePlan: RoutePlan | null;
}

const COLOR_HEX: Record<string, string> = {
  green: '#10B981',
  amber: '#F59E0B',
  red: '#EF4444',
  grey: '#64748B',
};

export function StationMap({
  stations,
  selectedStationId,
  onSelectStation,
  userLocation,
  routePlan,
}: StationMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const didFitInitialRef = useRef(false);

  // Initialize Leaflet map once + observe container resize
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: userLocation,
      zoom: 11,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    markersLayerRef.current = L.layerGroup().addTo(map);
    routeLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    const ro = new ResizeObserver(() => {
      map.invalidateSize({ animate: false });
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Render station markers and user location pin
  useEffect(() => {
    const map = mapRef.current;
    const layer = markersLayerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();

    // User location marker
    const userIcon = L.divIcon({
      className: 'chargekaro-marker-wrapper',
      html: `<div style="width:16px;height:16px;border-radius:9999px;background:#0EA5E9;border:3px solid #ffffff;box-shadow:0 2px 6px rgba(0,0,0,0.4);"></div>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });
    L.marker(userLocation, { icon: userIcon, title: 'Your Location' })
      .bindTooltip('Your Location (Delhi-NCR)', { direction: 'top' })
      .addTo(layer);

    stations.forEach((st) => {
      const health = getStationMarkerColor(st.chargers);
      const color = COLOR_HEX[health];
      const isSelected = st.id === selectedStationId;
      const scale = isSelected ? 'scale(1.18)' : 'scale(1)';
      const ring = isSelected ? '0 0 0 3px #ffffff, 0 6px 16px rgba(0,0,0,0.45)' : '0 3px 10px rgba(0,0,0,0.35)';

      const icon = L.divIcon({
        className: 'chargekaro-marker-wrapper',
        html: `
          <div style="
            display:flex;align-items:center;justify-content:center;
            min-width:44px;height:28px;padding:0 8px;border-radius:9999px;
            background:#0F172A;color:#F8FAFC;border:2px solid ${color};
            font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;
            box-shadow:${ring};transform:${scale};transition:transform 160ms ease;
          ">
            <span style="width:7px;height:7px;border-radius:9999px;background:${color};margin-right:5px;display:inline-block;"></span>
            <span>${st.free_chargers}/${st.total_chargers}</span>
          </div>
        `,
        iconSize: [48, 28],
        iconAnchor: [24, 14],
      });

      const marker = L.marker([st.latitude, st.longitude], {
        icon,
        title: `${st.name} (${st.free_chargers}/${st.total_chargers} free)`,
      });
      marker.on('click', () => onSelectStation(st));
      marker.bindTooltip(`${st.name} · ${st.free_chargers}/${st.total_chargers} free`, { direction: 'top' });
      marker.addTo(layer);
    });

    if (!didFitInitialRef.current && stations.length > 1 && !selectedStationId && !routePlan) {
      const bounds = L.latLngBounds(stations.map((s) => [s.latitude, s.longitude] as [number, number]));
      map.fitBounds(bounds, { padding: [36, 36], maxZoom: 12 });
      didFitInitialRef.current = true;
    }
  }, [stations, selectedStationId, userLocation, onSelectStation, routePlan]);

  // Pan smoothly to selected station
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedStationId) return;
    const found = stations.find((s) => s.id === selectedStationId);
    if (found) {
      map.panTo([found.latitude, found.longitude], { animate: true, duration: 0.45 });
    }
  }, [selectedStationId, stations]);

  // Render Route & Range Plan corridor polyline & stops
  useEffect(() => {
    const map = mapRef.current;
    const routeLayer = routeLayerRef.current;
    if (!map || !routeLayer) return;

    routeLayer.clearLayers();
    if (!routePlan || routePlan.polyline.length < 2) return;

    const line = L.polyline(routePlan.polyline, {
      color: '#0EA5E9',
      weight: 4,
      opacity: 0.9,
      dashArray: '8 6',
    }).addTo(routeLayer);

    routePlan.recommended_stops.forEach((stop, idx) => {
      const stopIcon = L.divIcon({
        className: 'chargekaro-marker-wrapper',
        html: `<div style="background:#0EA5E9;color:#082F49;font-weight:700;font-size:11px;padding:3px 8px;border-radius:8px;border:2px solid #fff;box-shadow:0 3px 10px rgba(0,0,0,0.4);white-space:nowrap;">Stop ${idx + 1}: ${stop.station_name}</div>`,
        iconSize: [140, 24],
        iconAnchor: [70, 32],
      });
      L.marker([stop.latitude, stop.longitude], { icon: stopIcon }).addTo(routeLayer);
    });

    map.fitBounds(line.getBounds(), { padding: [50, 50] });
  }, [routePlan]);

  return (
    <div
      ref={containerRef}
      data-testid="station-leaflet-map"
      className="relative isolate z-0 h-full w-full min-h-[280px] rounded-xl border border-slate-200 dark:border-slate-800"
      aria-label="Delhi-NCR EV Charging Stations Interactive Map"
    />
  );
}
