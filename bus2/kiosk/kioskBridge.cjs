/** Main-process bridge: cloud sync can trigger kiosk actions (e.g. apply update). */

let commandHandler = null;

function setKioskCommandHandler(handler) {
  commandHandler = typeof handler === 'function' ? handler : null;
}

function dispatchKioskCommand(type, payload = {}) {
  if (!commandHandler) {
    console.warn('AdKerala kiosk: no handler for command', type);
    return false;
  }
  commandHandler(type, payload);
  return true;
}

module.exports = { setKioskCommandHandler, dispatchKioskCommand };
