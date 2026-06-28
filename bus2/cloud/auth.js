import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';

const JWT_SECRET = process.env.ADKERALA_JWT_SECRET || 'dev-jwt-secret-change-in-production';
const ADMIN_KEY = process.env.ADKERALA_ADMIN_KEY ?? 'change-me-in-production';
const COOKIE_NAME = 'adkerala_session';
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/',
};

export const ROLES = ['admin', 'bus_owner', 'driver', 'advertiser'];
export const SIGNUP_ROLES = ['bus_owner', 'driver', 'advertiser'];

export function getCookieName() {
  return COOKIE_NAME;
}

export function getCookieOptions() {
  const opts = { ...COOKIE_OPTS };
  const domain = process.env.ADKERALA_COOKIE_DOMAIN?.trim();
  if (domain) opts.domain = domain;
  return opts;
}

export async function hashPassword(password) {
  return bcrypt.hash(String(password), 10);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(String(password), hash);
}

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

export function sanitizeUser(user) {
  if (!user) return null;
  const { passwordHash, ...safe } = user;
  return safe;
}

export function canAccessBus(user, busId, profile) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'bus_owner' && profile?.ownerId === user.id) return true;
  return false;
}

export function canAccessBusId(user, busProfiles, busId) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'bus_owner') {
    const profile = busProfiles?.[busId];
    return profile?.ownerId === user.id;
  }
  return false;
}

export function authSession(req, res, next) {
  const key = req.headers['x-admin-key'] ?? req.query.key;
  if (key === ADMIN_KEY) {
    req.user = { id: 'legacy-admin', email: 'admin@legacy', role: 'admin', name: 'API Key Admin', legacy: true };
    req.authMethod = 'api-key';
    next();
    return;
  }

  const token = req.cookies?.[COOKIE_NAME];
  if (token) {
    const payload = verifyToken(token);
    if (payload?.sub) {
      req.user = {
        id: payload.sub,
        email: payload.email,
        role: payload.role,
        name: payload.name,
      };
      req.authMethod = 'jwt';
      next();
      return;
    }
  }

  req.user = null;
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return;
  }
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ ok: false, error: 'Forbidden' });
      return;
    }
    next();
  };
}

/** Legacy alias — accepts API key or JWT with admin/bus_owner where applicable */
export function authAdmin(req, res, next) {
  authSession(req, res, () => {
    if (!req.user) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }
    next();
  });
}

export function authCatalog(req, res, next) {
  authSession(req, res, () => {
    if (!req.user) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }
    if (!['admin', 'bus_owner'].includes(req.user.role)) {
      res.status(403).json({ ok: false, error: 'Forbidden' });
      return;
    }
    next();
  });
}

export function dashboardPathForRole(role) {
  switch (role) {
    case 'admin':
      return '/admin';
    case 'bus_owner':
      return '/owner';
    case 'advertiser':
      return '/advertiser';
    case 'driver':
      return '/driver';
    default:
      return '/';
  }
}
