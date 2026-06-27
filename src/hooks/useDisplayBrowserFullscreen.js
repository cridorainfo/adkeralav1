import { useEffect, useRef } from 'react';
import {
  exitBrowserFullscreen,
  requestBrowserFullscreen,
  subscribeBrowserFullscreen,
} from '../lib/fullscreenChannel';

/**
 * Keeps the /display tab in native browser fullscreen when passenger mode is active.
 * Serial / control-panel commands update shared state and broadcast to this tab.
 */
export function useDisplayBrowserFullscreen(isFullscreen, exitToControl) {
  const isFullscreenRef = useRef(isFullscreen);
  isFullscreenRef.current = isFullscreen;

  const exitRef = useRef(exitToControl);
  exitRef.current = exitToControl;

  useEffect(() => {
    if (isFullscreen) {
      requestBrowserFullscreen();
    } else {
      exitBrowserFullscreen();
    }
  }, [isFullscreen]);

  useEffect(() => {
    return subscribeBrowserFullscreen(
      () => requestBrowserFullscreen(),
      () => exitBrowserFullscreen()
    );
  }, []);

  useEffect(() => {
    const retryIfNeeded = () => {
      if (isFullscreenRef.current && !document.fullscreenElement) {
        requestBrowserFullscreen();
      }
    };

    window.addEventListener('focus', retryIfNeeded);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') retryIfNeeded();
    });

    return () => {
      window.removeEventListener('focus', retryIfNeeded);
    };
  }, []);

  useEffect(() => {
    let wasBrowserFullscreen = false;

    const onFullscreenChange = () => {
      if (document.fullscreenElement) {
        wasBrowserFullscreen = true;
        return;
      }
      if (wasBrowserFullscreen && isFullscreenRef.current) {
        wasBrowserFullscreen = false;
        exitRef.current?.();
      }
    };

    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);
}
