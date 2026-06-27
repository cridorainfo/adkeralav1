const STATUS_LABELS = {
  idle: 'Not connected',
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  connected: 'Connected',
  disconnected: 'Disconnected',
  waiting: 'Waiting for ESP32…',
  error: 'Connection error',
};

export default function SerialSettings({
  serialSettings,
  onUpdateSettings,
  serial,
  isSupported,
  compact = false,
  remoteConfig = false,
  serialRuntime = null,
}) {
  const locked = serialSettings?.portLocked ?? false;
  const mappings = serialSettings?.buttonMappings ?? {};

  const runtimeStatus = serialRuntime?.status ?? 'unknown';
  const runtimeLabel = STATUS_LABELS[runtimeStatus] ?? runtimeStatus;
  const runtimeConnected = Boolean(serialRuntime?.isConnected);

  const handleSelectPort = async () => {
    serial.clearError?.();
    try {
      await serial.selectPort();
      const info = serial.getPortInfo();
      if (info) {
        onUpdateSettings({
          enabled: true,
          portLocked: true,
          savedPortInfo: info,
        });
      }
    } catch (err) {
      if (err?.name !== 'NotFoundError') {
        const msg = serial.describeError?.(err) ?? err?.message ?? 'Could not open serial port';
        serial.setError?.(msg);
      }
    }
  };

  const handleReconnect = async () => {
    serial.clearError?.();
    try {
      const ok = await serial.reconnect?.();
      if (!ok) {
        serial.setError?.('Saved port not found. Click Select COM Port and choose the ESP32 again.');
      }
    } catch (err) {
      const msg = serial.describeError?.(err) ?? err?.message ?? 'Could not reconnect';
      serial.setError?.(msg);
    }
  };

  const handleDisconnect = async () => {
    serial.clearError?.();
    await serial.disconnect();
    if (!locked) {
      onUpdateSettings({ enabled: false, savedPortInfo: null });
    }
  };

  if (remoteConfig) {
    return (
      <div className="serial-panel serial-panel--remote">
        <h4 className="settings-section-title">ESP32 serial control</h4>
        <p className="serial-panel-desc">
          The ESP32 USB cable connects to the <strong>bus display PC</strong> (/display). Settings
          you change here sync to that screen. Use this if buttons stop working or values need
          correcting on the road.
        </p>

        <div className="serial-status-row">
          <span className={`serial-status-dot ${runtimeConnected ? 'on' : ''}`} aria-hidden />
          <strong>Bus PC: {runtimeLabel}</strong>
          {serialRuntime?.portLabel && (
            <span className="serial-port-label">{serialRuntime.portLabel}</span>
          )}
        </div>

        {serialRuntime?.error && (
          <p className="serial-error" role="alert">
            {serialRuntime.error}
          </p>
        )}

        {!serialRuntime?.at && (
          <p className="serial-hint">
            Waiting for status from the bus display. Open <code>/display</code> on the bus PC if this
            stays blank.
          </p>
        )}

        <div className="form-row">
          <div className="form-group">
            <label>
              <input
                type="checkbox"
                checked={serialSettings?.enabled ?? false}
                onChange={(e) => onUpdateSettings({ enabled: e.target.checked })}
                style={{ marginRight: '0.5rem' }}
              />
              Enable serial input on bus PC
            </label>
          </div>
          <div className="form-group">
            <label>
              <input
                type="checkbox"
                checked={locked}
                onChange={(e) => onUpdateSettings({ portLocked: e.target.checked })}
                style={{ marginRight: '0.5rem' }}
              />
              Remember COM port (auto-connect on bus PC startup)
            </label>
          </div>
        </div>

        <p className="serial-hint serial-hint--warning">
          On the bus PC: close other serial apps, unplug/replug the ESP32, then use the ⚙️ button on
          the passenger screen to select the COM port again if needed.
        </p>

        <div className="form-row">
          <div className="form-group">
            <label>Baud rate</label>
            <input
              type="number"
              min={9600}
              max={921600}
              step={9600}
              value={serialSettings?.baudRate ?? 115200}
              onChange={(e) => onUpdateSettings({ baudRate: Number(e.target.value) })}
            />
          </div>
          <div className="form-group">
            <label>Button debounce (ms)</label>
            <input
              type="number"
              min={100}
              max={2000}
              step={50}
              value={serialSettings?.debounceMs ?? 500}
              onChange={(e) => onUpdateSettings({ debounceMs: Number(e.target.value) })}
            />
          </div>
        </div>
        <p className="serial-hint" style={{ marginTop: '-0.5rem' }}>
          Ignores repeat triggers until idle ({mappings.idle ?? '0'}) is received again. Increase if
          you get false double-stops.
        </p>

        <h5 className="serial-mapping-title">Button value mappings</h5>
        <div className="serial-mapping-grid">
          <div className="form-group">
            <label>Forward</label>
            <input
              type="text"
              maxLength={16}
              value={mappings.forward ?? '1'}
              onChange={(e) =>
                onUpdateSettings({ buttonMappings: { ...mappings, forward: e.target.value } })
              }
            />
          </div>
          <div className="form-group">
            <label>Backward (undo)</label>
            <input
              type="text"
              maxLength={16}
              value={mappings.backward ?? '2'}
              onChange={(e) =>
                onUpdateSettings({ buttonMappings: { ...mappings, backward: e.target.value } })
              }
            />
          </div>
          <div className="form-group">
            <label>Speech (announce)</label>
            <input
              type="text"
              maxLength={16}
              value={mappings.speech ?? '3'}
              onChange={(e) =>
                onUpdateSettings({ buttonMappings: { ...mappings, speech: e.target.value } })
              }
            />
          </div>
          <div className="form-group">
            <label>Idle (no button)</label>
            <input
              type="text"
              maxLength={16}
              value={mappings.idle ?? '0'}
              onChange={(e) =>
                onUpdateSettings({ buttonMappings: { ...mappings, idle: e.target.value } })
              }
            />
          </div>
        </div>

        <h5 className="serial-mapping-title">Text commands</h5>
        <div className="form-row">
          <div className="form-group">
            <label>Enter fullscreen</label>
            <input
              type="text"
              maxLength={32}
              value={serialSettings?.fullscreenCommand ?? 'fullscreen'}
              onChange={(e) => onUpdateSettings({ fullscreenCommand: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label>Exit to control screen</label>
            <input
              type="text"
              maxLength={32}
              value={serialSettings?.exitCommand ?? 'exit'}
              onChange={(e) => onUpdateSettings({ exitCommand: e.target.value })}
            />
          </div>
        </div>
      </div>
    );
  }

  if (!isSupported) {
    return (
      <div className="serial-panel serial-panel--unsupported">
        <p>
          Web Serial is not available in this browser. Use Chrome or Edge on desktop to connect an
          ESP32.
        </p>
      </div>
    );
  }

  if (compact && !remoteConfig) {
    return (
      <div className={`serial-status-bar ${serial.isConnected ? 'connected' : ''}`}>
        <span className="serial-status-dot" aria-hidden />
        <span className="serial-status-text">
          ESP32: {STATUS_LABELS[serial.status] ?? serial.status}
          {serial.portLabel ? ` · ${serial.portLabel}` : ''}
        </span>
        {serial.lastLine && (
          <span className="serial-last-value">Last: {serial.lastLine}</span>
        )}
        <button
          type="button"
          className="btn btn-outline serial-disconnect-btn"
          onClick={handleDisconnect}
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="serial-panel">
      <h4 className="settings-section-title">ESP32 serial control</h4>
      <p className="serial-panel-desc">
        Connect an ESP32 over USB. Actions fire once per button press: the value must return to
        idle ({mappings.idle ?? '0'}) before the next press counts. Text commands{' '}
        <code>fullscreen</code> / <code>exit</code> (any case) work anytime — use{' '}
        <code>Serial.println()</code>.
      </p>

      <div className="serial-status-row">
        <span className={`serial-status-dot ${serial.isConnected ? 'on' : ''}`} aria-hidden />
        <strong>{STATUS_LABELS[serial.status] ?? serial.status}</strong>
        {serial.portLabel && <span className="serial-port-label">{serial.portLabel}</span>}
        {serial.lastLine && (
          <span className="serial-last-value">Received: {serial.lastLine}</span>
        )}
      </div>

      {serial.error && (
        <p className="serial-error" role="alert">
          {serial.error}
        </p>
      )}

      <div className="serial-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleSelectPort}
          disabled={locked && serial.isConnected}
        >
          {serial.isConnected ? '✓ Port Selected' : '🔌 Select COM Port'}
        </button>
        <button
          type="button"
          className="btn btn-outline"
          onClick={handleReconnect}
          disabled={serial.isConnected}
        >
          ↻ Reconnect
        </button>
        <button
          type="button"
          className="btn btn-outline serial-disconnect-btn"
          onClick={handleDisconnect}
        >
          Disconnect
        </button>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>
            <input
              type="checkbox"
              checked={serialSettings?.enabled ?? false}
              onChange={(e) => onUpdateSettings({ enabled: e.target.checked })}
              style={{ marginRight: '0.5rem' }}
            />
            Enable serial input
          </label>
        </div>
        <div className="form-group">
          <label>
            <input
              type="checkbox"
              checked={locked}
              onChange={(e) => onUpdateSettings({ portLocked: e.target.checked })}
              style={{ marginRight: '0.5rem' }}
            />
            Remember this COM port (auto-connect on startup)
          </label>
        </div>
      </div>

      <p className="serial-hint serial-hint--warning">
        If open fails: close Arduino Serial Monitor / PuTTY, unplug the ESP32 USB cable, plug it
        back in, then click <strong>Disconnect</strong> → <strong>Select COM Port</strong>.
      </p>

      <div className="form-row">
        <div className="form-group">
          <label>Baud rate</label>
          <input
            type="number"
            min={9600}
            max={921600}
            step={9600}
            value={serialSettings?.baudRate ?? 115200}
            onChange={(e) => onUpdateSettings({ baudRate: Number(e.target.value) })}
            disabled={serial.isConnected}
          />
        </div>
        <div className="form-group">
          <label>Button debounce (ms)</label>
          <input
            type="number"
            min={100}
            max={2000}
            step={50}
            value={serialSettings?.debounceMs ?? 500}
            onChange={(e) => onUpdateSettings({ debounceMs: Number(e.target.value) })}
          />
        </div>
      </div>
      <p className="serial-hint" style={{ marginTop: '-0.5rem' }}>
        Ignores repeat triggers until idle (0) is received again, and waits this long between
        actions. Increase if you get false double-stops.
      </p>

      <h5 className="serial-mapping-title">Button value mappings</h5>
      <div className="serial-mapping-grid">
        <div className="form-group">
          <label>Forward</label>
          <input
            type="text"
            maxLength={16}
            value={mappings.forward ?? '1'}
            onChange={(e) =>
              onUpdateSettings({ buttonMappings: { ...mappings, forward: e.target.value } })
            }
          />
        </div>
        <div className="form-group">
          <label>Backward (undo)</label>
          <input
            type="text"
            maxLength={16}
            value={mappings.backward ?? '2'}
            onChange={(e) =>
              onUpdateSettings({ buttonMappings: { ...mappings, backward: e.target.value } })
            }
          />
        </div>
        <div className="form-group">
          <label>Speech (announce)</label>
          <input
            type="text"
            maxLength={16}
            value={mappings.speech ?? '3'}
            onChange={(e) =>
              onUpdateSettings({ buttonMappings: { ...mappings, speech: e.target.value } })
            }
          />
        </div>
        <div className="form-group">
          <label>Idle (no button)</label>
          <input
            type="text"
            maxLength={16}
            value={mappings.idle ?? '0'}
            onChange={(e) =>
              onUpdateSettings({ buttonMappings: { ...mappings, idle: e.target.value } })
            }
          />
        </div>
      </div>

      <h5 className="serial-mapping-title">Text commands</h5>
      <div className="form-row">
        <div className="form-group">
          <label>Enter fullscreen</label>
          <input
            type="text"
            maxLength={32}
            value={serialSettings?.fullscreenCommand ?? 'fullscreen'}
            onChange={(e) => onUpdateSettings({ fullscreenCommand: e.target.value })}
          />
        </div>
        <div className="form-group">
          <label>Exit to control screen</label>
          <input
            type="text"
            maxLength={32}
            value={serialSettings?.exitCommand ?? 'exit'}
            onChange={(e) => onUpdateSettings({ exitCommand: e.target.value })}
          />
        </div>
      </div>

      <p className="serial-hint">
        Keyboard: <kbd>Ctrl</kbd>+<kbd>F</kbd> passenger display · <kbd>Ctrl</kbd>+<kbd>E</kbd>{' '}
        control panel (same browser tab). Serial <code>fullscreen</code> / <code>exit</code> do the
        same.
      </p>
    </div>
  );
}
