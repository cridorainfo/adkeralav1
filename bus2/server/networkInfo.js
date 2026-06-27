import os from 'os';

/** Local IPv4 addresses for driver phone / LAN access. */
export function getLanAddresses() {
  const nets = os.networkInterfaces();
  const addrs = [];

  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal) {
        addrs.push({ name, address: net.address });
      }
    }
  }

  return addrs;
}

export function buildNetworkUrls(port, host = '0.0.0.0', options = {}) {
  const lan = getLanAddresses();
  const primary = lan[0]?.address ?? '127.0.0.1';
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
    displayUrl: `${httpBase}/display?autofs=1`,
    controlUrl: httpsEnabled ? `${httpsBase}/control` : `${httpBase}/control`,
    controlUrlHttp: `${httpBase}/control`,
    controlUrlHttps: httpsEnabled ? `${httpsBase}/control` : null,
    homeUrl: `${httpBase}/`,
  };
}

export function logNetworkStartup(urls, extras = {}) {
  console.log(`\n  AdKerala${extras.production ? ' (production)' : ''}`);
  console.log(`  Display: ${urls.displayUrl}  (bus PC)`);
  if (urls.httpsEnabled) {
    console.log(`  Control: ${urls.controlUrl}  (driver phone — HTTPS for GPS)`);
    console.log(`  Control: ${urls.controlUrlHttp}  (HTTP fallback)`);
    console.log(`  Tip: Use port ${urls.httpsPort} with https:// — accept the certificate once on the phone.`);
  } else {
    console.log(`  Control: ${urls.controlUrl}  (driver phone)`);
  }
  if (extras.adminUrl) {
    console.log(`  Admin:   ${extras.adminUrl}  (fleet dashboard)`);
    console.log(`           API key: ${extras.adminKey}`);
  }
  console.log(`  Data:    db/info.txt  +  db/media/`);
  const lan = getLanAddresses();
  if (lan.length) {
    console.log(`  LAN:     ${lan.map((n) => n.address).join(', ')}`);
  } else {
    console.log(`  Local:   http://127.0.0.1:${urls.port}/`);
  }
  console.log('');
}
