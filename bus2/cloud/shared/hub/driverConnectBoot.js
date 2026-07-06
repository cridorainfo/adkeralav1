import { isOnBusLanOrigin } from './api.js';
import {
  hydrateHubStorage,
  loadHubControlUrl,
  readHubControlFromLocation,
  saveHubControlUrl,
} from './persist.js';
import { connectAfterBusUrlSaved, goToHubControl, shouldOpenHubControl } from './client.js';

/**
 * Shared /driver boot — QR saves bus URL only; stored session reconnects without re-entering code.
 * Returns { redirected: true } when navigation to /control already started.
 */
export async function bootDriverConnect({ locationSearch, navigate }) {
  await hydrateHubStorage();

  const fromQr = readHubControlFromLocation(locationSearch);
  if (fromQr) {
    saveHubControlUrl(fromQr);
    const auto = await connectAfterBusUrlSaved(fromQr);
    if (shouldOpenHubControl(auto)) {
      goToHubControl(auto.controlUrl);
      return { redirected: true, busUrl: fromQr, auto };
    }
    navigate('/driver', { replace: true });
    return { redirected: false, busUrl: fromQr, auto };
  }

  if (isOnBusLanOrigin()) {
    saveHubControlUrl(`${window.location.origin}/control`);
  }

  const saved = loadHubControlUrl();
  let auto = { ok: false, status: saved ? 'need-code' : 'no-url', controlUrl: saved };
  if (saved) {
    auto = await connectAfterBusUrlSaved(saved);
  }

  if (shouldOpenHubControl(auto)) {
    goToHubControl(auto.controlUrl);
    return { redirected: true, busUrl: saved, auto };
  }

  return { redirected: false, busUrl: saved, auto };
}
