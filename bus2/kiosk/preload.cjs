const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('adKeralaKiosk', {
  kiosk: true,
  onUpdateStatus(callback) {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('update-status', handler);
    return () => ipcRenderer.removeListener('update-status', handler);
  },
});

window.addEventListener('contextmenu', (e) => e.preventDefault());
