import { useEffect, useState } from 'react';

export function useNetworkUrls() {
  const [urls, setUrls] = useState(null);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/network')
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled && json.ok) setUrls(json);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  return urls;
}
