'use strict';
// Bridge for the hidden Spotify engine page: token requests, events out, commands in. Nothing else.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aquaEngine', {
  config: () => ipcRenderer.invoke('engine:config'),
  getToken: () => ipcRenderer.invoke('engine:token'),
  emit: (type, payload) => ipcRenderer.send('engine:event', String(type), payload || {}),
  onCommand: cb => ipcRenderer.on('engine:cmd', (_e, msg) => cb(msg))
});
