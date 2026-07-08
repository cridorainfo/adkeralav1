import http from 'http';
import os from 'os';
import { execFileSync } from 'child_process';
import { isVpnOnlyAddress } from '../cloud/shared/hub/lan.js';

const VIRTUAL_NIC_PREFIX =
  /^(vmware|virtualbox|vbox|hyper-v|vethernet|loopback|bluetooth|npcap|wintun|tailscale|zerotier|radmin|hamachi|docker|wsl|neko|wireguard|nordlynx|openvpn|tap\d*|tun\d*)/i;
const VIRTUAL_NIC_SUBSTR =
  /vpn|anyconnect|forticlient|nord|warp|proton|expressvpn|cisco|globalprotect|pulse|zscaler|softether|surfshark|mullvad|private internet|cloudflare|zerotier|tailscale|hamachi|radmin|wireguard|wintun|hyper-v|vethernet/i;
const LINK_LOCAL = /^169\.254\./;
const WIFI_NIC = /^(wi-?fi|wlan|wireless)/i;
const ETHERNET_NIC = /^(ethernet|eth|lan)/i;

/** Skip VPN / virtual adapters that often expose unreachable 10.x addresses to phones. */
export function isVirtualNicName(name) {
  return VIRTUAL_NIC_PREFIX.test(name) || VIRTUAL_NIC_SUBSTR.test(name);
}

function isIPv4Net(net) {
  return net.family === 'IPv4' || net.family === 4;
}

function isPhoneAdvertisableAddress(address) {
  if (!address || LINK_LOCAL.test(address) || isVpnOnlyAddress(address)) return false;
  return true;
}

function envLanOverride() {
  const ip = String(process.env.ADKERALA_LAN_IP ?? '').trim();
  if (!ip || !isPhoneAdvertisableAddress(ip)) return [];
  return [{ name: 'ADKERALA_LAN_IP', address: ip }];
}

/** Windows fallback — os.networkInterfaces() sometimes omits the Wi‑Fi IP when VPN is active. */
function getWindowsLanAddressesFallback() {
  if (process.platform !== 'win32') return [];
  try {
    const script = [
      "Get-NetIPAddress -AddressFamily IPv4",
      "| Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' }",
      "| ForEach-Object { $_.InterfaceAlias + '|' + $_.IPAddress }",
    ].join(' ');
    const out = execFileSync('powershell', ['-NoProfile', '-Command', script], {
      encoding: 'utf8',
      timeout: 8000,
      windowsHide: true,
    });
    const addrs = [];
    for (const line of out.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const sep = trimmed.lastIndexOf('|');
      if (sep < 0) continue;
      const name = trimmed.slice(0, sep).trim();
      const address = trimmed.slice(sep + 1).trim();
      if (!isPhoneAdvertisableAddress(address) || isVirtualNicName(name)) continue;
      addrs.push({ name, address });
    }
    return addrs;
  } catch {
    return [];
  }
}

function scoreNic(name) {
  if (WIFI_NIC.test(name)) return 30;
  if (ETHERNET_NIC.test(name)) return 20;
  if (/hotspot|mobile|local area connection/i.test(name)) return 25;
  return 10;
}

/** Higher score = better candidate for driver phones (hotspot / 192.168 over 10.x VPN ranges). */
export function scoreLanEntry({ name, address }) {
  return scoreNic(name) + scoreIp(address);
}

function scoreIp(address) {
  if (address === '192.168.137.1') return 100;
  if (address.startsWith('192.168.137.')) return 90;
  if (address.startsWith('192.168.')) return 80;
  const parts = address.split('.').map(Number);
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return 50;
  if (parts[0] === 10) return 20;
  return 10;
}

/** 1 = 192.168 (phones), 2 = 172.16–31, 3 = 10.x (often VPN), 4 = other */
export function lanAddressTier(address) {
  if (address.startsWith('192.168.')) return 1;
  const parts = address.split('.').map(Number);
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return 2;
  if (parts[0] === 10) return 3;
  return 4;
}

export function rankLanAddresses(lan) {
  return [...lan].sort((a, b) => scoreLanEntry(b) - scoreLanEntry(a));
}

/** Local IPv4 addresses for driver phone / LAN access. */
export function getLanAddresses() {
  const nets = os.networkInterfaces();
  const addrs = [];
  const seen = new Set();

  const push = (entry) => {
    if (!isPhoneAdvertisableAddress(entry.address) || seen.has(entry.address)) return;
    seen.add(entry.address);
    addrs.push(entry);
  };

  for (const name of Object.keys(nets)) {
    if (isVirtualNicName(name)) continue;
    for (const net of nets[name] ?? []) {
      if (isIPv4Net(net) && !net.internal) {
        push({ name, address: net.address });
      }
    }
  }

  for (const entry of getWindowsLanAddressesFallback()) {
    push(entry);
  }
  for (const entry of envLanOverride()) {
    push(entry);
  }

  return rankLanAddresses(addrs);
}

/** Best LAN IP for driver phones (Wi‑Fi / hotspot preferred over virtual adapters). */
export function pickPrimaryLanAddress(lan = getLanAddresses()) {
  const usable = rankLanAddresses(lan.filter((n) => isPhoneAdvertisableAddress(n.address)));
  if (!usable.length) return '127.0.0.1';
  return usable[0].address;
}

/** Never advertise 127.0.0.1 to driver phones — they cannot reach loopback. */
export function controlIpForPhones(ip) {
  if (!ip || ip === '127.0.0.1') return null;
  return ip;
}

/**
 * Probe each LAN adapter and return the first IP phones can reach on this PC.
 * Falls back to scored primary if probes fail (firewall may still block phones).
 */
export function preferredProbeTiers(lan) {
  const ranked = rankLanAddresses(lan);
  if (ranked.some((n) => lanAddressTier(n.address) === 1)) {
    return { ranked, tiers: [1] };
  }
  if (ranked.some((n) => lanAddressTier(n.address) === 2)) {
    return { ranked, tiers: [2] };
  }
  return { ranked, tiers: [3, 4] };
}

export async function findBestControlIp(port, lan = getLanAddresses()) {
  if (!lan.length) {
    return { ip: null, name: null, ok: false, error: 'no_lan_ip' };
  }

  const { ranked, tiers } = preferredProbeTiers(lan);

  for (const tier of tiers) {
    const candidates = ranked.filter((n) => lanAddressTier(n.address) === tier);
    for (const n of candidates) {
      const result = await probeLanHttp(n.address, port);
      if (result.ok) {
        return { ip: n.address, name: n.name, ok: true, error: null };
      }
    }
  }

  const fallback = controlIpForPhones(pickPrimaryLanAddress(lan));
  if (!fallback) {
    return { ip: null, name: null, ok: false, error: 'no_lan_ip' };
  }

  const loopbackProbe = await probeLanHttp('127.0.0.1', port);

  return {
    ip: fallback,
    name: lan.find((n) => n.address === fallback)?.name ?? null,
    ok: false,
    error: 'probe_failed',
    serverListening: loopbackProbe.ok,
  };
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
  const primary = controlIpForPhones(options.primaryIp ?? pickPrimaryLanAddress(lan));
  const httpBase = primary ? `http://${primary}:${port}` : null;
  const httpsEnabled = Boolean(options.httpsEnabled);
  const httpsPort = options.httpsPort ?? port + 1;
  const httpsBase = primary && httpsEnabled ? `https://${primary}:${httpsPort}` : null;

  return {
    port,
    httpsPort: httpsEnabled ? httpsPort : null,
    httpsEnabled,
    host,
    lan,
    primaryIp: primary,
    displayUrl: httpBase ? `${httpBase}/display?autofs=1` : null,
    driverUrl: httpBase ? `${httpBase}/driver` : null,
    /** Phones should open HTTP first — no certificate required. */
    controlUrl: httpBase ? `${httpBase}/control` : null,
    controlUrlHttp: httpBase ? `${httpBase}/control` : null,
    controlUrlHttps: httpsBase ? `${httpsBase}/control` : null,
    homeUrl: httpBase ? `${httpBase}/` : null,
    controlUrls: lan
      .map((n) => controlIpForPhones(n.address))
      .filter(Boolean)
      .map((ip) => {
        const entry = lan.find((n) => n.address === ip);
        return {
          ip,
          name: entry?.name ?? '',
          controlUrl: `http://${ip}:${port}/control`,
          driverUrl: `http://${ip}:${port}/driver`,
        };
      }),
    lanReachable: options.lanReachable ?? null,
    lanProbeError: options.lanProbeError ?? null,
  };
}

export function lanSetupHint(error) {
  if (error === 'no_lan_ip') {
    return 'Connect this PC to Wi‑Fi, or turn on Windows Mobile Hotspot (Settings → Mobile hotspot). The driver QR appears automatically.';
  }
  if (error === 'probe_failed') {
    return 'Run allow-firewall.bat as administrator on this PC, then wait a few seconds.';
  }
  return 'Connect Wi‑Fi or turn on Mobile Hotspot on this PC so driver phones can join.';
}

export function logNetworkStartup(urls, extras = {}) {
  console.log(`\n  AdKerala${extras.production ? ' (production)' : ''}`);
  console.log(`  Display: ${urls.displayUrl ?? '(waiting for Wi-Fi / hotspot)'}  (bus PC)`);
  console.log(
    `  Control: ${urls.controlUrlHttp ?? '(waiting for Wi-Fi / hotspot)'}  (driver phone - use HTTP on same Wi-Fi)`
  );
  if (urls.httpsEnabled) {
    console.log(
      `  Control: ${urls.controlUrlHttps ?? '(waiting for Wi-Fi / hotspot)'}  (HTTPS - for GPS; accept certificate once)`
    );
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
    console.log(`  LAN:     none - connect Wi-Fi, enable Mobile Hotspot, or set ADKERALA_LAN_IP`);
    console.log(`  Local:   http://127.0.0.1:${urls.port}/`);
  }
  console.log('');
}
