import { useEffect, useState } from 'react';

export function useNetworkUrls() {
  const [urls, setUrls] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let timer = null;

    const load = () => {
      fetch('/api/network')
        .then((r) => r.json())
        .then((json) => {
          if (cancelled) return;
          if (json.ok) {
            setUrls(json);
            if (timer) {
              clearInterval(timer);
              timer = null;
            }
          }
        })
        .catch(() => {});
    };

    load();
    timer = setInterval(load, 4000);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, []);

  return urls;
}
