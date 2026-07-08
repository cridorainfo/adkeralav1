import { useEffect, useState } from 'react';

// `json.ok` only means the HTTP call itself succeeded — the server always returns it even
// when reporting "no LAN IP yet" or "probe failed" (see server/networkInfo.js). Stopping on
// `ok` alone let the Display's QR/control-URL freeze on a bad first read if Wi‑Fi/hotspot/
// firewall wasn't ready yet at boot, since the fast poll would never run again. Only relax
// once `lanReachable` is actually true, and even then keep a slow keep-fresh poll instead of
// stopping outright, so a later Wi‑Fi drop is caught too.
const FAST_POLL_MS = 4000;
const SLOW_POLL_MS = 30000;

export function useNetworkUrls() {
  const [urls, setUrls] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let timer = null;

    const schedule = (ms) => {
      if (timer) clearInterval(timer);
      timer = setInterval(load, ms);
    };

    const load = () => {
      fetch('/api/network')
        .then((r) => r.json())
        .then((json) => {
          if (cancelled) return;
          if (json.ok) {
            setUrls(json);
            schedule(json.lanReachable ? SLOW_POLL_MS : FAST_POLL_MS);
          }
        })
        .catch(() => {});
    };

    load();
    timer = setInterval(load, FAST_POLL_MS);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, []);

  return urls;
}
