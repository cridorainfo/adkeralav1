import http from 'http';
import os from 'os';

const VIRTUAL_NIC =
  /^(vmware|virtualbox|vbox|hyper-v|vethernet|loopback|bluetooth|npcap|wintun|tailscale|zerotier|radmin|hamachi|docker|wsl|neko)/i;
const LINK_LOCAL = /^169\.254\./;
const WIFI_NIC = /^(wi-?fi|wlan|wireless)/i;
const ETHERNET_NIC = /^(ethernet|eth|lan)/i;

/** Local IPv4 addresses for driver phone / LAN access. */
export function getLanAddresses() {
  const nets = os.networkInterfaces();
  const addrs = [];

  for (const name of Object.keys(nets)) {
    if (VIRTUAL_NIC.test(name)) continue;
    for (const net of nets[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal && !LINK_LOCAL.test(net.address)) {
        addrs.push({ name, address: net.address });
      }
    }
  }

  return addrs.sort((a, b) => scoreNic(a.name) - scoreNic(b.name)).reverse();
}

function scoreNic(name) {
  if (WIFI_NIC.test(name)) return 30;
  if (ETHERNET_NIC.test(name)) return 20;
  if (/hotspot|mobile|local area connection/i.test(name)) return 25;
  return 10;
}

/** Best LAN IP for driver phones (Wi‑Fi / hotspot preferred over virtual adapters). */
export function pickPrimaryLanAddress(lan = getLanAddresses()) {
  if (!lan.length) return '127.0.0.1';
  const hotspot = lan.find((n) => n.address.startsWith('192.168.137.'));
  if (hotspot) return hotspot.address;
  return lan[0].address;
}

/** Can phones on the LAN reach this PC? (same test the bus PC runs on its Wi‑Fi IP) */
export function probeLanHttp(ip, port, probePath = '/api/network', timeoutMs = 4000) {
  if (!ip || ip === '127.0.0.1') {
    return Promise.resolve({ ok: false, error: 'no_lan_ip' });
  }

  return new Promise((resolve) => {
    const req = http.get(
      { host: ip, port, path: probePath, family: 4, timeout: timeoutMs },
      (res) => {
        res.resume();
        resolve({
          ok: res.statusCode != null && res.statusCode < 500,
          statusCode: res.statusCode,
        });
      }
    );
    req.on('error', (err) => resolve({ ok: false, error: err.code || err.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'timeout' });
    });
  });
}

export function buildNetworkUrls(port, host = '0.0.0.0', options = {}) {
  const lan = getLanAddresses();
  const primary = pickPrimaryLanAddress(lan);
  const httpBase = `http://${primary}:${port}`;
  const httpsEnabled = Boolean(options.httpsEnabled);
  const httpsPort = options.httpsPort ?? port + 1;
  const httpsBase = `https://${primary}:${httpsPort}`;

  return {
    port,
    httpsPort: httpsEnabled ? httpsPort : null,
    httpsEnabled,
    host,
    lan,
    primaryIp: primary,
    displayUrl: `${httpBase}/display?autofs=1`,
    driverUrl: `${httpBase}/driver`,
    /** Phones should open HTTP first — no certificate required. */
    controlUrl: `${httpBase}/control`,
    controlUrlHttp: `${httpBase}/control`,
    controlUrlHttps: httpsEnabled ? `${httpsBase}/control` : null,
    homeUrl: `${httpBase}/`,
    controlUrls: lan.map((n) => ({
      ip: n.address,
      name: n.name,
      controlUrl: `http://${n.address}:${port}/control`,
      driverUrl: `http://${n.address}:${port}/driver`,
    })),
    lanReachable: options.lanReachable ?? null,
    lanProbeError: options.lanProbeError ?? null,
  };
}

export function logNetworkStartup(urls, extras = {}) {
  console.log(`\n  AdKerala${extras.production ? ' (production)' : ''}`);
  console.log(`  Display: ${urls.displayUrl}  (bus PC)`);
  console.log(`  Control: ${urls.controlUrlHttp}  (driver phone — use HTTP on same Wi‑Fi)`);
  if (urls.httpsEnabled) {
    console.log(`  Control: ${urls.controlUrlHttps}  (HTTPS — for GPS; accept certificate once)`);
  }
  if (extras.adminUrl) {
    console.log(`  Admin:   ${extras.adminUrl}  (fleet dashboard)`);
    console.log(`           API key: ${extras.adminKey}`);
  }
  console.log(`  Data:    db/info.txt  +  db/media/`);
  const lan = getLanAddresses();
  if (lan.length) {
    console.log(`  LAN:     ${lan.map((n) => `${n.address} (${n.name})`).join(', ')}`);
  } else {
    console.log(`  Local:   http://127.0.0.1:${urls.port}/`);
  }
  console.log('');
}
