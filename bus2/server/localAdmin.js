import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

/** Start embedded cloud admin unless a remote cloud URL is configured. */
export function shouldStartLocalAdmin() {
  if (process.env.ADKERALA_LOCAL_ADMIN === '0') return false;
  if (process.env.ADKERALA_CLOUD_URL && process.env.ADKERALA_LOCAL_ADMIN !== '1') return false;
  return true;
}

function ensureCloudDeps(cloudDir) {
  if (fs.existsSync(path.join(cloudDir, 'node_modules'))) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const install = spawn('npm', ['install'], { cwd: cloudDir, shell: true, stdio: 'inherit' });
    install.on('error', reject);
    install.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error('cloud npm install failed'));
    });
  });
}

async function isAdminHealthy(adminUrl) {
  try {
    const res = await fetch(`${adminUrl}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForHealth(adminUrl, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    if (await isAdminHealthy(adminUrl)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

/** Spawn cloud/server.js and wire bus env for local fleet admin. */
export async function startLocalAdmin(root) {
  const adminPort = Number(process.env.ADKERALA_ADMIN_PORT ?? 8787);
  const adminUrl = `http://127.0.0.1:${adminPort}`;
  const adminKey = process.env.ADKERALA_ADMIN_KEY ?? 'local-dev-key';

  if (!process.env.ADKERALA_CLOUD_URL) {
    process.env.ADKERALA_CLOUD_URL = adminUrl;
  }
  if (!process.env.ADKERALA_ADMIN_KEY) {
    process.env.ADKERALA_ADMIN_KEY = adminKey;
  }
  if (!process.env.ADKERALA_BUS_ID) {
    process.env.ADKERALA_BUS_ID = 'bus-1';
  }

  if (await isAdminHealthy(adminUrl)) {
    console.log(`  Admin:   ${adminUrl}  (already running — reusing)`);
    return {
      adminUrl,
      adminKey: process.env.ADKERALA_ADMIN_KEY,
      stop: () => {},
    };
  }

  const cloudDir = path.join(root, 'cloud');
  await ensureCloudDeps(cloudDir);

  const child = spawn('node', ['server.js'], {
    cwd: cloudDir,
    env: {
      ...process.env,
      PORT: String(adminPort),
      HOST: '0.0.0.0',
      ADKERALA_ADMIN_KEY: process.env.ADKERALA_ADMIN_KEY,
    },
    stdio: 'inherit',
  });

  child.on('error', (err) => {
    console.warn('AdKerala local admin failed to start:', err.message);
  });

  child.on('exit', (code, signal) => {
    if (code && code !== 0) {
      console.warn(
        `AdKerala local admin exited (code ${code}${signal ? `, ${signal}` : ''}). ` +
          `If port ${adminPort} is in use, stop the other process or set ADKERALA_ADMIN_PORT.`
      );
    }
  });

  const ready = await waitForHealth(adminUrl);
  if (!ready) {
    console.warn(
      `AdKerala local admin did not respond on ${adminUrl}. ` +
        `Port may be in use by another app — try: npx kill-port ${adminPort}`
    );
  }

  return {
    adminUrl,
    adminKey: process.env.ADKERALA_ADMIN_KEY,
    stop: () => {
      if (!child.killed) child.kill();
    },
  };
}
