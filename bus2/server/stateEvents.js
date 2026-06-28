import { EventEmitter } from 'events';

const emitter = new EventEmitter();
emitter.setMaxListeners(200);

/** Notify open display/control tabs that db/info.txt changed (cloud push, driver save, etc.). */
export function notifyStateChanged(root, detail = {}) {
  emitter.emit('change', {
    root,
    savedAt: detail.savedAt ?? 0,
    lastCloudPushAt: detail.lastCloudPushAt ?? 0,
    source: detail.source ?? 'write',
    at: Date.now(),
  });
}

export function subscribeStateChanged(root, listener) {
  const handler = (payload) => {
    if (payload.root === root) listener(payload);
  };
  emitter.on('change', handler);
  return () => emitter.off('change', handler);
}
