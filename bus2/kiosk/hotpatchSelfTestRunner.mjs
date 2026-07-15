#!/usr/bin/env node
/**
 * Forked by kiosk/hotpatchSupervisor.cjs to boot ONE candidate server version on a
 * scratch port against a throwaway data root, confirm it answers a request, then exit.
 * Runs as a fully separate process so a broken candidate (syntax error, throw-on-import,
 * hang) can never affect the live server or the supervisor — the parent just kills this
 * process on timeout if it doesn't exit on its own.
 *
 * Exit code 0 = healthy. Any other exit code / a timeout kill = treat as failed.
 */
import { pathToFileURL } from 'url';

function readArg(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : null;
}

async function main() {
  const serverPath = readArg('--server');
  const appRoot = readArg('--app-root');
  const dataRoot = readArg('--data-root');
  if (!serverPath || !appRoot || !dataRoot) {
    console.error('hotpatchSelfTestRunner: missing --server/--app-root/--data-root');
    process.exit(1);
  }

  const { startBusServer } = await import(pathToFileURL(serverPath).href);

  // port: 0 lets the OS assign a free scratch port — never contends with the live server.
  const server = await startBusServer({
    port: 0,
    host: '127.0.0.1',
    appRoot,
    dataRoot,
    selfTest: true,
  });

  const address = server.httpServer.address();
  const actualPort = typeof address === 'object' ? address.port : null;
  if (!actualPort) {
    throw new Error('self-test server has no bound port');
  }

  const res = await fetch(`http://127.0.0.1:${actualPort}/api/network`);
  if (!res.ok) {
    throw new Error(`self-test /api/network returned HTTP ${res.status}`);
  }
  const json = await res.json();
  if (!json?.ok) {
    throw new Error('self-test /api/network responded without ok:true');
  }

  server.shutdown();
  process.exit(0);
}

// Hard safety net — if something above hangs despite its own checks, the parent's kill
// timer is the real backstop, but exiting non-zero here first avoids relying on a SIGTERM
// racing a half-open server.
const hardTimeout = setTimeout(() => {
  console.error('hotpatchSelfTestRunner: hard timeout');
  process.exit(1);
}, 15000);
hardTimeout.unref?.();

main()
  .then(() => clearTimeout(hardTimeout))
  .catch((err) => {
    clearTimeout(hardTimeout);
    console.error('hotpatchSelfTestRunner:', err?.message ?? err);
    process.exit(1);
  });
