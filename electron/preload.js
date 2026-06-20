const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopFS', {
  pickFolder: () => ipcRenderer.invoke('pickFolder'),
  readFolder: (root) => ipcRenderer.invoke('readFolder', root),
  watch: (root, cb) => {
    ipcRenderer.invoke('watch', root);
    const handler = () => cb();
    ipcRenderer.on('fs-change', handler);
    return () => ipcRenderer.removeListener('fs-change', handler);
  },
});
