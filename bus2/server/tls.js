import { createServer as createHttpsServer } from 'https';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import selfsigned from 'selfsigned';
import { getLanAddresses } from './networkInfo.js';

/** HTTPS for driver phone geolocation — enabled unless ADKERALA_HTTPS=0. */
export function isHttpsEnabled() {
  return process.env.ADKERALA_HTTPS !== '0';
}

export function getHttpsPort(httpPort) {
  return Number(process.env.ADKERALA_HTTPS_PORT ?? httpPort + 1);
}

function buildCertAltNames() {
  const altNames = [
    { type: 2, value: 'localhost' },
    { type: 2, value: 'adkerala.local' },
    { type: 7, ip: '127.0.0.1' },
  ];

  for (const { address } of getLanAddresses()) {
    if (address && !altNames.some((a) => a.ip === address)) {
      altNames.push({ type: 7, ip: address });
    }
  }

  return altNames;
}

function certFingerprint(altNames) {
  return altNames
    .map((a) => (a.ip ? `ip:${a.ip}` : `dns:${a.value}`))
    .sort()
    .join('|');
}

async function loadOrCreateCert(certsDir) {
  const keyPath = path.join(certsDir, 'bus-key.pem');
  const certPath = path.join(certsDir, 'bus-cert.pem');
  const metaPath = path.join(certsDir, 'bus-cert-meta.json');

  const altNames = buildCertAltNames();
  const fp = certFingerprint(altNames);

  if (existsSync(keyPath) && existsSync(certPath) && existsSync(metaPath)) {
    try {
      const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
      const [key, cert] = await Promise.all([
        fs.readFile(keyPath, 'utf8'),
        fs.readFile(certPath, 'utf8'),
      ]);
      if (key && cert && meta.fingerprint === fp) {
        return { key, cert };
      }
    } catch {
      /* regenerate below */
    }
  }

  const attrs = [{ name: 'commonName', value: 'AdKerala Bus LAN' }];
  const notAfterDate = new Date(Date.now() + 825 * 24 * 60 * 60 * 1000);
  const pems = await selfsigned.generate(attrs, {
    keySize: 2048,
    algorithm: 'sha256',
    notAfterDate,
    extensions: [
      { name: 'basicConstraints', cA: false, critical: true },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
      { name: 'extKeyUsage', serverAuth: true, clientAuth: true },
      { name: 'subjectAltName', altNames },
    ],
  });

  if (!pems?.private || !pems?.cert) {
    throw new Error('selfsigned.generate did not return key/cert PEM');
  }

  await fs.mkdir(certsDir, { recursive: true });
  await fs.writeFile(keyPath, pems.private, 'utf8');
  await fs.writeFile(certPath, pems.cert, 'utf8');
  await fs.writeFile(metaPath, JSON.stringify({ fingerprint: fp, createdAt: Date.now() }, null, 2));

  return { key: pems.private, cert: pems.cert };
}

/**
 * Mirror the same Express app on HTTPS (self-signed cert in dataRoot/certs/).
 * Driver phone should use controlUrlHttps for reliable geolocation.
 */
export async function startHttpsMirror(app, { dataRoot, httpPort, host = '0.0.0.0' }) {
  if (!isHttpsEnabled()) {
    return { httpsServer: null, httpsPort: null, httpsEnabled: false };
  }

  const httpsPort = getHttpsPort(httpPort);
  const certsDir = path.join(dataRoot, 'certs');
  const { key, cert } = await loadOrCreateCert(certsDir);

  const httpsServer = createHttpsServer({ key, cert }, app);

  await new Promise((resolve, reject) => {
    httpsServer.once('error', reject);
    httpsServer.listen(httpsPort, host, resolve);
  });

  return { httpsServer, httpsPort, httpsEnabled: true, certsDir };
}
