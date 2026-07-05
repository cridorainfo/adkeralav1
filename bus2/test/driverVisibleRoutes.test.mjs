import test from 'node:test';
import assert from 'node:assert/strict';
import { getDriverVisibleRoutes } from '../src/store/busStore.js';

test('getDriverVisibleRoutes falls back to routes on bus PC when no assigned filter matches', () => {
  const routes = getDriverVisibleRoutes({
    routes: [{ id: 'r1', name: 'Route 1', startStop: { en: 'A' }, endStop: { en: 'B' }, stops: [] }],
    activeRouteId: 'r1',
    busProfile: { assignedRouteIds: [] },
  });
  assert.equal(routes.length, 1);
  assert.equal(routes[0].id, 'r1');
});

test('getDriverVisibleRoutes prefers assignedRouteIds when set', () => {
  const routes = getDriverVisibleRoutes({
    routes: [
      { id: 'r1', name: 'One', startStop: { en: 'A' }, endStop: { en: 'B' }, stops: [] },
      { id: 'r2', name: 'Two', startStop: { en: 'C' }, endStop: { en: 'D' }, stops: [] },
    ],
    busProfile: { assignedRouteIds: ['r2'] },
  });
  assert.equal(routes.length, 1);
  assert.equal(routes[0].id, 'r2');
});
