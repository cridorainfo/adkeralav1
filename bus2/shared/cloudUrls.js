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

/** Resolve cloud URL from env. Empty when unset (local dev stays offline). */
export function resolveCloudUrl(env = process.env) {
  return (
    normalizeCloudUrl(env.ADKERALA_CLOUD_URL) ||
    normalizeCloudUrl(env.ADKERALA_PUBLIC_URL) ||
    normalizeCloudUrl(env.VITE_CLOUD_URL) ||
    ''
  );
}
