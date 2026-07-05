import assert from 'node:assert/strict';
import { hubApiUrl, isOnBusLanOrigin } from '../shared/hub/api.js';

assert.equal(isOnBusLanOrigin('http://192.168.1.10:5174'), true);
assert.equal(isOnBusLanOrigin('http://127.0.0.1:5174'), true);
assert.equal(isOnBusLanOrigin('https://example.com'), false);
assert.equal(hubApiUrl('/api/state'), '/api/state');

console.log('hubApi.test.mjs: ok');
