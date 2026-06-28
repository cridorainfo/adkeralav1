/** Canonical cloud URLs — used for links, bus clients, and CORS. */

const DEFAULT_PUBLIC_URL = 'https://adkerala.com';
const DEFAULT_ALT_URLS = ['https://adkeralav1-production.up.railway.app'];

function normalizeUrl(url) {
  return String(url ?? '')
    .trim()
    .replace(/\/+$/, '');
}

function parseUrlList(raw) {
  if (!raw) return [];
  return raw
    .split(/[,;\s]+/)
    .map(normalizeUrl)
    .filter(Boolean);
}

/** Primary public URL (custom domain). */
export function getPublicUrl() {
  return (
    normalizeUrl(process.env.ADKERALA_PUBLIC_URL) ||
    normalizeUrl(process.env.ADKERALA_CLOUD_URL) ||
    DEFAULT_PUBLIC_URL
  );
}

/** All known cloud base URLs (primary + alternates). */
export function getCloudUrls() {
  const primary = getPublicUrl();
  const fromEnv = parseUrlList(
    process.env.ADKERALA_CLOUD_URLS || process.env.ADKERALA_ALT_URLS || ''
  );
  const urls = [primary, ...fromEnv, ...DEFAULT_ALT_URLS];
  return [...new Set(urls.map(normalizeUrl).filter(Boolean))];
}

/** Hostnames served by this deployment (for redirects / logging). */
export function getAllowedHosts() {
  return getCloudUrls().map((url) => {
    try {
      return new URL(url).hostname;
    } catch {
      return null;
    }
  }).filter(Boolean);
}

export function getPublicConfig() {
  const publicUrl = getPublicUrl();
  return {
    publicUrl,
    cloudUrls: getCloudUrls(),
    allowedHosts: getAllowedHosts(),
  };
}
