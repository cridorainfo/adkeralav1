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

export function buildNetworkUrls(port, host = '0.0.0.0') {
  const lan = getLanAddresses();
  const primary = lan[0]?.address ?? '127.0.0.1';
  const base = `http://${primary}:${port}`;

  return {
    port,
    host,
    lan,
    displayUrl: `${base}/display?autofs=1`,
    controlUrl: `${base}/control`,
    homeUrl: `${base}/`,
  };
}
