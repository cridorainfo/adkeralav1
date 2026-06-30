import SerialSettings from './SerialSettings';

/** ESP32 settings for driver phone — USB stays on bus PC, config syncs over Wi‑Fi. */
export default function DriverEspSettingsPanel({
  serialSettings = {},
  serialRuntime = null,
  onUpdateSerialSettings = () => {},
  compact = false,
}) {
  return (
    <section
      className={`driver-esp-serial-section${compact ? ' driver-esp-serial-section--compact' : ''}`}
      aria-label="ESP32 USB serial"
    >
      <h3 className="driver-esp-serial-heading">ESP32 USB buttons</h3>
      {!compact && (
        <p className="driver-esp-serial-phone-hint">
          Configure on your phone. The USB cable stays on the <strong>bus PC</strong> — enable serial
          below and the passenger screen connects automatically.
        </p>
      )}
      <SerialSettings
        serialSettings={serialSettings}
        onUpdateSettings={onUpdateSerialSettings}
        serial={null}
        isSupported={false}
        remoteConfig
        serialRuntime={serialRuntime}
      />
    </section>
  );
}
