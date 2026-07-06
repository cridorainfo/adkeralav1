/** Allow driver PWA (cloud origin) to call bus PC LAN APIs from the phone browser. */
export function setupBusCors(app) {
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, X-Hub-Token, x-hub-token, X-Driver-Token, x-driver-token'
      );
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      // Chrome Private Network Access — HTTPS cloud PWA → HTTP bus PC (192.168.x.x)
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });
}

/** CORS headers for SSE streams (driver phone polling live state). */
export function applyBusCorsToResponse(req, res) {
  const origin = req.headers.origin;
  if (!origin) return;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
}
