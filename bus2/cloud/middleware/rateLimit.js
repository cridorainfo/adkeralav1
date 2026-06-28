const buckets = new Map();

/** Simple in-memory rate limiter (per key, sliding window). */
export function rateLimit({ windowMs = 60000, max = 30, keyFn = (req) => req.ip }) {
  return (req, res, next) => {
    const key = keyFn(req) ?? 'unknown';
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || now - bucket.start > windowMs) {
      bucket = { start: now, count: 0 };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      res.status(429).json({ ok: false, error: 'Too many requests. Try again later.' });
      return;
    }
    next();
  };
}

export const enrollLimiter = rateLimit({ windowMs: 60000, max: 60 });
export const pairLimiter = rateLimit({ windowMs: 60000, max: 5 });
export const authLimiter = rateLimit({ windowMs: 900000, max: 20 });
export const locationLimiter = rateLimit({
  windowMs: 60000,
  max: 120,
  keyFn: (req) => String(req.body?.driverId ?? req.ip),
});
export const driveLimiter = rateLimit({
  windowMs: 60000,
  max: 40,
  keyFn: (req) => String(req.body?.driverId ?? req.ip),
});
