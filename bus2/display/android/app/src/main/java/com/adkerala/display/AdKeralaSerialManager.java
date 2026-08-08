package com.adkerala.display;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbManager;
import android.util.Log;
import android.webkit.WebView;

import androidx.core.content.ContextCompat;

import com.hoho.android.usbserial.driver.UsbSerialDriver;
import com.hoho.android.usbserial.driver.UsbSerialPort;
import com.hoho.android.usbserial.driver.UsbSerialProber;
import com.hoho.android.usbserial.util.SerialInputOutputManager;

import org.json.JSONObject;

import java.io.IOException;
import java.util.List;

/**
 * ESP32 stop-announcement console over USB — Android counterpart to kiosk/serialPort.cjs's
 * Web Serial auto-pick-and-connect on PC. Same vendor-ID preference order, and the same
 * fire-and-forget JS event contract src/hooks/useAndroidSerialBridge.js already implements:
 * dispatches 'adkerala-serial' (raw button/text values — src/lib/serialValueParser.js does the
 * actual interpretation, unchanged, same as the PC path) and 'adkerala-serial-status' into the
 * WebView. See AdKeralaSerialBridge.java for the JS-callable half of this (requestSerialStatus
 * etc.) and MainActivity.java for how both get wired into the page.
 */
public class AdKeralaSerialManager {

    private static final String TAG = "AdKeralaSerial";
    private static final String ACTION_USB_PERMISSION = "com.adkerala.display.USB_PERMISSION";

    // Same preference order as kiosk/serialPort.cjs's CONSOLE_VENDOR_IDS — prefer a known
    // console chip, else fall back to whatever's plugged in (last device in the list, mirroring
    // that file's `portList[portList.length - 1]` fallback).
    private static final int[] PREFERRED_VENDOR_IDS = {
        0x303a, // Espressif native USB
        0x10c4, // Silicon Labs CP210x
        0x1a86, // WCH CH340
        0x2341, // Arduino
        0x0403, // FTDI
    };

    private static final int DEFAULT_BAUD_RATE = 115200; // matches src/hooks/useSerialPort.js's default

    private final Context context;
    private final UsbManager usbManager;
    private final WebView webView;

    private UsbSerialPort activePort;
    private SerialInputOutputManager ioManager;
    private String status = "idle";
    private String portLabel = "";
    private final StringBuilder lineBuffer = new StringBuilder();

    public AdKeralaSerialManager(Context context, WebView webView) {
        this.context = context;
        this.webView = webView;
        this.usbManager = (UsbManager) context.getSystemService(Context.USB_SERVICE);

        IntentFilter filter = new IntentFilter(ACTION_USB_PERMISSION);
        filter.addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED);
        filter.addAction(UsbManager.ACTION_USB_DEVICE_DETACHED);
        ContextCompat.registerReceiver(context, usbReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    private final BroadcastReceiver usbReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context ctx, Intent intent) {
            String action = intent.getAction();
            if (ACTION_USB_PERMISSION.equals(action)) {
                @SuppressWarnings("deprecation") // typed getParcelableExtra(String, Class) needs API 33+; this still works, just deprecated
                UsbDevice device = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
                boolean granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false);
                if (granted && device != null) {
                    openDevice(device);
                } else {
                    setStatus("error", "USB permission denied");
                }
            } else if (UsbManager.ACTION_USB_DEVICE_ATTACHED.equals(action)) {
                Log.i(TAG, "usb device attached — attempting connect");
                connect();
            } else if (UsbManager.ACTION_USB_DEVICE_DETACHED.equals(action)) {
                Log.i(TAG, "usb device detached");
                closePort();
                setStatus("idle", null);
            }
        }
    };

    /** Auto-pick and connect to whatever console is attached right now — no user interaction,
     * mirroring Electron's zero-prompt session.setDevicePermissionHandler on PC. Safe to call
     * repeatedly (idempotent no-op if already connected or nothing's attached). */
    public void connect() {
        if (activePort != null) return; // already connected

        UsbSerialDriver driver = pickDriver();
        if (driver == null) {
            setStatus("idle", null);
            return;
        }

        UsbDevice device = driver.getDevice();
        if (!usbManager.hasPermission(device)) {
            PendingIntent permissionIntent = PendingIntent.getBroadcast(
                context, 0, new Intent(ACTION_USB_PERMISSION), PendingIntent.FLAG_MUTABLE);
            setStatus("connecting", null);
            usbManager.requestPermission(device, permissionIntent);
            return;
        }
        openDevice(device);
    }

    private UsbSerialDriver pickDriver() {
        List<UsbSerialDriver> drivers = UsbSerialProber.getDefaultProber().findAllDrivers(usbManager);
        if (drivers.isEmpty()) return null;
        for (int vendorId : PREFERRED_VENDOR_IDS) {
            for (UsbSerialDriver d : drivers) {
                if (d.getDevice().getVendorId() == vendorId) return d;
            }
        }
        return drivers.get(drivers.size() - 1);
    }

    private void openDevice(UsbDevice device) {
        UsbSerialDriver driver = UsbSerialProber.getDefaultProber().probeDevice(device);
        if (driver == null || driver.getPorts().isEmpty()) {
            setStatus("error", "unsupported console device");
            return;
        }
        UsbDeviceConnection connection = usbManager.openDevice(device);
        if (connection == null) {
            setStatus("error", "could not open USB connection");
            return;
        }

        UsbSerialPort port = driver.getPorts().get(0);
        try {
            port.open(connection);
            port.setParameters(
                DEFAULT_BAUD_RATE, UsbSerialPort.DATABITS_8, UsbSerialPort.STOPBITS_1, UsbSerialPort.PARITY_NONE);
        } catch (IOException e) {
            setStatus("error", "failed to open port: " + e.getMessage());
            try {
                port.close();
            } catch (IOException ignored) {
                /* already broken */
            }
            return;
        }

        activePort = port;
        portLabel = device.getProductName() != null ? device.getProductName() : device.getDeviceName();

        ioManager = new SerialInputOutputManager(port, new SerialInputOutputManager.Listener() {
            @Override
            public void onNewData(byte[] data) {
                handleIncomingBytes(data);
            }

            @Override
            public void onRunError(Exception e) {
                Log.w(TAG, "serial read loop stopped", e);
                setStatus("error", e.getMessage());
                closePort();
            }
        });
        // SerialInputOutputManager manages its own background thread — start()/stop(), not
        // Runnable/ExecutorService.submit() (that was wrong; caught by an actual compile error).
        ioManager.start();

        setStatus("connected", null);
    }

    /**
     * Mirrors src/lib/serialValueParser.js's own framing tolerance on PC (newline-delimited
     * Serial.println, OR a continuous single-digit stream from Serial.print with no newline) —
     * forwards raw decoded text values and lets that already-tested JS parser, shared with the
     * Web Serial path, do the actual interpretation rather than re-implementing it natively.
     */
    private void handleIncomingBytes(byte[] data) {
        String chunk = new String(data);
        for (int i = 0; i < chunk.length(); i++) {
            char c = chunk.charAt(i);
            if (c == '\n' || c == '\r') {
                flushLine();
            } else {
                lineBuffer.append(c);
                if (lineBuffer.length() == 1 && Character.isDigit(c)) {
                    // A single digit with no newline is itself a complete value — flush
                    // immediately rather than holding it for a newline that may never come.
                    flushLine();
                }
            }
        }
    }

    private void flushLine() {
        if (lineBuffer.length() == 0) return;
        String value = lineBuffer.toString().trim();
        lineBuffer.setLength(0);
        if (!value.isEmpty()) dispatchSerialValue(value);
    }

    private void dispatchSerialValue(String value) {
        runJs("window.dispatchEvent(new CustomEvent('adkerala-serial', {detail: {value: "
            + JSONObject.quote(value) + "}}));");
    }

    private void setStatus(String newStatus, String error) {
        status = newStatus;
        JSONObject detail = new JSONObject();
        try {
            detail.put("status", newStatus);
            detail.put("portLabel", portLabel);
            if (error != null) detail.put("error", error);
        } catch (Exception e) {
            Log.w(TAG, "failed to build status event", e);
        }
        runJs("window.dispatchEvent(new CustomEvent('adkerala-serial-status', {detail: " + detail + "}));");
    }

    private void runJs(String script) {
        webView.post(() -> webView.evaluateJavascript(script, null));
    }

    private void closePort() {
        if (ioManager != null) {
            ioManager.stop();
            ioManager = null;
        }
        if (activePort != null) {
            try {
                activePort.close();
            } catch (IOException ignored) {
                /* already broken */
            }
            activePort = null;
        }
    }

    public void requestStatus() {
        setStatus(status, null);
    }

    public void disconnect() {
        closePort();
        setStatus("idle", null);
    }

    public void reconnect() {
        closePort();
        connect();
    }
}
