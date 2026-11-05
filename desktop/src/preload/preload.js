const { contextBridge, ipcRenderer, webUtils } = require('electron');

function subscribe(channel, callback) {
  const listener = (event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('tooplay', {
  platform: process.platform,

  openVideoDialog: () => ipcRenderer.invoke('dialog:open-video'),
  openSubtitleDialog: () => ipcRenderer.invoke('dialog:open-subtitle'),

  openMedia: (filePath) => ipcRenderer.invoke('media:open', filePath),
  stopMedia: () => ipcRenderer.invoke('media:stop'),

  addSubtitle: (filePath) => ipcRenderer.invoke('subtitle:add', filePath),
  selectSubtitle: (trackId) => ipcRenderer.invoke('subtitle:select', trackId),

  startDiscovery: () => ipcRenderer.invoke('cast:start-discovery'),
  stopDiscovery: () => ipcRenderer.invoke('cast:stop-discovery'),
  castConnect: (deviceId, options) => ipcRenderer.invoke('cast:connect', deviceId, options),
  castPlay: () => ipcRenderer.invoke('cast:play'),
  castPause: () => ipcRenderer.invoke('cast:pause'),
  castSeek: (seconds) => ipcRenderer.invoke('cast:seek', seconds),
  castVolume: (level) => ipcRenderer.invoke('cast:volume', level),
  castStop: () => ipcRenderer.invoke('cast:stop'),

  toggleFullscreen: () => ipcRenderer.invoke('window:fullscreen'),
  getInfo: () => ipcRenderer.invoke('app:info'),
  remoteStart: () => ipcRenderer.invoke('remote:start'),
  remoteInfo: () => ipcRenderer.invoke('remote:info'),
  remoteRenew: () => ipcRenderer.invoke('remote:renew'),
  remoteStop: () => ipcRenderer.invoke('remote:stop'),
  reportRemoteState: (value) => ipcRenderer.invoke('remote:state', value),
  replyRemoteCommand: (value) => ipcRenderer.invoke('remote:reply', value),
  onRemoteCommand: (callback) => subscribe('remote:command', callback),
  onRemoteInfo: (callback) => subscribe('remote:info', callback),

  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },

  onMediaStarted: (callback) => subscribe('media:started', callback),
  onMediaReady: (callback) => subscribe('media:ready', callback),
  onMediaStatus: (callback) => subscribe('media:status', callback),
  onMediaDuration: (callback) => subscribe('media:duration', callback),
  onMediaError: (callback) => subscribe('media:error', callback),
  onMediaWarning: (callback) => subscribe('media:warning', callback),
  onMediaStopped: (callback) => subscribe('media:stopped', callback),
  onSubtitleTracks: (callback) => subscribe('subtitle:tracks', callback),

  onCastPreparing: (callback) => subscribe('cast:preparing', callback),
  onCastDevices: (callback) => subscribe('cast:devices', callback),
  onCastStatus: (callback) => subscribe('cast:status', callback),
  onCastError: (callback) => subscribe('cast:error', callback),
  onCastStopped: (callback) => subscribe('cast:stopped', callback),
  onCommand: (callback) => subscribe('command', callback)
});
