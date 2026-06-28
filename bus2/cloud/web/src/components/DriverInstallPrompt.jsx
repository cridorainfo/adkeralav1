import { useEffect, useState } from 'react';

function isIos() {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

function isStandalone() {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

/** Prompt to install the driver page as a PWA for better background GPS on mobile. */
export default function DriverInstallPrompt({ linked = false }) {
  const [deferred, setDeferred] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const [showIosHint, setShowIosHint] = useState(false);

  useEffect(() => {
    if (isStandalone()) return undefined;
    const key = 'adkerala_driver_pwa_dismiss';
    if (localStorage.getItem(key)) {
      setDismissed(true);
      return undefined;
    }
    if (isIos()) {
      setShowIosHint(true);
      return undefined;
    }
    const onPrompt = (e) => {
      e.preventDefault();
      setDeferred(e);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  const dismiss = () => {
    localStorage.setItem('adkerala_driver_pwa_dismiss', '1');
    setDismissed(true);
    setDeferred(null);
    setShowIosHint(false);
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    dismiss();
  };

  if (isStandalone() || dismissed) return null;
  if (!linked && !deferred && !showIosHint) return null;

  return (
    <div className="driver-pwa-banner" role="region" aria-label="Install app">
      <div className="driver-pwa-banner-text">
        <strong>Install for continuous GPS</strong>
        <p>
          {showIosHint
            ? 'Tap Share → Add to Home Screen, then open from the icon. Keep location set to “While Using” and leave the app open for best tracking on iPhone.'
            : 'Add to your home screen so GPS keeps running when the screen is off or you switch apps (Android).'}
        </p>
      </div>
      <div className="driver-pwa-banner-actions">
        {deferred && (
          <button type="button" className="btn btn-primary btn-sm" onClick={install}>
            Install app
          </button>
        )}
        {showIosHint && (
          <button type="button" className="btn btn-primary btn-sm" onClick={dismiss}>
            Got it
          </button>
        )}
        <button type="button" className="btn btn-outline btn-sm" onClick={dismiss}>
          Not now
        </button>
      </div>
    </div>
  );
}
