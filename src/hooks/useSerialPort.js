import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createSerialValueParser } from '../lib/serialValueParser';

export function isWebSerialSupported() {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

function portMatchesInfo(port, savedInfo) {
  if (!savedInfo) return false;
  const info = port.getInfo?.() ?? {};
  if (savedInfo.usbVendorId != null && info.usbVendorId !== savedInfo.usbVendorId) {
    return false;
  }
  if (savedInfo.usbProductId != null && info.usbProductId !== savedInfo.usbProductId) {
    return false;
  }
  return true;
}

function formatPortLabel(port) {
  const info = port.getInfo?.() ?? {};
  if (info.usbVendorId != null) {
    const vid = info.usbVendorId.toString(16).padStart(4, '0');
    const pid = info.usbProductId?.toString(16).padStart(4, '0') ?? '????';
    return `USB ${vid}:${pid}`;
  }
  return 'Serial port';
}

function isPortOpen(port) {
  return port?.readable != null || port?.writable != null;
}

function describeSerialError(err) {
  const msg = String(err?.message ?? err ?? '');
  if (/timed out/i.test(msg)) {
    return 'Serial port open timed out. Unplug the ESP32, close other serial apps, plug back in, and retry.';
  }
  if (/failed to open/i.test(msg)) {
    return (
      'Could not open COM port. Close Arduino Serial Monitor, PuTTY, or any other app using this port, ' +
      'then unplug/replug the ESP32 and click Select COM Port again.'
    );
  }
  if (err?.name === 'InvalidStateError') {
    return 'Port is already in use. Click Disconnect, wait a second, then try again.';
  }
  return msg || 'Could not open serial port';
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    delay(ms).then(() => {
      throw new Error(message);
    }),
  ]);
}

export function useSerialPort({
  enabled,
  locked,
  baudRate,
  savedPortInfo,
  onValueChange,
  textCommands = ['fullscreen', 'exit'],
}) {
  const [status, setStatus] = useState('idle');
  const [portLabel, setPortLabel] = useState('');
  const [lastLine, setLastLine] = useState('');
  const [error, setError] = useState('');

  const portRef = useRef(null);
  const readerRef = useRef(null);
  const readLoopActiveRef = useRef(false);
  const abortRef = useRef(false);
  const manualDisconnectRef = useRef(false);
  const intentionalCloseRef = useRef(false);
  const connectingRef = useRef(false);
  const handlingLossRef = useRef(false);
  const reconnectTimerRef = useRef(null);
  const reconnectAttemptRef = useRef(0);
  const handlePortLostRef = useRef(() => {});
  const queueRef = useRef(Promise.resolve());
  const parserRef = useRef(null);
  const onValueChangeRef = useRef(onValueChange);
  const baudRateRef = useRef(baudRate);
  const lastLineRef = useRef('');
  const lastLineFrameRef = useRef(null);
  const textCommandsKey = textCommands.map((c) => String(c).trim().toLowerCase()).join('|');
  baudRateRef.current = baudRate;
  onValueChangeRef.current = onValueChange;

  const scheduleLastLineUpdate = useCallback((value) => {
    lastLineRef.current = value;
    if (lastLineFrameRef.current != null) return;
    lastLineFrameRef.current = window.requestAnimationFrame(() => {
      lastLineFrameRef.current = null;
      setLastLine(lastLineRef.current);
    });
  }, []);

  const createParser = useCallback(
    () =>
      createSerialValueParser(
        (value) => {
          onValueChangeRef.current?.(value);
          scheduleLastLineUpdate(value);
        },
        { textCommands }
      ),
    [scheduleLastLineUpdate, textCommandsKey]
  );

  if (!parserRef.current) {
    parserRef.current = createParser();
  }

  useEffect(() => {
    parserRef.current = createParser();
  }, [createParser]);

  const enqueue = useCallback((task) => {
    const run = queueRef.current.then(task, task);
    queueRef.current = run.catch(() => {});
    return run;
  }, []);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current != null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const isConnectedNow = useCallback(() => {
    const port = portRef.current;
    return Boolean(port && isPortOpen(port));
  }, []);

  const stopReading = useCallback(async () => {
    readLoopActiveRef.current = false;
    const reader = readerRef.current;
    readerRef.current = null;
    if (!reader) return;
    try {
      await withTimeout(reader.cancel(), 2000, 'Reader cancel timed out');
    } catch {
      /* ignore */
    }
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }, []);

  const closePortInstance = useCallback(
    async (port) => {
      if (!port) return;
      await stopReading();
      if (isPortOpen(port)) {
        try {
          await withTimeout(port.close(), 3000, 'Port close timed out');
        } catch {
          /* ignore */
        }
        await delay(100);
      }
    },
    [stopReading]
  );

  const readLoop = useCallback(async (port) => {
    readLoopActiveRef.current = true;

    while (readLoopActiveRef.current && portRef.current === port && port.readable) {
      let reader;
      try {
        reader = port.readable.getReader();
        readerRef.current = reader;
      } catch {
        break;
      }

      try {
        while (readLoopActiveRef.current && portRef.current === port) {
          const { value, done } = await reader.read();
          if (done) break;
          if (!value) continue;
          parserRef.current?.feed(new TextDecoder().decode(value, { stream: true }));
        }
      } catch (err) {
        if (readLoopActiveRef.current && err?.name !== 'NetworkError') {
          console.warn('Serial read error:', err);
        }
      } finally {
        if (readerRef.current === reader) readerRef.current = null;
        try {
          reader.releaseLock();
        } catch {
          /* ignore */
        }
      }
    }

    if (
      portRef.current === port &&
      !intentionalCloseRef.current &&
      !manualDisconnectRef.current
    ) {
      handlePortLostRef.current?.('read-ended');
    }
  }, []);

  const openPortInstance = useCallback(
    async (port) => {
      if (abortRef.current) return;

      const rate = baudRateRef.current || 115200;
      if (isPortOpen(port)) {
        intentionalCloseRef.current = true;
        readLoopActiveRef.current = false;
        if (portRef.current === port) {
          portRef.current = null;
        }
        await closePortInstance(port);
        intentionalCloseRef.current = false;
      }
      if (abortRef.current) return;

      const tryOpen = () =>
        withTimeout(port.open({ baudRate: rate }), 8000, 'Serial port open timed out');

      try {
        await tryOpen();
      } catch (firstErr) {
        if (abortRef.current) throw firstErr;
        await closePortInstance(port);
        await delay(300);
        if (abortRef.current) throw firstErr;
        try {
          await tryOpen();
        } catch {
          throw firstErr;
        }
      }
    },
    [closePortInstance]
  );

  const connectPortCore = useCallback(
    async (port) => {
      if (abortRef.current || connectingRef.current) return;

      connectingRef.current = true;
      setStatus('connecting');

      try {
        setError('');
        parserRef.current?.reset();

        const previous = portRef.current;
        if (previous && previous !== port) {
          intentionalCloseRef.current = true;
          portRef.current = null;
          readLoopActiveRef.current = false;
          await closePortInstance(previous);
          intentionalCloseRef.current = false;
        }
        if (abortRef.current) return;

        await openPortInstance(port);
        if (abortRef.current) {
          intentionalCloseRef.current = true;
          await closePortInstance(port);
          intentionalCloseRef.current = false;
          return;
        }

        portRef.current = port;
        setPortLabel(formatPortLabel(port));
        setStatus('connected');
        readLoop(port);
      } finally {
        connectingRef.current = false;
      }
    },
    [closePortInstance, openPortInstance, readLoop]
  );

  const disconnect = useCallback(async () => {
    manualDisconnectRef.current = true;
    clearReconnectTimer();
    reconnectAttemptRef.current = 0;
    abortRef.current = true;
    queueRef.current = Promise.resolve();

    const port = portRef.current;
    portRef.current = null;
    readLoopActiveRef.current = false;

    await stopReading();
    await closePortInstance(port);

    setPortLabel('');
    setStatus('idle');
    setError('');
    abortRef.current = false;
    manualDisconnectRef.current = false;
  }, [clearReconnectTimer, closePortInstance, stopReading]);

  const connectPort = useCallback(
    (port) => enqueue(() => connectPortCore(port)),
    [connectPortCore, enqueue]
  );

  const selectPort = useCallback(async () => {
    if (!isWebSerialSupported()) return null;

    abortRef.current = false;
    setStatus('connecting');
    setError('');
    try {
      const port = await navigator.serial.requestPort();
      if (abortRef.current) return null;
      await connectPort(port);
      return port;
    } catch (err) {
      if (!abortRef.current) {
        setStatus(portRef.current ? 'connected' : 'error');
        setError(describeSerialError(err));
      }
      throw err;
    }
  }, [connectPort]);

  const findSavedPort = useCallback(async () => {
    const ports = await navigator.serial.getPorts();
    if (savedPortInfo) {
      const match = ports.find((p) => portMatchesInfo(p, savedPortInfo));
      if (match) return match;
    }
    if (ports.length === 1) return ports[0];
    return null;
  }, [savedPortInfo]);

  const shouldStayConnected = enabled || locked || Boolean(savedPortInfo);
  const shouldStayConnectedRef = useRef(shouldStayConnected);
  shouldStayConnectedRef.current = shouldStayConnected;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const savedPortInfoRef = useRef(savedPortInfo);
  savedPortInfoRef.current = savedPortInfo;

  const reconnectSavedPort = useCallback(async () => {
    if (!isWebSerialSupported()) return false;
    if (manualDisconnectRef.current) return false;

    return enqueue(async () => {
      if (abortRef.current || isConnectedNow()) return isConnectedNow();

      const match = await findSavedPort();
      if (!match) {
        if (lockedRef.current || savedPortInfoRef.current) {
          setStatus('waiting');
        } else {
          setStatus('idle');
        }
        return false;
      }

      abortRef.current = false;
      setError('');
      await connectPortCore(match);
      if (portRef.current) {
        reconnectAttemptRef.current = 0;
        return true;
      }
      return false;
    });
  }, [connectPortCore, enqueue, findSavedPort, isConnectedNow]);

  const scheduleReconnect = useCallback(
    (immediate = false) => {
      if (!shouldStayConnectedRef.current || manualDisconnectRef.current) return;
      if (isConnectedNow() || connectingRef.current) return;

      clearReconnectTimer();
      const attempt = reconnectAttemptRef.current;
      const delays = [150, 350, 700, 1200, 2000, 3000];
      const delayMs = immediate ? 0 : delays[Math.min(attempt, delays.length - 1)];

      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        if (manualDisconnectRef.current || isConnectedNow() || connectingRef.current) return;

        reconnectAttemptRef.current += 1;
        setStatus('reconnecting');
        setError('');

        reconnectSavedPort()
          .then((ok) => {
            if (ok) {
              reconnectAttemptRef.current = 0;
              return;
            }
            if (reconnectAttemptRef.current < 24 && shouldStayConnectedRef.current) {
              scheduleReconnect();
            } else if (lockedRef.current || savedPortInfoRef.current) {
              setStatus('waiting');
            }
          })
          .catch(() => {
            if (reconnectAttemptRef.current < 24 && shouldStayConnectedRef.current) {
              scheduleReconnect();
            }
          });
      }, delayMs);
    },
    [clearReconnectTimer, isConnectedNow, reconnectSavedPort]
  );

  const handlePortLost = useCallback(
    async (_reason) => {
      if (manualDisconnectRef.current || handlingLossRef.current || connectingRef.current) {
        return;
      }
      handlingLossRef.current = true;

      const port = portRef.current;
      portRef.current = null;
      readLoopActiveRef.current = false;
      parserRef.current?.reset();
      setStatus('reconnecting');
      setError('');

      try {
        await stopReading();
        if (port) {
          try {
            await closePortInstance(port);
          } catch {
            /* port may already be gone after unplug */
          }
        }
      } finally {
        handlingLossRef.current = false;
      }

      if (shouldStayConnectedRef.current && !manualDisconnectRef.current) {
        scheduleReconnect(true);
      } else {
        setStatus('disconnected');
      }
    },
    [closePortInstance, scheduleReconnect, stopReading]
  );

  handlePortLostRef.current = handlePortLost;

  useEffect(() => {
    if (!shouldStayConnected) {
      clearReconnectTimer();
      if (!lockedRef.current) disconnect();
      return undefined;
    }

    if (isConnectedNow() || connectingRef.current) return undefined;

    reconnectAttemptRef.current = 0;
    scheduleReconnect(true);

    return () => {
      clearReconnectTimer();
    };
  }, [shouldStayConnected, clearReconnectTimer, disconnect, isConnectedNow, scheduleReconnect]);

  useEffect(() => {
    if (!shouldStayConnected || !isWebSerialSupported()) return undefined;

    const onConnect = () => {
      reconnectAttemptRef.current = 0;
      if (!isConnectedNow() && !connectingRef.current) scheduleReconnect(true);
    };

    const onDisconnect = (event) => {
      const lostPort = event?.target ?? portRef.current;
      if (lostPort && portRef.current && portRef.current !== lostPort) return;
      handlePortLost('usb-disconnect');
    };

    navigator.serial.addEventListener('connect', onConnect);
    navigator.serial.addEventListener('disconnect', onDisconnect);

    return () => {
      navigator.serial.removeEventListener('connect', onConnect);
      navigator.serial.removeEventListener('disconnect', onDisconnect);
    };
  }, [shouldStayConnected, handlePortLost, isConnectedNow, scheduleReconnect]);

  useEffect(
    () => () => {
      if (lastLineFrameRef.current != null) {
        window.cancelAnimationFrame(lastLineFrameRef.current);
        lastLineFrameRef.current = null;
      }
      clearReconnectTimer();
      if (!lockedRef.current) disconnect();
    },
    [clearReconnectTimer, disconnect]
  );

  const isActive = status !== 'idle';

  return useMemo(
    () => ({
      status,
      portLabel,
      lastLine,
      error,
      setError,
      clearError: () => setError(''),
      describeError: describeSerialError,
      isSupported: isWebSerialSupported(),
      selectPort,
      disconnect,
      reconnect: reconnectSavedPort,
      getPortInfo: () => portRef.current?.getInfo?.() ?? null,
      isConnected: status === 'connected',
      isActive,
    }),
    [
      status,
      portLabel,
      lastLine,
      error,
      selectPort,
      disconnect,
      reconnectSavedPort,
      isActive,
    ]
  );
}
