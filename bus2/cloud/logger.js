import { usePostgres } from './db/pool.js';
import { pgWriteAudit } from './storePg.js';
import { loadStore, saveStore } from './store.js';
import { randomUUID } from 'crypto';

export async function writeAudit(action, actorId, details = {}) {
  if (usePostgres()) {
    await pgWriteAudit(action, actorId, details);
    return;
  }
  const store = await loadStore();
  if (!store.auditLog) store.auditLog = [];
  store.auditLog.push({
    id: randomUUID(),
    action,
    actorId: actorId ?? null,
    details,
    createdAt: Date.now(),
  });
  if (store.auditLog.length > 5000) {
    store.auditLog = store.auditLog.slice(-5000);
  }
  await saveStore();
}

export function logInfo(msg, meta = {}) {
  console.log(JSON.stringify({ level: 'info', msg, ...meta, ts: Date.now() }));
}

export function logWarn(msg, meta = {}) {
  console.warn(JSON.stringify({ level: 'warn', msg, ...meta, ts: Date.now() }));
}

export function logError(msg, meta = {}) {
  console.error(JSON.stringify({ level: 'error', msg, ...meta, ts: Date.now() }));
}

export function requestLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    if (req.path.startsWith('/api/')) {
      logInfo('request', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: Date.now() - start,
      });
    }
  });
  next();
}
