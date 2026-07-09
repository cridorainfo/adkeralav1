import { useEffect } from 'react';
import { useBusStore } from '../hooks/useBusStore';
import { useDisplayBrowserFullscreen } from '../hooks/useDisplayBrowserFullscreen';
import { useAnnouncementPlayback } from '../hooks/useAnnouncementPlayback';
import { useRemoteStateSync } from '../hooks/useRemoteStateSync';
import { useBusPcEspSerial } from '../hooks/useBusPcEspSerial';
import { isKioskMode, isLaunchedByRunScript } from '../lib/appRole';
import FleetSetupOverlay from '../components/FleetSetupOverlay';
import UpdateOverlay from '../components/UpdateOverlay';
import AppVersionBadge from '../components/AppVersionBadge';
import DisplayScreen from './DisplayScreen';

/** Passenger screen — open on bus PC at /display */
export default function DisplayApp() {
  const {
    state,
    exitToControl,
    applyRemoteState,
    updateSerialRuntime,
    updateSerialSettings,
    markDisplayOpened,
  } = useBusStore();

  const kioskMode = isKioskMode();
  const busPcLaunch = isLaunchedByRunScript() || kioskMode;

  useRemoteStateSync(true);
  useAnnouncementPlayback();
  useDisplayBrowserFullscreen(true, exitToControl, kioskMode);

  useBusPcEspSerial({
    state,
    applyRemoteState,
    updateSerialRuntime,
    updateSerialSettings,
  });

  useEffect(() => {
    markDisplayOpened();
  }, [markDisplayOpened]);

  useEffect(() => {
    if (!busPcLaunch) return;
    const el = document.documentElement;
    el.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {
      el.requestFullscreen?.().catch(() => {});
    });
  }, [busPcLaunch]);

  useEffect(() => {
    if (!kioskMode) return undefined;
    document.documentElement.classList.add('kiosk-hide-cursor');
    return () => document.documentElement.classList.remove('kiosk-hide-cursor');
  }, [kioskMode]);

  return (
    <>
      <FleetSetupOverlay />
      {kioskMode && <UpdateOverlay />}
      <AppVersionBadge />
      <DisplayScreen passengerMode />
    </>
  );
}
