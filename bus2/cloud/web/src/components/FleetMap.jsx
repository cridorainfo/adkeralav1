import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, CircleMarker, useMap } from 'react-leaflet';
import L from 'leaflet';
import { api } from '../lib/api.js';
import { busDisplayLabel } from './BusContext.jsx';
import {
  routeMapSegments,
  routeMapStopMarkers,
  toMapPosition,
  trailMapSegments,
} from '../lib/mapCoords.js';

const TRAIL_COLORS = ['#0b5c4a', '#2563eb', '#c2410c', '#7c3aed', '#b45309', '#be123c'];
const ROUTE_COLORS = ['#e8b923', '#1a8a7a', '#d45d3a', '#5a7268', '#147a63', '#8b5cf6'];
const TOMTOM_KEY = import.meta.env.VITE_TOMTOM_API_KEY ?? '';
const GPS_LIVE_MS = 90000;

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

export function isGpsLive(loc, busUpdatedAt = 0) {
  if (!loc || loc.lat == null || loc.lng == null || loc.error) return false;
  const at = loc.at ?? 0;
  if (at > 0 && Date.now() - at < GPS_LIVE_MS) return true;
  return Boolean(busUpdatedAt && Date.now() - busUpdatedAt < GPS_LIVE_MS);
}

/** Current GPS fix, or last trail point when GPS dropped. */
export function resolveBusMapPosition(bus, trails = {}) {
  const loc = bus.telemetry?.driverLocation;
  const busUpdatedAt = bus.updatedAt ?? 0;
  const fromTelemetry = loc ? toMapPosition(loc.lat, loc.lng) : null;
  if (fromTelemetry) {
    return {
      lat: fromTelemetry.lat,
      lng: fromTelemetry.lng,
      loc,
      gpsLive: isGpsLive(loc, busUpdatedAt),
    };
  }
  const trail = trails[bus.busId] ?? [];
  for (let i = trail.length - 1; i >= 0; i -= 1) {
    const pos = toMapPosition(trail[i]?.lat, trail[i]?.lng);
    if (pos) {
      return {
        lat: pos.lat,
        lng: pos.lng,
        loc: trail[i],
        gpsLive: isGpsLive(trail[i], busUpdatedAt),
      };
    }
  }
  return null;
}

function mergeTrailPoints(...lists) {
  const byKey = new Map();
  for (const list of lists) {
    for (const point of list ?? []) {
      const pos = toMapPosition(point?.lat, point?.lng);
      if (!pos) continue;
      const at = point.at ?? 0;
      const key = `${at}:${pos.lat.toFixed(5)}:${pos.lng.toFixed(5)}`;
      byKey.set(key, { lat: pos.lat, lng: pos.lng, at });
    }
  }
  return [...byKey.values()].sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
}

/**
 * Keeps the view fitted automatically — the whole fleet when nothing is selected,
 * or the selected bus (following it + its trail) once one is picked. Any manual
 * drag/zoom by the admin disengages auto-fit until they select a bus again or hit
 * "Recenter".
 */
function MapViewController({ buses, trails, assignedRoutes, selectedBusId, mapMarkers }) {
  const map = useMap();
  const [userInteracted, setUserInteracted] = useState(false);
  const programmaticZoomRef = useRef(false);
  const lastSelectedRef = useRef(selectedBusId);
  const overviewFitDoneRef = useRef(false);
  const lastOverviewKeyRef = useRef('');

  useEffect(() => {
    const onDragStart = () => setUserInteracted(true);
    const onZoomStart = () => {
      if (programmaticZoomRef.current) {
        programmaticZoomRef.current = false;
        return;
      }
      setUserInteracted(true);
    };
    map.on('dragstart', onDragStart);
    map.on('zoomstart', onZoomStart);
    return () => {
      map.off('dragstart', onDragStart);
      map.off('zoomstart', onZoomStart);
    };
  }, [map]);

  const fitTo = useCallback(
    (points) => {
      if (!points.length) return;
      programmaticZoomRef.current = true;
      if (points.length === 1) {
        map.setView(points[0], Math.max(map.getZoom(), 15), { animate: true });
      } else {
        map.fitBounds(points, { padding: [56, 56], maxZoom: 16, animate: true });
      }
    },
    [map]
  );

  // Selecting a (different) bus re-engages auto-follow for it.
  useEffect(() => {
    if (selectedBusId !== lastSelectedRef.current) {
      lastSelectedRef.current = selectedBusId;
      setUserInteracted(false);
    }
  }, [selectedBusId]);

  useEffect(() => {
    if (userInteracted) return;

    if (selectedBusId) {
      const points = [];
      const marker = (mapMarkers ?? []).find((m) => m.bus.busId === selectedBusId);
      if (marker) points.push([marker.lat, marker.lng]);
      for (const p of trails[selectedBusId] ?? []) {
        if (p?.lat != null) points.push([p.lat, p.lng]);
      }
      for (const route of assignedRoutes ?? []) {
        for (const stop of routeMapStopMarkers(route)) points.push([stop.lat, stop.lng]);
      }
      if (points.length) fitTo(points);
      return;
    }

    const points = [];
    for (const bus of buses ?? []) {
      const pos = resolveBusMapPosition(bus, trails);
      if (pos) points.push([pos.lat, pos.lng]);
    }
    const key = (mapMarkers ?? []).map((m) => m.bus.busId).sort().join(',');
    if (points.length && (!overviewFitDoneRef.current || key !== lastOverviewKeyRef.current)) {
      fitTo(points);
      overviewFitDoneRef.current = true;
      lastOverviewKeyRef.current = key;
    }
  }, [buses, trails, assignedRoutes, selectedBusId, mapMarkers, userInteracted, fitTo]);

  if (!userInteracted) return null;

  return (
    <button
      type="button"
      className="fleet-map-recenter-btn"
      onClick={() => setUserInteracted(false)}
    >
      Recenter
    </button>
  );
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
      const pos = loc ? toMapPosition(loc.lat, loc.lng) : null;
      if (!pos) continue;
      const id = bus.busId;
      const trail = liveRef.current[id] ?? [];
      const last = trail[trail.length - 1];
      const at = loc.at ?? Date.now();
      const moved =
        !last ||
        last.at !== at ||
        Math.abs(last.lat - pos.lat) > 0.00001 ||
        Math.abs(last.lng - pos.lng) > 0.00001;
      if (moved) {
        liveRef.current[id] = [...trail, { lat: pos.lat, lng: pos.lng, at }].slice(-500);
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
        <MapViewController
          buses={buses}
          trails={trails}
          assignedRoutes={assignedRoutes}
          selectedBusId={selectedBusId}
          mapMarkers={mapMarkers}
        />
        {selectedBusId &&
          assignedRoutes.flatMap((route, routeIndex) => {
            const segments = routeMapSegments(route);
            const isActive = route.id === activeRouteId;
            const color = routeColor(route.id, routeIndex);
            return segments.map((positions, segIndex) => (
              <Polyline
                key={`route-${route.id}-seg-${segIndex}`}
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
            ));
          })}
        {selectedBusId &&
          assignedRoutes.flatMap((route, routeIndex) => {
            const color = routeColor(route.id, routeIndex);
            const isActive = route.id === activeRouteId;
            return routeMapStopMarkers(route).map((stop) => (
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
        {mapMarkers.flatMap(({ bus, gpsLive }, index) => {
          const trail = trails[bus.busId] ?? [];
          const selected = bus.busId === selectedBusId;
          const color = busTrailColor(bus.busId, index);
          return trailMapSegments(trail).map((positions, segIndex) => (
            <Polyline
              key={`trail-${bus.busId}-${segIndex}`}
              positions={positions}
              pathOptions={{
                color: gpsLive ? color : '#94a3b8',
                weight: selected ? 5 : 3,
                opacity: gpsLive ? (selected ? 0.9 : 0.55) : 0.35,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          ));
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
                      {loc?.source === 'phone' ? ' · via driver phone' : ''}
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
