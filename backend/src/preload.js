const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onBeforeClose: (callback) => ipcRenderer.on('app-before-close', callback),
  confirmClose: () => ipcRenderer.send('close-confirmed'),
  preventClose: () => ipcRenderer.send('close-prevented'),
  setConnected: (connected) => ipcRenderer.send('device-connected', connected),
  platform: process.platform,
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  isPackaged: () => ipcRenderer.invoke('app:isPackaged'),
  getApiKey: () => ipcRenderer.invoke('secrets:getApiKey'),
  setApiKey: (key) => ipcRenderer.invoke('secrets:setApiKey', key),
  getGithubToken: () => ipcRenderer.invoke('secrets:getGithubToken'),
  setGithubToken: (token) => ipcRenderer.invoke('secrets:setGithubToken', token),
  exportLog: (content) => ipcRenderer.invoke('diagnostics:exportLog', content),
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  hasUpdateToken: () => ipcRenderer.invoke('updater:hasToken'),
  onUpdateStatus: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('update-status', handler);
    return () => ipcRenderer.removeListener('update-status', handler);
  },
});
