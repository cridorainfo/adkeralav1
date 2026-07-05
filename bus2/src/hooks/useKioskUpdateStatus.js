import { useEffect, useState } from 'react';

/** Electron kiosk update progress (app download / install). */
export function useKioskUpdateStatus() {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    if (!window.adKeralaKiosk?.onUpdateStatus) return undefined;
    return window.adKeralaKiosk.onUpdateStatus(setStatus);
  }, []);

  return status;
}
