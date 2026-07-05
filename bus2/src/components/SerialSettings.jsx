const STATUS_LABELS = {
  idle: 'Not connected',
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  connected: 'Connected',
  disconnected: 'Disconnected',
  waiting: 'Waiting for console…',
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
        serial.setError?.('Saved port not found. Click Select COM Port and choose the console again.');
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
        <h4 className="settings-section-title">Console USB buttons</h4>
        <p className="serial-panel-desc">
          The console USB cable plugs into the <strong>bus PC</strong> (passenger display). The bus PC
          auto-connects to any authorized COM port.
        </p>

        <div className="serial-status-row">
          <span className={`serial-status-dot ${runtimeConnected ? 'on' : ''}`} aria-hidden />
          <strong>Bus PC: {runtimeLabel}</strong>
          {serialRuntime?.portLabel && (
            <span className="serial-port-label">{serialRuntime.portLabel}</span>
          )}
          {serialRuntime?.lastLine && (
            <span className="serial-last-value">Last: {serialRuntime.lastLine}</span>
          )}
        </div>

        {serialRuntime?.error && (
          <p className="serial-error" role="alert">
            {serialRuntime.error}
          </p>
        )}

        {!serialRuntime?.at && (
          <p className="serial-hint">
            Waiting for connection status from the bus PC. On first setup, tap{' '}
            <strong>Connect console USB</strong> once on the passenger screen.
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
          First time only: on the bus passenger screen, tap <strong>Connect console USB</strong> once
          to authorize the COM port. After that the bus PC reconnects automatically.
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
          Web Serial is not available in this browser. Use Chrome or Edge on desktop to connect the
          console.
        </p>
      </div>
    );
  }

  if (compact && !remoteConfig) {
    return (
      <div className={`serial-status-bar ${serial.isConnected ? 'connected' : ''}`}>
        <span className="serial-status-dot" aria-hidden />
        <span className="serial-status-text">
          Console: {STATUS_LABELS[serial.status] ?? serial.status}
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
      <h4 className="settings-section-title">Console serial control</h4>
      <p className="serial-panel-desc">
        Connect the console over USB on this PC. Select COM port — the bus PC auto-connects to any
        authorized port after restart. Buttons <code>1</code>/<code>2</code>/<code>3</code> map to
        Forward / Undo / Announce (same as the on-screen buttons).
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
        If open fails: close other serial apps, unplug the console USB cable, plug it back in, then
        click <strong>Disconnect</strong> → <strong>Select COM Port</strong>.
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
