import { useEffect } from 'react';
import { isLikelyBrowserFullscreen, requestBrowserFullscreen } from '../lib/fullscreenChannel';

/**
 * Request F11-style fullscreen (Fullscreen API) on load when the window is not
 * already fullscreen (e.g. Cursor preview or a normal browser tab).
 *
 * When run.bat / run.ps1 launch Chrome (?autofs=1), skip this — the script
 * sends F11 after the window opens. A pointerdown handler here breaks tabs.
 */
export function usePersistentBrowserFullscreen() {
  useEffect(() => {
    const launchedByScript =
      new URLSearchParams(window.location.search).get('autofs') === '1';
    if (launchedByScript || isLikelyBrowserFullscreen()) return;

    const enter = () => {
      if (isLikelyBrowserFullscreen()) return;
      requestBrowserFullscreen();
    };

    enter();
    const retry1 = window.setTimeout(enter, 300);
    const retry2 = window.setTimeout(enter, 1200);

    const onFirstClick = () => {
      // Defer so button/link clicks (tab switches) run first.
      window.setTimeout(enter, 0);
    };
    window.addEventListener('pointerdown', onFirstClick, { once: true });

    return () => {
      window.clearTimeout(retry1);
      window.clearTimeout(retry2);
      window.removeEventListener('pointerdown', onFirstClick);
    };
  }, []);
}
