import { useCallback, useEffect, useState } from 'react';
import { getStoredDriverToken } from '../lib/driverCredentials';

/** Load / save ESP32 settings on the bus PC from the driver phone (same Wi‑Fi). */
export function useRemoteBusSerial({ lanIp, port = 5174, enabled = true }) {
  const [serialSettings, setSerialSettings] = useState({});
  const [serialRuntime, setSerialRuntime] = useState(null);
  const [ready, setReady] = useState(false);

  const baseUrl = lanIp ? `http://${lanIp}:${port}` : null;

  const refresh = useCallback(async () => {
    if (!baseUrl) return;
    try {
      const res = await fetch(`${baseUrl}/api/state`);
      const json = await res.json();
      if (json.ok && json.data) {
        setSerialSettings(json.data.serialSettings ?? {});
        setSerialRuntime(json.data.serialRuntime ?? null);
        setReady(true);
      }
    } catch {
      /* bus LAN unreachable */
    }
  }, [baseUrl]);

  useEffect(() => {
    if (!enabled || !baseUrl) {
      setReady(false);
      return undefined;
    }
    refresh();
    const id = window.setInterval(refresh, 3000);
    return () => window.clearInterval(id);
  }, [enabled, baseUrl, refresh]);

  const updateSerialSettings = useCallback(
    async (patch) => {
      if (!baseUrl) return;
      const prev = serialSettings;
      const next = {
        ...prev,
        ...patch,
        buttonMappings: patch.buttonMappings
          ? { ...prev.buttonMappings, ...patch.buttonMappings }
          : prev.buttonMappings,
      };
      setSerialSettings(next);

      const headers = { 'Content-Type': 'application/json' };
      const token = getStoredDriverToken();
      if (token) headers['X-Driver-Token'] = token;

      try {
        const res = await fetch(`${baseUrl}/api/state`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ serialSettings: next }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setSerialSettings(prev);
          throw new Error(json.error || 'Could not save ESP32 settings');
        }
        await refresh();
      } catch (err) {
        setSerialSettings(prev);
        throw err;
      }
    },
    [baseUrl, refresh, serialSettings]
  );

  return {
    serialSettings,
    serialRuntime,
    updateSerialSettings,
    refresh,
    ready,
    reachable: Boolean(baseUrl),
  };
}
