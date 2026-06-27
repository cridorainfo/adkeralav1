import { useCallback, useEffect, useRef } from 'react';
import { getStopInfo, sameStop, getUpcomingPassengerStop } from '../store/busStore';
import { canPlayAnnouncement } from '../lib/audioFragments';
import { createSerialActionGate } from '../lib/serialActionGate';

export function useEspSerialControl({
  state,
  startTrip,
  endTrip,
  moveForward,
  undoForward,
  requestAnnouncement,
  enterDisplayMode,
  exitToControl,
}) {
  const stateRef = useRef(state);
  stateRef.current = state;

  const actionsRef = useRef({
    startTrip,
    endTrip,
    moveForward,
    undoForward,
    requestAnnouncement,
    enterDisplayMode,
    exitToControl,
  });
  actionsRef.current = {
    startTrip,
    endTrip,
    moveForward,
    undoForward,
    requestAnnouncement,
    enterDisplayMode,
    exitToControl,
  };

  const gateRef = useRef(null);
  const debounceMs = state.serialSettings?.debounceMs ?? 500;

  if (!gateRef.current) {
    gateRef.current = createSerialActionGate({ debounceMs });
  }

  useEffect(() => {
    gateRef.current = createSerialActionGate({ debounceMs });
  }, [debounceMs]);

  const handleValueChange = useCallback((rawValue) => {
    const currentState = stateRef.current;
    const settings = currentState.serialSettings ?? {};
    const mappings = settings.buttonMappings ?? {};
    const normalized = String(rawValue)
      .trim()
      .toLowerCase()
      .replace(/[^\x20-\x7e]/g, '');

    const fullscreenCmd = (settings.fullscreenCommand ?? 'fullscreen').trim().toLowerCase();
    const exitCmd = (settings.exitCommand ?? 'exit').trim().toLowerCase();
    const forward = String(mappings.forward ?? '1').trim().toLowerCase();
    const backward = String(mappings.backward ?? '2').trim().toLowerCase();
    const speech = String(mappings.speech ?? '3').trim().toLowerCase();
    const idle = String(mappings.idle ?? '0').trim().toLowerCase();

    const isFullscreenCmd =
      normalized === fullscreenCmd || normalized === 'fullscreen' || normalized === 'full';
    const isExitCmd = normalized === exitCmd || normalized === 'exit';

    // Text commands bypass button debounce — always handled immediately
    if (isFullscreenCmd) {
      actionsRef.current.enterDisplayMode?.();
      return;
    }
    if (isExitCmd) {
      actionsRef.current.exitToControl?.();
      return;
    }

    const gate = gateRef.current;
    if (!gate) return;

    if (normalized === idle) {
      gate.markIdle();
      return;
    }

    if (!gate.tryAction()) return;

    if (normalized === forward) {
      const currentState = stateRef.current;
      if (!currentState.tripStarted && !currentState.tripEnded) {
        actionsRef.current.startTrip?.();
        return;
      }
      const stopInfo = getStopInfo(currentState);
      if (currentState.tripStarted && stopInfo.atTripEnd && !currentState.tripEnded) {
        actionsRef.current.endTrip?.();
        return;
      }
      actionsRef.current.moveForward();
      return;
    }
    if (normalized === backward) {
      actionsRef.current.undoForward();
      return;
    }
    if (normalized === speech) {
      const stopInfo = getStopInfo(currentState);
      const announceTarget = getUpcomingPassengerStop(currentState);
      if (!announceTarget) return;
      if (!(currentState.announcementSettings?.enabled ?? true)) return;
      if (!canPlayAnnouncement(currentState, announceTarget)) return;

      const isTerminus = stopInfo.final && sameStop(announceTarget, stopInfo.final);
      actionsRef.current.requestAnnouncement(announceTarget, { isTerminus });
    }
  }, []);

  return { handleValueChange };
}
