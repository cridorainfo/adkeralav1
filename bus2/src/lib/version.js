import pkg from '../../package.json';

export const APP_VERSION = pkg.version;

export function compareSemver(a, b) {
  const pa = String(a ?? '0.0.0').split('.').map((n) => Number(n) || 0);
  const pb = String(b ?? '0.0.0').split('.').map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const av = pa[i] ?? 0;
    const bv = pb[i] ?? 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

export function isNewerVersion(latest, current) {
  return compareSemver(latest, current) > 0;
}
