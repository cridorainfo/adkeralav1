/**
 * Main-process bridge: routes kiosk-command IPC messages from the server child process
 * (fork()'d by kiosk/main.cjs) to whatever handler main.cjs has registered.
 *
 * Used to be a same-process function call (server/cloudSync.js required this file
 * directly and called dispatchKioskCommand()) because the server ran in-process with
 * Electron. Now that the server is a separate child (needed so hot-patched server code
 * can restart independently of the Electron shell — see hotpatchSupervisor.cjs), that
 * in-process call is impossible; the child instead does `process.send({__adkeralaKioskCommand:
 * true, type, payload})` (see server/cloudSync.js's dispatchKioskCommand) and this module
 * listens on the child's end of Node's built-in fork() IPC channel.
 */

let commandHandler = null;

function setKioskCommandHandler(handler) {
  commandHandler = typeof handler === 'function' ? handler : null;
}

/** Call once per forked server child to route its kiosk-command messages to the handler. */
function attachToChild(child) {
  child.on('message', (msg) => {
    if (!msg || msg.__adkeralaKioskCommand !== true) return;
    if (!commandHandler) {
      console.warn('AdKerala kiosk: no handler for command', msg.type);
      return;
    }
    commandHandler(msg.type, msg.payload ?? {});
  });
}

module.exports = { setKioskCommandHandler, attachToChild };
