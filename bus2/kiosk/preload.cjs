const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('adKeralaKiosk', { kiosk: true });

window.addEventListener('contextmenu', (e) => e.preventDefault());
