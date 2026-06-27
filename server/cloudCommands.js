import { dedupeRoutes } from '../src/store/busStore.js';

/** Apply a cloud command payload onto bus state read from info.txt. */
export function applyCloudCommands(current, commands) {
  let next = { ...(current ?? {}) };

  for (const cmd of commands) {
    const { type, payload } = cmd;
    if (!payload) continue;

    switch (type) {
      case 'UPDATE_ADS':
      case 'MERGE_STATE':
        next = { ...next, ...payload };
        break;

      case 'ASSIGN_ROUTE': {
        const route = payload.route;
        if (!route?.id) break;
        const routes = dedupeRoutes([...(next.routes ?? []).filter((r) => r.id !== route.id), route]);
        next = {
          ...next,
          routes,
          activeRouteId: payload.activeRouteId ?? route.id,
          currentStopIndex: 0,
          tripDeparted: false,
          savedAt: payload.savedAt ?? Date.now(),
        };
        break;
      }

      case 'PATCH_STOP': {
        const { routeId, stopEn, patch } = payload;
        if (!routeId || !stopEn) break;
        const routes = (next.routes ?? []).map((route) => {
          if (route.id !== routeId) return route;
          const applyStop = (stop) => {
            if (stop?.en?.toLowerCase() !== stopEn.toLowerCase()) return stop;
            return { ...stop, ...patch };
          };
          return {
            ...route,
            startStop: applyStop(route.startStop),
            endStop: applyStop(route.endStop),
            stops: (route.stops ?? []).map(applyStop),
          };
        });
        next = { ...next, routes, savedAt: payload.savedAt ?? Date.now() };
        break;
      }

      default:
        break;
    }
  }

  return next;
}

export function buildDisplaySnapshot(state) {
  if (!state) return null;
  const route = (state.routes ?? []).find((r) => r.id === state.activeRouteId);
  return {
    displayView: state.displayView ?? 'route',
    activeRouteId: state.activeRouteId,
    routeName: route?.name ?? null,
    currentStopIndex: state.currentStopIndex ?? 0,
    tripDeparted: Boolean(state.tripDeparted),
    routeDirection: state.routeDirection ?? 'forward',
    driverLocation: state.driverLocation ?? null,
    savedAt: state.savedAt ?? Date.now(),
  };
}
