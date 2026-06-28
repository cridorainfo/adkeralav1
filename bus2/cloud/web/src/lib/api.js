export async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
    ...options,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error ?? `Request failed (${res.status})`);
  }
  return json;
}

export async function uploadMedia(file, category = 'stops') {
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  return api('/api/media/upload', {
    method: 'POST',
    body: JSON.stringify({ data, filename: file.name, category }),
  });
}

export async function fleetBroadcast({ targetBusIds, commandType, payload }) {
  return api('/api/fleet/broadcast', {
    method: 'POST',
    body: JSON.stringify({ targetBusIds, commandType, payload }),
  });
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
