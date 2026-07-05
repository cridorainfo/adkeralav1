import {
  createId,
  getActiveRoute,
  getAllStops,
  getStopInfo,
  getTripStartIndex,
  getUpcomingPassengerStop,
  getDriverVisibleRoutes,
  normalizeStop,
  sameStop,
  findStopByEn,
} from './busStore.js';
import { nextDriveRevision } from './tripMerge.js';

function stopActiveAdPatch(state) {
  if (state?.displayView !== 'ad') return {};
  return { displayView: 'route', lastAdEndedAt: Date.now(), adStartedAt: null };
}

/** Server state may lack activeRouteId while UI shows first assigned route — align before drive ops. */
function ensureActiveDriverRoute(state) {
  const visible = getDriverVisibleRoutes(state);
  if (!visible.length) return state;
  if (state.activeRouteId && visible.some((r) => r.id === state.activeRouteId)) {
    return state;
  }
  return { ...state, activeRouteId: visible[0].id };
}

export function applyStartTrip(state) {
  state = ensureActiveDriverRoute(state);
  const route = getActiveRoute(state);
  if (!route) return state;
  if (state.tripStarted && !state.tripEnded) return state;
  const stops = getAllStops(route);
  const dir = state.routeDirection ?? 'forward';
  return {
    ...state,
    tripStarted: true,
    tripEnded: false,
    tripDeparted: false,
    currentStopIndex: getTripStartIndex(stops, dir),
    displayView: 'route',
    announcementRequest: null,
    driveRevision: nextDriveRevision(state),
    savedAt: Date.now(),
  };
}

export function applyEndTrip(state) {
  state = ensureActiveDriverRoute(state);
  const route = getActiveRoute(state);
  if (!route || !state.tripStarted) return state;
  const stops = getAllStops(route);
  const dir = state.routeDirection ?? 'forward';
  return {
    ...state,
    tripStarted: false,
    tripEnded: true,
    tripDeparted: false,
    currentStopIndex: getTripStartIndex(stops, dir),
    displayView: 'route',
    announcementRequest: null,
    driveRevision: nextDriveRevision(state),
    savedAt: Date.now(),
  };
}

export function applyMoveForward(state) {
  state = ensureActiveDriverRoute(state);
  const route = getActiveRoute(state);
  if (!route || !state.tripStarted || state.tripEnded) return state;
  const stops = getAllStops(route);
  const dir = state.routeDirection ?? 'forward';
  const tripStart = getTripStartIndex(stops, dir);

  if (dir === 'forward') {
    if (state.tripDeparted && state.currentStopIndex >= stops.length - 1) return state;

    const nextDepartedIdx = state.tripDeparted
      ? Math.min(state.currentStopIndex + 1, stops.length - 1)
      : tripStart;

    if (state.tripDeparted && nextDepartedIdx === state.currentStopIndex) return state;

    const afterState = {
      ...state,
      tripDeparted: true,
      currentStopIndex: nextDepartedIdx,
      driveRevision: nextDriveRevision(state),
    };
    const announceStop = getUpcomingPassengerStop(afterState);
    if (!announceStop) return { ...afterState, savedAt: Date.now() };

    const isTerminus = sameStop(announceStop, stops[stops.length - 1]);
    const shouldAnnounce =
      (state.announcementSettings?.enabled ?? true) &&
      (state.announcementSettings?.autoAnnounceOnForward ?? true);

    return {
      ...afterState,
      announcementRequest: shouldAnnounce
        ? {
            id: createId(),
            stopEn: normalizeStop(announceStop).en,
            isTerminus: Boolean(isTerminus),
            at: Date.now(),
          }
        : null,
      savedAt: Date.now(),
    };
  }

  if (state.tripDeparted && state.currentStopIndex <= 0) return state;

  const nextDepartedIdx = state.tripDeparted
    ? Math.max(state.currentStopIndex - 1, 0)
    : tripStart;

  if (state.tripDeparted && nextDepartedIdx === state.currentStopIndex) return state;

  const afterState = {
    ...state,
    tripDeparted: true,
    currentStopIndex: nextDepartedIdx,
    driveRevision: nextDriveRevision(state),
  };
  const announceStop = getUpcomingPassengerStop(afterState);
  if (!announceStop) return { ...afterState, savedAt: Date.now() };

  const isTerminus = sameStop(announceStop, stops[0]);
  const shouldAnnounce =
    (state.announcementSettings?.enabled ?? true) &&
    (state.announcementSettings?.autoAnnounceOnForward ?? true);

  return {
    ...afterState,
    announcementRequest: shouldAnnounce
      ? {
          id: createId(),
          stopEn: normalizeStop(announceStop).en,
          isTerminus: Boolean(isTerminus),
          at: Date.now(),
        }
      : null,
    savedAt: Date.now(),
  };
}

export function applyUndoForward(state) {
  state = ensureActiveDriverRoute(state);
  const route = getActiveRoute(state);
  if (!route || !state.tripStarted || state.tripEnded) return state;
  const stops = getAllStops(route);
  const dir = state.routeDirection ?? 'forward';
  const tripStart = getTripStartIndex(stops, dir);

  if (!state.tripDeparted) return state;

  const driveRevision = nextDriveRevision(state);

  if (dir === 'forward') {
    if (state.currentStopIndex <= tripStart) {
      return {
        ...state,
        tripDeparted: false,
        currentStopIndex: tripStart,
        displayView: 'route',
        announcementRequest: null,
        driveRevision,
        savedAt: Date.now(),
      };
    }
    return {
      ...state,
      currentStopIndex: state.currentStopIndex - 1,
      displayView: 'route',
      announcementRequest: null,
      driveRevision,
      savedAt: Date.now(),
    };
  }

  if (state.currentStopIndex >= tripStart) {
    return {
      ...state,
      tripDeparted: false,
      currentStopIndex: tripStart,
      displayView: 'route',
      announcementRequest: null,
      driveRevision,
      savedAt: Date.now(),
    };
  }
  return {
    ...state,
    currentStopIndex: state.currentStopIndex + 1,
    displayView: 'route',
    announcementRequest: null,
    driveRevision,
    savedAt: Date.now(),
  };
}

export function applySelectRoute(state, routeId) {
  const id = String(routeId ?? '').trim();
  if (!id) return state;

  const visible = getDriverVisibleRoutes(state);
  const allowed = visible.length ? visible : (state.routes ?? []);
  const route = allowed.find((r) => r.id === id) ?? (state.routes ?? []).find((r) => r.id === id);
  if (!route) return state;

  const stops = getAllStops(route);
  const dir = state.routeDirection ?? 'forward';
  if (
    id === state.activeRouteId &&
    !state.tripStarted &&
    !state.tripEnded &&
    !state.tripDeparted
  ) {
    return state;
  }

  return {
    ...state,
    ...stopActiveAdPatch(state),
    activeRouteId: id,
    currentStopIndex: getTripStartIndex(stops, dir),
    tripStarted: false,
    tripEnded: false,
    tripDeparted: false,
    displayView: 'route',
    announcementRequest: null,
    driveRevision: nextDriveRevision(state),
    savedAt: Date.now(),
  };
}

export function applySetRouteDirection(state, routeDirection) {
  const direction = routeDirection === 'reverse' ? 'reverse' : 'forward';
  state = ensureActiveDriverRoute(state);
  const route = getActiveRoute(state);
  if (!route) return state;
  const stops = getAllStops(route);
  if ((state.routeDirection ?? 'forward') === direction && !state.tripStarted && !state.tripEnded) {
    return state;
  }

  return {
    ...state,
    ...stopActiveAdPatch(state),
    routeDirection: direction,
    currentStopIndex: getTripStartIndex(stops, direction),
    tripStarted: false,
    tripEnded: false,
    tripDeparted: false,
    displayView: 'route',
    announcementRequest: null,
    driveRevision: nextDriveRevision(state),
    savedAt: Date.now(),
  };
}

export function applyRequestAnnouncement(state, { stopEn, isTerminus = false } = {}) {
  const stopInfo = getStopInfo(state);
  let stop = null;
  if (stopEn) {
    stop = findStopByEn(stopInfo.allStops, stopEn);
  } else {
    stop = getUpcomingPassengerStop(state) ?? stopInfo.next ?? stopInfo.current;
  }
  if (!stop) return state;
  return {
    ...state,
    announcementRequest: {
      id: createId(),
      stopEn: normalizeStop(stop).en,
      isTerminus: Boolean(isTerminus),
      at: Date.now(),
    },
    savedAt: Date.now(),
  };
}

export function applySetDisplayView(state, view) {
  const nextView = view === 'ad' ? 'ad' : 'route';
  return { ...state, displayView: nextView, savedAt: Date.now() };
}

const DRIVE_ACTIONS = new Set([
  'startTrip',
  'endTrip',
  'forward',
  'undo',
  'announce',
  'selectRoute',
  'setDirection',
  'setDisplayView',
]);

export function isDriveAction(action) {
  return DRIVE_ACTIONS.has(action);
}

export function applyDriveAction(state, action, payload = {}) {
  switch (action) {
    case 'startTrip':
      return applyStartTrip(state);
    case 'endTrip':
      return applyEndTrip(state);
    case 'forward':
      return applyMoveForward(state);
    case 'undo':
      return applyUndoForward(state);
    case 'announce':
      return applyRequestAnnouncement(state, payload);
    case 'selectRoute':
      return applySelectRoute(state, payload.routeId);
    case 'setDirection':
      return applySetRouteDirection(state, payload.direction);
    case 'setDisplayView':
      return applySetDisplayView(state, payload.view);
    default:
      return state;
  }
}

