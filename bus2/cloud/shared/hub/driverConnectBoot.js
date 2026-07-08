import { isOnBusLanOrigin } from './api.js';
import { parsePairCodeFromSearch } from './lan.js';
import {
  hydrateHubStorage,
  loadHubControlUrl,
  readHubControlFromLocation,
  saveHubControlUrl,
  saveHubPairCode,
} from './persist.js';
import { connectAfterBusUrlSaved, goToHubControl, pairToHub, shouldOpenHubControl } from './client.js';

/**
 * Shared /driver boot — QR saves bus URL only; stored session reconnects without re-entering code.
 * Returns { redirected: true } when navigation to /control already started.
 */
export async function bootDriverConnect({ locationSearch, navigate }) {
  await hydrateHubStorage();

  const codeFromQr = parsePairCodeFromSearch(locationSearch);
  if (codeFromQr) saveHubPairCode(codeFromQr);

  const fromQr = readHubControlFromLocation(locationSearch);
  if (fromQr) {
    saveHubControlUrl(fromQr);
    if (codeFromQr) {
      const paired = await pairToHub(fromQr, codeFromQr);
      if (paired.ok) {
        goToHubControl(fromQr);
        return { redirected: true, busUrl: fromQr, auto: { ok: true, status: 'connected' }, pairCode: codeFromQr };
      }
    }
    const auto = await connectAfterBusUrlSaved(fromQr);
    if (shouldOpenHubControl(auto)) {
      goToHubControl(auto.controlUrl);
      return { redirected: true, busUrl: fromQr, auto, pairCode: codeFromQr };
    }
    navigate('/driver', { replace: true });
    return { redirected: false, busUrl: fromQr, auto, pairCode: codeFromQr };
  }

  if (codeFromQr) {
    navigate('/driver', { replace: true });
    return { redirected: false, busUrl: loadHubControlUrl(), auto: { ok: false, status: 'need-code' }, pairCode: codeFromQr };
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

  return { redirected: false, busUrl: saved, auto, pairCode: codeFromQr || null };
}
