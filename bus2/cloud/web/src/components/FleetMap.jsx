import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, CircleMarker, useMap } from 'react-leaflet';
import L from 'leaflet';
import { api } from '../lib/api.js';
import { busDisplayLabel } from './BusContext.jsx';

const TRAIL_COLORS = ['#0b5c4a', '#2563eb', '#c2410c', '#7c3aed', '#b45309', '#be123c'];
const ROUTE_COLORS = ['#e8b923', '#1a8a7a', '#d45d3a', '#5a7268', '#147a63', '#8b5cf6'];
const TOMTOM_KEY = import.meta.env.VITE_TOMTOM_API_KEY ?? '';
const GPS_LIVE_MS = 45000;

const MAP_STYLES = {
  standard: {
    label: 'Standard',
    layers: [
      {
        url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        attribution: '© OpenStreetMap',
      },
    ],
  },
  satellite: {
    label: 'Satellite',
    layers: [
      {
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        attribution: '© Esri',
      },
    ],
  },
  terrain: {
    label: 'Terrain',
    layers: [
      {
        url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
        attribution: '© OpenTopoMap © OpenStreetMap',
      },
    ],
  },
  hybrid: {
    label: 'Hybrid',
    layers: [
      {
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        attribution: '© Esri',
      },
      {
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        attribution: '© Esri',
        opacity: 0.85,
      },
    ],
  },
  traffic: {
    label: TOMTOM_KEY ? 'Traffic' : 'Roads',
    layers: TOMTOM_KEY
      ? [
          {
            url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
            attribution: '© OpenStreetMap',
          },
          {
            url: `https://api.tomtom.com/traffic/map/4/tile/flow/relative/{z}/{x}/{y}.png?key=${TOMTOM_KEY}`,
            attribution: '© TomTom',
            opacity: 0.72,
          },
        ]
      : [
          {
            url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
            attribution: '© CARTO © OpenStreetMap',
          },
        ],
  },
};

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function routeStopPoints(route) {
  if (!route) return [];
  const ordered = [route.startStop, ...(route.stops ?? []), route.endStop].filter(Boolean);
  return ordered
    .filter((s) => Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lng)))
    .map((s) => ({
      lat: Number(s.lat),
      lng: Number(s.lng),
      en: s.en,
      ml: s.ml,
    }));
}

function routePolylinePositions(route) {
  return routeStopPoints(route).map((s) => [s.lat, s.lng]);
}

function routeColor(routeId, index) {
  let hash = 0;
  for (let i = 0; i < routeId.length; i += 1) hash = (hash * 31 + routeId.charCodeAt(i)) | 0;
  return ROUTE_COLORS[Math.abs(hash + index) % ROUTE_COLORS.length];
}

function busTrailColor(busId, index) {
  let hash = 0;
  for (let i = 0; i < busId.length; i += 1) hash = (hash * 31 + busId.charCodeAt(i)) | 0;
  return TRAIL_COLORS[Math.abs(hash + index) % TRAIL_COLORS.length];
}

function createBusIcon(label, { selected, gpsLive }) {
  const short =
    String(label).length > 22 ? `${String(label).slice(0, 20)}…` : String(label);
  const gpsClass = gpsLive ? 'gps-live' : 'gps-stale';
  return L.divIcon({
    className: 'fleet-bus-marker-wrap',
    html: `<div class="fleet-bus-marker ${selected ? 'selected' : ''} ${gpsClass}"><span class="fleet-bus-marker-pin"></span><span class="fleet-bus-marker-label">${escapeHtml(short)}</span></div>`,
    iconSize: [1, 1],
    iconAnchor: [14, 14],
  });
}

export function isGpsLive(loc) {
  if (!loc || loc.lat == null || loc.lng == null || loc.error) return false;
  const at = loc.at ?? 0;
  return Date.now() - at < GPS_LIVE_MS;
}

/** Current GPS fix, or last trail point when GPS dropped. */
export function resolveBusMapPosition(bus, trails = {}) {
  const loc = bus.telemetry?.driverLocation;
  if (loc?.lat != null && loc?.lng != null) {
    return { lat: loc.lat, lng: loc.lng, loc, gpsLive: isGpsLive(loc) };
  }
  const trail = trails[bus.busId] ?? [];
  const last = trail[trail.length - 1];
  if (last?.lat != null && last?.lng != null) {
    return { lat: last.lat, lng: last.lng, loc: last, gpsLive: false };
  }
  return null;
}

function mergeTrailPoints(...lists) {
  const byKey = new Map();
  for (const list of lists) {
    for (const point of list ?? []) {
      if (point?.lat == null || point?.lng == null) continue;
      const at = point.at ?? 0;
      const key = `${at}:${point.lat.toFixed(5)}:${point.lng.toFixed(5)}`;
      byKey.set(key, { lat: point.lat, lng: point.lng, at });
    }
  }
  return [...byKey.values()].sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
}

function FitBounds({ buses, trails, assignedRoutes }) {
  const map = useMap();
  const done = useRef(false);

  useEffect(() => {
    const points = [];
    for (const bus of buses ?? []) {
      const pos = resolveBusMapPosition(bus, trails);
      if (pos) points.push([pos.lat, pos.lng]);
    }
    for (const trail of Object.values(trails ?? {})) {
      for (const p of trail ?? []) {
        if (p?.lat != null) points.push([p.lat, p.lng]);
      }
    }
    for (const route of assignedRoutes ?? []) {
      for (const stop of routeStopPoints(route)) {
        points.push([stop.lat, stop.lng]);
      }
    }
    if (points.length && !done.current) {
      map.fitBounds(points, { padding: [48, 48] });
      done.current = true;
    }
  }, [buses, trails, assignedRoutes, map]);

  return null;
}

function MapStyleControl({ styleKey, onChange }) {
  return (
    <div className="fleet-map-style-control">
      {Object.entries(MAP_STYLES).map(([key, style]) => (
        <button
          key={key}
          type="button"
          className={`fleet-map-style-btn${styleKey === key ? ' active' : ''}`}
          onClick={() => onChange(key)}
        >
          {style.label}
        </button>
      ))}
    </div>
  );
}

function useBusTrails(buses, selectedBusId) {
  const liveRef = useRef({});
  const [serverTrails, setServerTrails] = useState({});
  const [tick, setTick] = useState(0);

  const busIds = useMemo(
    () => (buses ?? []).map((b) => b.busId).sort().join(','),
    [buses]
  );

  useEffect(() => {
    for (const bus of buses ?? []) {
      const loc = bus.telemetry?.driverLocation;
      if (loc?.lat == null || loc?.lng == null) continue;
      const id = bus.busId;
      const trail = liveRef.current[id] ?? [];
      const last = trail[trail.length - 1];
      const at = loc.at ?? Date.now();
      const moved =
        !last ||
        last.at !== at ||
        Math.abs(last.lat - loc.lat) > 0.00001 ||
        Math.abs(last.lng - loc.lng) > 0.00001;
      if (moved) {
        liveRef.current[id] = [...trail, { lat: loc.lat, lng: loc.lng, at }].slice(-500);
        setTick((t) => t + 1);
      }
    }
  }, [buses]);

  const fetchHistory = useCallback(async () => {
    const ids = busIds ? busIds.split(',').filter(Boolean) : [];
    if (!ids.length) {
      setServerTrails({});
      return;
    }
    const minutes = selectedBusId ? 180 : 60;
    const results = await Promise.all(
      ids.map(async (busId) => {
        try {
          const json = await api(
            `/api/buses/${encodeURIComponent(busId)}/locations?minutes=${minutes}&limit=500`
          );
          return [busId, json.points ?? []];
        } catch {
          return [busId, []];
        }
      })
    );
    setServerTrails(Object.fromEntries(results));
  }, [busIds, selectedBusId]);

  useEffect(() => {
    fetchHistory();
    const id = setInterval(fetchHistory, 30000);
    return () => clearInterval(id);
  }, [fetchHistory]);

  const trails = useMemo(() => {
    void tick;
    const merged = {};
    const ids = new Set([
      ...Object.keys(liveRef.current),
      ...Object.keys(serverTrails),
    ]);
    for (const busId of ids) {
      merged[busId] = mergeTrailPoints(serverTrails[busId], liveRef.current[busId]);
    }
    return merged;
  }, [serverTrails, tick]);

  return trails;
}

function useAssignedRoutes(selectedBusId) {
  const [routes, setRoutes] = useState([]);
  const [activeRouteId, setActiveRouteId] = useState(null);

  useEffect(() => {
    if (!selectedBusId) {
      setRoutes([]);
      setActiveRouteId(null);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const json = await api(`/api/buses/${encodeURIComponent(selectedBusId)}/routes`);
        if (cancelled) return;
        setRoutes(json.routes ?? []);
        setActiveRouteId(json.activeRouteId ?? null);
      } catch {
        if (!cancelled) {
          setRoutes([]);
          setActiveRouteId(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedBusId]);

  return { assignedRoutes: routes, activeRouteId };
}

export default function FleetMap({ buses, selectedBusId, onSelectBus }) {
  const [mapStyle, setMapStyle] = useState('standard');
  const trails = useBusTrails(buses, selectedBusId);
  const { assignedRoutes, activeRouteId } = useAssignedRoutes(selectedBusId);
  const mapMarkers = useMemo(
    () =>
      (buses ?? [])
        .map((bus) => {
          const pos = resolveBusMapPosition(bus, trails);
          return pos ? { bus, ...pos } : null;
        })
        .filter(Boolean),
    [buses, trails]
  );
  const style = MAP_STYLES[mapStyle] ?? MAP_STYLES.standard;

  return (
    <div className="map-container fleet-map-container">
      <MapStyleControl styleKey={mapStyle} onChange={setMapStyle} />
      <MapContainer center={[10.5, 76.5]} zoom={7} style={{ height: '100%', width: '100%' }}>
        {style.layers.map((layer, i) => (
          <TileLayer
            key={`${mapStyle}-${i}`}
            url={layer.url}
            attribution={layer.attribution}
            opacity={layer.opacity ?? 1}
            zIndex={i}
          />
        ))}
        <FitBounds buses={buses} trails={trails} assignedRoutes={assignedRoutes} />
        {selectedBusId &&
          assignedRoutes.map((route, routeIndex) => {
            const positions = routePolylinePositions(route);
            if (positions.length < 2) return null;
            const isActive = route.id === activeRouteId;
            const color = routeColor(route.id, routeIndex);
            return (
              <Polyline
                key={`route-${route.id}`}
                positions={positions}
                pathOptions={{
                  color,
                  weight: isActive ? 5 : 3,
                  opacity: isActive ? 0.9 : 0.45,
                  dashArray: isActive ? undefined : '10 8',
                  lineCap: 'round',
                  lineJoin: 'round',
                }}
              />
            );
          })}
        {selectedBusId &&
          assignedRoutes.flatMap((route, routeIndex) => {
            const color = routeColor(route.id, routeIndex);
            const isActive = route.id === activeRouteId;
            return routeStopPoints(route).map((stop) => (
              <CircleMarker
                key={`stop-${route.id}-${stop.en}`}
                center={[stop.lat, stop.lng]}
                radius={isActive ? 8 : 6}
                pathOptions={{
                  color: isActive ? '#063d32' : '#5a7268',
                  fillColor: color,
                  fillOpacity: isActive ? 0.95 : 0.7,
                  weight: 2,
                }}
              >
                <Popup>
                  <strong>{stop.en}</strong>
                  {stop.ml ? (
                    <>
                      <br />
                      <small>{stop.ml}</small>
                    </>
                  ) : null}
                  <br />
                  <small>{route.name}</small>
                </Popup>
              </CircleMarker>
            ));
          })}
        {mapMarkers.map(({ bus, gpsLive }, index) => {
          const trail = trails[bus.busId] ?? [];
          const positions = trail.map((p) => [p.lat, p.lng]);
          const selected = bus.busId === selectedBusId;
          const color = busTrailColor(bus.busId, index);
          if (positions.length < 2) return null;
          return (
            <Polyline
              key={`trail-${bus.busId}`}
              positions={positions}
              pathOptions={{
                color: gpsLive ? color : '#94a3b8',
                weight: selected ? 5 : 3,
                opacity: gpsLive ? (selected ? 0.9 : 0.55) : 0.35,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          );
        })}
        {mapMarkers.map(({ bus, lat, lng, loc, gpsLive }) => {
          const label = busDisplayLabel(bus);
          const selected = bus.busId === selectedBusId;
          return (
            <Marker
              key={bus.busId}
              position={[lat, lng]}
              icon={createBusIcon(label, { selected, gpsLive })}
              zIndexOffset={selected ? 1000 : gpsLive ? 100 : 0}
              eventHandlers={{ click: () => onSelectBus?.(bus.busId) }}
            >
              <Popup>
                <strong>{label}</strong>
                {selected ? ' (selected)' : ''}
                <br />
                <small>{bus.busId}</small>
                {!gpsLive && (
                  <>
                    <br />
                    <small>GPS unavailable — last known position</small>
                  </>
                )}
                {loc?.at ? (
                  <>
                    <br />
                    <small>
                      {gpsLive ? 'GPS' : 'Last GPS'} {new Date(loc.at).toLocaleString()}
                    </small>
                  </>
                ) : null}
                {(trails[bus.busId]?.length ?? 0) > 1 && (
                  <>
                    <br />
                    <small>{trails[bus.busId].length} trail points</small>
                  </>
                )}
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}

export function isBusOnline(updatedAt) {
  return updatedAt && Date.now() - updatedAt < 20000;
}
