/** Default cloud endpoints baked into bus PC / driver builds when env is unset. */

export const DEFAULT_PUBLIC_CLOUD_URL = 'https://adkerala.com';

export const DEFAULT_CLOUD_URLS = [
  DEFAULT_PUBLIC_CLOUD_URL,
  'https://adkeralav1-production.up.railway.app',
];

export function normalizeCloudUrl(url) {
  return String(url ?? '')
    .trim()
    .replace(/\/+$/, '');
}

/** Resolve cloud URL from env. Packaged bus PCs always get production when unset. */
export function resolveCloudUrl(env = process.env) {
  const fromEnv =
    normalizeCloudUrl(env.ADKERALA_CLOUD_URL) ||
    normalizeCloudUrl(env.ADKERALA_PUBLIC_URL) ||
    normalizeCloudUrl(env.VITE_CLOUD_URL);
  if (fromEnv) return fromEnv;
  if (env.ADKERALA_PACKAGED === '1') {
    return DEFAULT_CLOUD_URLS[1] || DEFAULT_PUBLIC_CLOUD_URL;
  }
  return '';
}
