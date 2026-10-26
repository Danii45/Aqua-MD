'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = channel => cb => { ipcRenderer.on(channel, (_e, payload) => cb(payload)); };

contextBridge.exposeInMainWorld('aqua', {
  init: () => ipcRenderer.invoke('init'),
  pick: mode => ipcRenderer.invoke('library:pick', mode === 'folder' ? 'folder' : 'files'),
  importFiles: files => ipcRenderer.invoke('library:import',
    Array.from(files || []).map(f => { try { return webUtils.getPathForFile(f); } catch (e) { return ''; } }).filter(Boolean)),
  removeDisc: id => ipcRenderer.invoke('library:remove', id),
  reportDuration: (id, sec) => ipcRenderer.invoke('library:duration', id, sec),
  onImportProgress: on('library:progress'),

  spotify: (cmd, arg) => ipcRenderer.invoke('spotify:control', cmd, arg),
  onSpotify: on('spotify:state'),
  onSpotifyAccount: on('spotify:account'),
  onSpotifyNotice: on('spotify:notice'),
  spotifySetClientId: id => ipcRenderer.invoke('spotify:setClientId', id),
  spotifyForgetClientId: () => ipcRenderer.invoke('spotify:forgetClientId'),
  spotifyLogin: () => ipcRenderer.invoke('spotify:login'),
  spotifyLogout: () => ipcRenderer.invoke('spotify:logout'),
  spotifyRestart: () => ipcRenderer.invoke('spotify:restartEngine'),
  openDashboard: () => ipcRenderer.invoke('spotify:openDashboard'),
  copy: text => ipcRenderer.invoke('clipboard:write', text),
  lyrics: q => ipcRenderer.invoke('lyrics:find', q),
  sysStats: () => ipcRenderer.invoke('sys:stats'),

  set: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  nextScreen: () => ipcRenderer.invoke('window:next-screen'),
  onDisplay: on('window:display'),
  toggleFullscreen: () => ipcRenderer.invoke('window:fullscreen'),
  setWindowMode: mode => ipcRenderer.invoke('window:mode', mode),
  quit: () => ipcRenderer.invoke('app:quit')
});
