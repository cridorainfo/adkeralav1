import assert from 'node:assert/strict';
import { hubApiUrl, isOnBusLanOrigin, isBusPcLocalOrigin } from '../cloud/shared/hub/api.js';
import { resolveHubControlDestination } from '../cloud/shared/hub/client.js';

assert.equal(isOnBusLanOrigin('http://192.168.1.10:5174'), true);
assert.equal(isBusPcLocalOrigin(), false);
assert.equal(isOnBusLanOrigin('http://127.0.0.1:5174'), true);
assert.equal(isOnBusLanOrigin('https://example.com'), false);
assert.equal(hubApiUrl('/api/state'), '/api/state');

// Node has no window — treated as cloud PWA, not bus LAN origin; prefer LAN control URL.
assert.equal(
  resolveHubControlDestination('http://192.168.1.10:5174/control'),
  'http://192.168.1.10:5174/control'
);

console.log('hubApi.test.mjs: ok');
