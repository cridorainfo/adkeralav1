const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const { app, dialog } = require('electron');

const MARKER = '.adkerala-firewall-v1';

function getDataRoot() {
  return (
    process.env.ADKERALA_DATA_ROOT ||
    process.env.PORTABLE_EXECUTABLE_DIR ||
    path.dirname(process.env.PORTABLE_EXECUTABLE_FILE || app.getPath('exe'))
  );
}

function hasPortRule(port, ruleName) {
  try {
    const out = execSync(`netsh advfirewall firewall show rule name="${ruleName}"`, {
      encoding: 'utf8',
      shell: true,
    });
    return out.includes('Enabled') && out.includes(String(port));
  } catch {
    return false;
  }
}

function tryInstallPortRule(port, ruleName) {
  try {
    execSync(`netsh advfirewall firewall delete rule name="${ruleName}"`, {
      stdio: 'ignore',
      shell: true,
    });
  } catch {
    /* missing */
  }

  try {
    execSync(
      `netsh advfirewall firewall add rule name="${ruleName}" dir=in action=allow protocol=TCP localport=${port} enable=yes profile=private,public,domain`,
      { stdio: 'ignore', shell: true }
    );
    return hasPortRule(port, ruleName);
  } catch {
    return false;
  }
}

function getFirewallBatPath() {
  const besideExe = path.join(getDataRoot(), 'allow-firewall.bat');
  if (fs.existsSync(besideExe)) return besideExe;
  return path.join(__dirname, '..', 'scripts', 'allow-firewall.bat');
}

function runElevatedFirewallBat() {
  const batPath = getFirewallBatPath();
  if (!fs.existsSync(batPath)) return false;

  const ps = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `Start-Process -FilePath '${batPath.replace(/'/g, "''")}' -Verb RunAs -Wait`,
    ],
    { shell: true, encoding: 'utf8' }
  );
  return ps.status === 0;
}

function ensurePorts(ports) {
  let ok = true;
  for (const { port, ruleName } of ports) {
    if (hasPortRule(port, ruleName) || tryInstallPortRule(port, ruleName)) continue;
    ok = false;
  }
  return ok;
}

/** One-time port rules so driver phones connect without repeated Windows firewall popups. */
async function ensureFirewallOnce(httpPort) {
  if (process.platform !== 'win32') return;

  const httpsPort = Number(process.env.ADKERALA_HTTPS_PORT ?? httpPort + 1);
  const ports = [
    { port: httpPort, ruleName: `AdKerala Bus Port ${httpPort}` },
  ];
  if (process.env.ADKERALA_HTTPS !== '0') {
    ports.push({ port: httpsPort, ruleName: `AdKerala Bus Port ${httpsPort}` });
  }

  if (ensurePorts(ports)) {
    try {
      fs.writeFileSync(path.join(getDataRoot(), MARKER), 'ok');
    } catch {
      /* ignore */
    }
    return;
  }

  const markerPath = path.join(getDataRoot(), MARKER);
  if (fs.existsSync(markerPath)) return;

  const { response } = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Allow once (Administrator)', 'Not now'],
    defaultId: 0,
    cancelId: 1,
    title: 'AdKerala — one-time firewall setup',
    message: 'Allow driver phones to connect without asking every time?',
    detail:
      'Windows will ask for Administrator approval once. Opens ports for display (HTTP) and driver phone (HTTPS).',
  });

  if (response !== 0) {
    try {
      fs.writeFileSync(markerPath, 'skipped');
    } catch {
      /* ignore */
    }
    return;
  }

  runElevatedFirewallBat();
  ensurePorts(ports);

  try {
    fs.writeFileSync(markerPath, 'ok');
  } catch {
    /* ignore */
  }
}

module.exports = { ensureFirewallOnce, hasPortRule };
