import { execSync } from 'child_process';

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

function tryAddPortRule(port, ruleName) {
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

/** Open Windows firewall for bus HTTP + HTTPS (driver phone LAN access). */
export function ensureWindowsFirewallPorts(ports) {
  if (process.platform !== 'win32') return;

  const failed = [];
  for (const port of ports) {
    const ruleName = `AdKerala Bus Port ${port}`;
    if (hasPortRule(port, ruleName) || tryAddPortRule(port, ruleName)) continue;
    failed.push(port);
  }

  if (failed.length) {
    console.warn(
      `  Firewall: could not open port(s) ${failed.join(', ')} automatically.\n` +
        `           Run scripts/allow-firewall.bat as Administrator (driver phone needs ${failed.join(' and ')}).`
    );
  }
}
