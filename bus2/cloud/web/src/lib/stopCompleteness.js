/** Mirror server missing-tag logic for client-side filters. */

export const MISSING_LABELS = {
  english_name: 'English',
  malayalam_text: 'Malayalam',
  gps_coords: 'GPS',
};

export function getStopMissingTags(stop) {
  const missing = [];
  const en = String(stop?.en ?? '').trim();
  if (!en) missing.push('english_name');
  if (!String(stop?.ml ?? '').trim()) missing.push('malayalam_text');
  const lat = stop?.lat != null && stop.lat !== '' ? Number(stop.lat) : null;
  const lng = stop?.lng != null && stop.lng !== '' ? Number(stop.lng) : null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) missing.push('gps_coords');
  return missing;
}

export function formatGps(stop) {
  const lat = stop?.lat != null ? Number(stop.lat) : null;
  const lng = stop?.lng != null ? Number(stop.lng) : null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

/** Single high-accuracy GPS fix for field capture. */
export function captureCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('GPS not available in this browser'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          at: pos.timestamp,
        });
      },
      (err) => reject(err),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
    );
  });
}
