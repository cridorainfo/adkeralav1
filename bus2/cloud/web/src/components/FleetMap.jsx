import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';

const defaultIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

function FitBounds({ buses }) {
  const map = useMap();
  const done = useRef(false);

  useEffect(() => {
    const points = (buses ?? [])
      .map((b) => b.telemetry?.driverLocation)
      .filter((loc) => loc?.lat != null)
      .map((loc) => [loc.lat, loc.lng]);

    if (points.length && !done.current) {
      map.fitBounds(points, { padding: [40, 40] });
      done.current = true;
    }
  }, [buses, map]);

  return null;
}

export default function FleetMap({ buses, selectedBusId, onSelectBus }) {
  const markers = (buses ?? []).filter((b) => b.telemetry?.driverLocation?.lat != null);

  return (
    <div className="map-container">
      <MapContainer center={[10.5, 76.5]} zoom={7} style={{ height: '100%', width: '100%' }}>
        <TileLayer attribution="© OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <FitBounds buses={buses} />
        {markers.map((bus) => {
          const loc = bus.telemetry.driverLocation;
          return (
            <Marker
              key={bus.busId}
              position={[loc.lat, loc.lng]}
              icon={defaultIcon}
              eventHandlers={{ click: () => onSelectBus?.(bus.busId) }}
            >
              <Popup>
                <strong>{bus.busId}</strong>
                {bus.busId === selectedBusId ? ' (selected)' : ''}
                {loc.at ? (
                  <>
                    <br />
                    <small>GPS {new Date(loc.at).toLocaleTimeString()}</small>
                  </>
                ) : null}
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
