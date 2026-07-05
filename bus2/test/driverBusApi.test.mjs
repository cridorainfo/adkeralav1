import assert from 'node:assert/strict';
import { busApiUrl, isOnBusLanOrigin } from '../src/lib/driverBusApi.js';

assert.equal(isOnBusLanOrigin('http://192.168.1.8:5174'), true);
assert.equal(isOnBusLanOrigin('http://10.0.0.5:5174'), true);
assert.equal(isOnBusLanOrigin('http://172.16.0.1:5174'), true);
assert.equal(isOnBusLanOrigin('http://localhost:5174'), true);
assert.equal(isOnBusLanOrigin('https://adkeralav1-production.up.railway.app'), false);
assert.equal(isOnBusLanOrigin('https://localhost'), false);

assert.equal(busApiUrl('/api/drive'), '/api/drive');

console.log('driverBusApi.test.mjs: ok');
