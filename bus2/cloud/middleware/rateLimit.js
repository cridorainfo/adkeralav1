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
// Was completely unrated-limited — a 6-digit fleet-claim code is a 1,000,000-value keyspace, so
// with no throttle an authenticated bus_owner could loop the entire space in a scripted burst.
// Keyed on IP (the rateLimit default), same as the other auth-adjacent limiters above.
export const claimLimiter = rateLimit({ windowMs: 60000, max: 20 });
// pairLimiter/locationLimiter/driveLimiter used to key on req.body.driverId — but driverId is
// entirely client-chosen (pairDriver in store.js accepts any unregistered id with no prior
// auth), so an attacker brute-forcing the 4-digit pairing code could send a fresh random
// driverId per guess and land in a brand-new bucket every time, defeating the limit completely.
// Default keyFn (req.ip) closes that — see the security audit's finding on this.
export const pairLimiter = rateLimit({ windowMs: 60000, max: 30 });
export const authLimiter = rateLimit({ windowMs: 900000, max: 20 });
export const locationLimiter = rateLimit({ windowMs: 60000, max: 120 });
export const driveLimiter = rateLimit({ windowMs: 60000, max: 40 });
