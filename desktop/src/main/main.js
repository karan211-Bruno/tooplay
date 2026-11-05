const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { randomBytes } = require('crypto');
const { probeMedia, canPlayDirect } = require('./media-info');

const { MediaServer } = require('./server');
const { Transcoder, detectEncoder } = require('./transcoder');
const {
  prepareSubtitles,
  preferredTrack,
  parseSubtitleFile,
  writeVTT,
  displayName,
  languageFromFilename
} = require('./subtitles');
const { CastManager } = require('./cast');
const { CastStream } = require('./cast-stream');
const { RemoteServer } = require('./remote-server');
const { ffmpegPath, ffprobePath } = require('./binaries');

const DIRECT_EXTENSIONS = new Set(['mp4', 'm4v', 'mov']);
const VIDEO_EXTENSIONS = new Set([
  'mp4', 'm4v', 'mov', 'mkv', 'avi', 'wmv', 'flv', 'webm', 'ts', 'm2ts',
  'mpg', 'mpeg', 'vob', 'ogv', '3gp'
]);

let mainWindow = null;
let session = null;
const castManager = new CastManager();
let pendingOpenPath = null;
let remoteState = { title: '', hasMedia: false, playing: false, currentTime: 0, duration: 0,
  volume: 1, casting: false, castDevice: null, subtitles: [], selectedSubtitleId: null, devices: [], preparing: false };
const remoteRequests = new Map();
const remoteServer = new RemoteServer({ name: os.hostname(), getState: () => remoteState,
  onChange: info => send('remote:info', info),
  command: command => new Promise((resolve, reject) => {
    if (!mainWindow || mainWindow.isDestroyed()) return reject(new Error('컴퓨터 재생 화면이 닫혀 있습니다.'));
    const id = randomBytes(16).toString('hex');
    const timer = setTimeout(() => { remoteRequests.delete(id); reject(new Error('조작 응답 시간이 초과되었습니다.')); }, 145000);
    remoteRequests.set(id, { resolve, reject, timer });
    send('remote:command', { ...command, id });
  })
});
function stopRemote() {
  remoteServer.stop();
  for (const request of remoteRequests.values()) { clearTimeout(request.timer); request.reject(new Error('휴대폰 연결이 종료되었습니다.')); }
  remoteRequests.clear();
}

function castControl(method, ...args) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('TV 조작 응답 시간이 초과되었습니다.')), 10000);
    castManager[method](...args, error => {
      clearTimeout(timer);
      if (error) { send('cast:error', error.message); reject(error); } else resolve();
    });
  });
}

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// MARK: - Helpers

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function localIPv4() {
  const interfaces = os.networkInterfaces();
  const candidates = [];
  const preferred = ['en0', 'eth0', 'wlan0', 'en1', 'eth1'];

  for (const [name, addresses] of Object.entries(interfaces)) {
    for (const address of addresses || []) {
      if (address.family !== 'IPv4' || address.internal) continue;
      if (address.address.startsWith('169.254.')) continue;
      if (/^(utun|awdl|llw|docker|veth|br-|virbr|tun|tap)/.test(name)) continue;
      candidates.push({ name, address: address.address });
    }
  }

  if (!candidates.length) return null;
  for (const name of preferred) {
    const match = candidates.find((candidate) => candidate.name === name);
    if (match) return match.address;
  }
  return candidates[0].address;
}

function stopSession() {
  const previous = session;
  session = null;
  if (!previous) return;
  previous.abortController.abort();
  if (castManager.client) castManager.stop();
  const cancelled = previous.transcoder ? previous.transcoder.cancel() : Promise.resolve();
  const castCancelled = previous.castStream ? previous.castStream.stop() : Promise.resolve();
  if (previous.server) previous.server.stop();
  Promise.allSettled([cancelled, castCancelled, previous.subtitlesPromise]).then(() => {
    fs.rm(previous.tempDir, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 }, () => {});
  });
}

function serializeTracks(tracks, selectedId) {
  return {
    selectedId: selectedId || null,
    tracks: tracks.map((track) => ({
      id: track.id,
      name: track.name,
      language: track.language,
      origin: track.origin,
      cues: track.cues
    }))
  };
}

async function prepareSubtitleTracks(activeSession) {
  try {
    const tracks = await prepareSubtitles({
      videoPath: activeSession.filePath,
      subsDirectory: activeSession.subsDir,
      ffmpeg: ffmpegPath(),
      ffprobe: ffprobePath(),
      signal: activeSession.abortController.signal
    });

    if (session !== activeSession) return;

    activeSession.subtitles = [...activeSession.subtitles, ...tracks];
    if (!activeSession.subtitleChosen) {
      const preferred = preferredTrack(activeSession.subtitles);
      activeSession.selectedSubtitleId = preferred ? preferred.id : null;
    }

    send('subtitle:tracks', serializeTracks(activeSession.subtitles, activeSession.selectedSubtitleId));

    if (activeSession.castConnected) {
      await applyCastSubtitle(activeSession.selectedSubtitleId);
    }
  } catch (error) {
    if (!activeSession.abortController.signal.aborted) console.error('Subtitle preparation failed:', error);
  }
}

function castSubtitles(activeSession) {
  return activeSession.subtitles.filter((track) => track.vttPath && fs.existsSync(track.vttPath));
}

function castTrackList(activeSession) {
  if (!activeSession.castTracks) {
    activeSession.castTracks = castSubtitles(activeSession).map((track, index) => ({
      id: track.id,
      trackId: index + 1,
      track
    }));
  }
  return activeSession.castTracks;
}

function vttURL(activeSession, track) {
  const prepared = activeSession.castStream && activeSession.castStream.current;
  if (!prepared) return `${activeSession.baseURL}/subs/${path.basename(track.vttPath)}`;
  const file = `${track.id.replace(/[^a-z0-9_-]/gi, '_')}.vtt`;
  const cues = track.cues.filter((cue) => cue.end > prepared.offset).map((cue) => ({
    ...cue, start: Math.max(0, cue.start - prepared.offset), end: cue.end - prepared.offset
  }));
  writeVTT(cues, path.join(prepared.directory, 'subs', file));
  return `${activeSession.baseURL}/cast/${prepared.name}/subs/${file}`;
}

async function connectCast(deviceId, options = {}) {
  const activeSession = session;
  if (!session) throw new Error('영상이 열려 있지 않습니다.');
  const castRequest = ++activeSession.castRequest;
  const checkRequest = () => { if (session !== activeSession || activeSession.castRequest !== castRequest) throw new Error('TV 전송 준비가 취소되었습니다.'); };
  if (!session.mediaReady) throw new Error('영상 준비가 끝난 뒤 전송할 수 있습니다.');

  if (session.subtitlesPromise) {
    await session.subtitlesPromise;
  }
  checkRequest();
  if (session.isLoopbackOnly) throw new Error('TV로 전송하려면 Wi-Fi/LAN에 연결하세요.');

  const device = castManager.getDevice(deviceId);
  if (!device) throw new Error('Chromecast 기기를 찾을 수 없습니다.');

  if (!session.castStream) {
    const castDirectory = path.join(session.tempDir, 'cast');
    session.server.addDirectory(`${session.routePrefix}/cast/`, castDirectory);
    session.castStream = new CastStream({
      ffmpeg: ffmpegPath(), input: session.filePath, directory: castDirectory, duration: session.duration,
      onProgress: () => {},
      onError: (message) => { if (session === activeSession) send('cast:error', message); }
    });
  }
  send('cast:preparing', { message: 'TV용 영상을 준비하는 중…', quality: '720p' });
  const prepared = await session.castStream.prepare(options.currentTime);
  checkRequest();
  const tracks = castSubtitles(session);
  session.castTracks = tracks.map((track, index) => ({ id: track.id, trackId: index + 1, track }));

  const active = session.castTracks.find((entry) => entry.id === session.selectedSubtitleId);
  const contentType = 'application/x-mpegURL';

  const media = {
    contentId: `${session.baseURL}/cast/${prepared.name}/index.m3u8`,
    contentType,
    streamType: 'BUFFERED',
    metadata: {
      type: 0,
      metadataType: 0,
      title: session.title
    },
    tracks: session.castTracks.map((entry) => ({
      trackId: entry.trackId,
      trackContentId: vttURL(session, entry.track),
      trackContentType: 'text/vtt',
      type: 'TEXT',
      subtype: 'SUBTITLES',
      language: entry.track.language || 'und',
      name: entry.track.name
    }))
  };

  if (session.duration > 0) media.duration = Math.max(0, session.duration - prepared.offset);
  if (session.castTracks.length) {
    media.textTrackStyle = {
      fontScale: 1.0,
      foregroundColor: '#FFFFFFFF',
      backgroundColor: '#00000000',
      edgeType: 'OUTLINE',
      edgeColor: '#000000FF'
    };
  }

  session.castOffset = prepared.offset;
  await castManager.connect(device, media, {
    activeTrackIds: active ? [active.trackId] : [],
    currentTime: 0,
    autoplay: options.autoplay !== false
  });
  checkRequest();

  session.castConnected = true;
  session.castDevice = device;
  session.castStream.releaseRetired();

  return {
    device: { id: device.id, name: device.name, model: device.model },
    duration: session.duration,
    currentTime: prepared.offset
  };
}

function applyCastSubtitle(trackId) {
  if (!session || !session.castConnected) return Promise.resolve();

  if (!trackId) {
    return new Promise((resolve, reject) => {
      castManager.setSubtitle([], (error) => error ? reject(error) : resolve());
    });
  }

  const entry = castTrackList(session).find((item) => item.id === trackId);
  const ids = entry ? [entry.trackId] : [];

  return new Promise((resolve, reject) => {
    castManager.setSubtitle(ids, (error) => error ? reject(error) : resolve());
  });
}

function openMedia(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error('파일을 찾을 수 없습니다.');
  }

  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error('영상 파일이 아닙니다.');

  stopSession();

  const extension = path.extname(filePath).slice(1).toLowerCase();
  let direct = DIRECT_EXTENSIONS.has(extension);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tooplay-'));

  const activeSession = {
    filePath,
    abortController: new AbortController(),
    subtitleChosen: false,
    routePrefix: `/${randomBytes(18).toString('hex')}`,
    extension,
    direct,
    tempDir,
    subsDir: path.join(tempDir, 'subs'),
    title: path.basename(filePath),
    duration: 0,
    mediaReady: false,
    mediaUrl: null,
    baseURL: null,
    isLoopbackOnly: false,
    server: new MediaServer(),
    transcoder: null,
    subtitles: [],
    selectedSubtitleId: null,
    castConnected: false,
    castDevice: null,
    castTracks: null,
    castStream: null,
    castRequest: 0,
    castOffset: 0,
    mode: direct ? 'direct' : 'hls'
  };

  fs.mkdirSync(activeSession.subsDir, { recursive: true });
  session = activeSession;

  send('media:started', {
    title: activeSession.title,
    filePath,
    mode: activeSession.mode
  });

  return activeSession.server
    .start()
    .then(async (port) => {
      if (session !== activeSession) return;

      const host = localIPv4() || '127.0.0.1';
      activeSession.isLoopbackOnly = host === '127.0.0.1';
      activeSession.baseURL = `http://${host}:${port}${activeSession.routePrefix}`;
      activeSession.localURL = `http://127.0.0.1:${port}${activeSession.routePrefix}`;
      activeSession.server.addDirectory(`${activeSession.routePrefix}/subs/`, activeSession.subsDir);
      const info = await probeMedia(filePath, ffprobePath(), activeSession.abortController.signal);
      if (session !== activeSession) return;
      direct = canPlayDirect(extension, info);
      activeSession.mode = direct ? 'direct' : 'hls';
      activeSession.direct = direct;
      const duration = Number(info && info.format && info.format.duration);
      activeSession.duration = Number.isFinite(duration) && duration > 0 ? duration : 0;
      send('media:duration', activeSession.duration);
      if (activeSession.isLoopbackOnly) {
        send('media:warning', '네트워크 주소를 찾지 못했습니다. TV 전송에는 Wi-Fi/LAN 연결이 필요합니다.');
      }

      if (direct) {
        const route = `/media.${extension || 'mp4'}`;
        activeSession.server.addFile(`${activeSession.routePrefix}${route}`, filePath);
        activeSession.mediaUrl = `${activeSession.baseURL}${route}`;
        activeSession.mediaReady = true;

        send('media:ready', {
          url: activeSession.mediaUrl.replace(activeSession.baseURL, activeSession.localURL),
          mode: 'direct',
          title: activeSession.title,
          isLoopbackOnly: activeSession.isLoopbackOnly
        });
      } else {
        const ffmpeg = ffmpegPath();
        if (!ffmpeg) {
          const message = 'ffmpeg를 찾을 수 없습니다. 앱을 다시 설치하거나 시스템에 ffmpeg를 설치하세요.';
          send('media:error', message);
          throw new Error(message);
        }

        activeSession.server.addDirectory(`${activeSession.routePrefix}/hls/`, activeSession.tempDir);
        activeSession.mediaUrl = `${activeSession.baseURL}/hls/index.m3u8`;

        const encoder = await detectEncoder(ffmpeg);
        {
          if (session !== activeSession) return;

          send('media:status', {
            phase: 'transcoding',
            progress: 0,
            message: 'TV용 스트림을 준비하는 중…'
          });

          const transcoder = new Transcoder({
            ffmpeg,
            input: filePath,
            outputDirectory: activeSession.tempDir,
            encoder,
            onProgress: (progress) => {
              if (session !== activeSession) return;
              send('media:status', {
                phase: 'transcoding',
                progress,
                availableDuration: transcoder.availableDuration,
                message: `변환 중… ${Math.round(progress * 100)}%`
              });
            },
            onReady: () => {
              if (session !== activeSession) return;
              activeSession.mediaReady = true;
              send('media:ready', {
                url: activeSession.mediaUrl.replace(activeSession.baseURL, activeSession.localURL),
                mode: 'hls',
                title: activeSession.title,
                isLoopbackOnly: activeSession.isLoopbackOnly
              });
            },
            onError: (message) => {
              if (session !== activeSession) return;
              send('media:error', message);
            },
            onFinished: () => {
              if (session !== activeSession) return;
              send('media:status', { phase: 'finishing', progress: 1, availableDuration: activeSession.duration, message: '재생 준비 완료' });
            }
          });

          activeSession.transcoder = transcoder;
          transcoder.setDuration(activeSession.duration);
          transcoder.start();
        }
      }

      activeSession.subtitlesPromise = prepareSubtitleTracks(activeSession);
      return { title: activeSession.title, mode: activeSession.mode };
    }).catch((error) => {
      if (session !== activeSession) return;
      stopSession();
      throw error;
    });
}

// MARK: - Cast events

castManager.on('devices', (devices) => send('cast:devices', devices));
castManager.on('status', (status) => {
  if (!session) return;
  send('cast:status', { ...status, currentTime: status.currentTime + session.castOffset, duration: session.duration || status.duration });
});
castManager.on('error', (message) => send('cast:error', message));
castManager.on('stopped', () => {
  if (session) {
    session.castConnected = false;
    session.castDevice = null;
  }
  send('cast:stopped');
});

// MARK: - Window

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#07070a',
    title: 'Tooplay',
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (pendingOpenPath) {
      openMedia(pendingOpenPath).catch((error) => send('media:error', error.message));
      pendingOpenPath = null;
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    stopRemote();
    stopSession();
    castManager.dispose();
    mainWindow = null;
  });
}

function sendCommand(command) {
  send('command', command);
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [];

  if (isMac) {
    template.push({
      label: 'Tooplay',
      submenu: [
        { role: 'about', label: 'Tooplay 정보' },
        { type: 'separator' },
        { role: 'hide', label: 'Tooplay 가리기' },
        { role: 'hideOthers', label: '다른 앱 가리기' },
        { role: 'unhide', label: '모두 보기' },
        { type: 'separator' },
        { role: 'quit', label: 'Tooplay 종료' }
      ]
    });
  }

  template.push({
    label: '파일',
    submenu: [
      {
        label: '영상 열기…',
        accelerator: 'CmdOrCtrl+O',
        click: () => sendCommand('open-video')
      },
      {
        label: '자막 파일 열기…',
        accelerator: 'CmdOrCtrl+Shift+S',
        click: () => sendCommand('open-subtitle')
      },
      { type: 'separator' },
      isMac ? { role: 'close', label: '윈도우 닫기' } : { role: 'quit', label: '종료' }
    ]
  });

  template.push({
    label: '재생',
    submenu: [
      {
        label: '재생/일시 정지',
        click: () => sendCommand('toggle-play')
      },
      {
        label: '10초 뒤로',
        accelerator: 'CmdOrCtrl+Left',
        click: () => sendCommand('seek-back')
      },
      {
        label: '10초 앞으로',
        accelerator: 'CmdOrCtrl+Right',
        click: () => sendCommand('seek-forward')
      },
      { type: 'separator' },
      {
        label: '자막 끄기',
        accelerator: 'CmdOrCtrl+Shift+C',
        click: () => sendCommand('subtitle-off')
      },
      {
        label: '전체 화면',
        accelerator: isMac ? 'Ctrl+Cmd+F' : 'F11',
        click: () => sendCommand('fullscreen')
      }
    ]
  });

  if (!isMac) {
    template.push({
      label: '도움말',
      submenu: [
        {
          label: 'Tooplay 정보',
          click: () => {
            dialog.showMessageBox({
              type: 'info',
              title: 'Tooplay',
              message: 'Tooplay',
              detail: `영상을 TV로 보내는 데스크톱 플레이어\n버전 ${app.getVersion()}`,
              buttons: ['확인']
            });
          }
        }
      ]
    });
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// MARK: - IPC

ipcMain.handle('remote:start', () => remoteServer.start(localIPv4()));
ipcMain.handle('remote:info', () => remoteServer.info());
ipcMain.handle('remote:renew', () => remoteServer.renewCode());
ipcMain.handle('remote:stop', () => { stopRemote(); return { enabled: false }; });
ipcMain.handle('remote:state', (event, value) => {
  if (event.sender !== mainWindow?.webContents || !value || typeof value !== 'object') return;
  const number = (key, fallback = 0) => Number.isFinite(value[key]) ? value[key] : fallback;
  remoteState = {
    title: String(value.title || '').slice(0, 400), hasMedia: !!value.hasMedia, playing: !!value.playing,
    currentTime: Math.max(0, number('currentTime')), duration: Math.max(0, number('duration')),
    volume: Math.max(0, Math.min(1, number('volume', 1))), casting: !!value.casting,
    castDevice: value.castDevice ? { id: value.castDevice.id, name: value.castDevice.name } : null,
    subtitles: (value.subtitles || []).map(t => ({ id: t.id, name: t.name })),
    selectedSubtitleId: value.selectedSubtitleId || null,
    devices: (value.devices || []).map(d => ({ id: d.id, name: d.name, model: d.model })), preparing: !!value.preparing
  };
});
ipcMain.handle('remote:reply', (event, { id, error }) => {
  if (event.sender !== mainWindow?.webContents) return;
  const pending = remoteRequests.get(id);
  if (!pending) return;
  remoteRequests.delete(id); clearTimeout(pending.timer);
  error ? pending.reject(new Error(String(error))) : pending.resolve();
});

ipcMain.handle('dialog:open-video', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '영상 열기',
    properties: ['openFile'],
    filters: [
      { name: '영상 파일', extensions: Array.from(VIDEO_EXTENSIONS) },
      { name: '모든 파일', extensions: ['*'] }
    ]
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('dialog:open-subtitle', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '자막 열기',
    properties: ['openFile'],
    filters: [
      { name: '자막 파일', extensions: ['srt', 'vtt', 'ass', 'ssa', 'smi', 'sami'] },
      { name: '모든 파일', extensions: ['*'] }
    ]
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('media:open', async (event, filePath) => {
  return openMedia(filePath);
});

ipcMain.handle('media:stop', async () => {
  stopSession();
  send('media:stopped');
});

ipcMain.handle('subtitle:add', async (event, filePath) => {
  if (!session) throw new Error('영상이 열려 있지 않습니다.');
  if (!filePath || !fs.existsSync(filePath)) throw new Error('자막 파일을 찾을 수 없습니다.');

  const activeSession = session;
  if (activeSession.subtitlesPromise) await activeSession.subtitlesPromise;
  if (session !== activeSession) throw new Error('영상이 변경되었습니다.');
  const cues = parseSubtitleFile(filePath);
  if (!cues.length) throw new Error('자막을 읽을 수 없습니다.');

  const language = languageFromFilename(filePath);
  const id = `manual-${Date.now()}`;
  const vttPath = path.join(session.subsDir, `${id}.vtt`);
  writeVTT(cues, vttPath);

  const track = {
    id,
    name: displayName(language, path.basename(filePath, path.extname(filePath))),
    language,
    origin: 'external',
    cues,
    vttPath
  };

  session.subtitles.push(track);
  session.selectedSubtitleId = id;
  session.subtitleChosen = true;
  session.castTracks = null;

  send('subtitle:tracks', serializeTracks(session.subtitles, session.selectedSubtitleId));
  if (session.castConnected) {
    await castManager.reloadTracks(castTrackList(session).map((entry) => ({
      trackId: entry.trackId, trackContentId: vttURL(session, entry.track),
      trackContentType: 'text/vtt', type: 'TEXT', subtype: 'SUBTITLES',
      language: entry.track.language || 'und', name: entry.track.name
    })), castTrackList(session).filter((entry) => entry.id === id).map((entry) => entry.trackId));
  }

  return { id };
});

ipcMain.handle('subtitle:select', async (event, trackId) => {
  if (!session) return null;
  if (trackId && !session.subtitles.some((track) => track.id === trackId)) throw new Error('자막을 찾을 수 없습니다.');
  session.subtitleChosen = true;
  session.selectedSubtitleId = trackId || null;
  session.castTracks = session.castTracks || null;

  if (session.castConnected) {
    await applyCastSubtitle(session.selectedSubtitleId);
  }

  return session.selectedSubtitleId;
});

ipcMain.handle('cast:start-discovery', async () => {
  castManager.startDiscovery();
  return true;
});

ipcMain.handle('cast:stop-discovery', async () => {
  castManager.stopDiscovery();
  return true;
});

ipcMain.handle('cast:connect', async (event, deviceId, options) => {
  return connectCast(deviceId, options);
});

ipcMain.handle('cast:play', async () => {
  return castControl('play');
});

ipcMain.handle('cast:pause', async () => {
  return castControl('pause');
});

ipcMain.handle('cast:seek', async (event, seconds) => {
  const current = session;
  if (!current || !current.castConnected) return;
  const target = Math.min(Math.max(0, Number(seconds) || 0), current.duration || Infinity);
  if (!current.castStream.canSeek(target)) {
    return connectCast(current.castDevice.id, {
      currentTime: target,
      autoplay: !castManager.lastStatus || castManager.lastStatus.playerState !== 'PAUSED'
    });
  }
  return new Promise((resolve, reject) => castManager.seek(target - current.castOffset, (error) => error ? reject(error) : resolve()));
});

ipcMain.handle('cast:volume', async (event, level) => {
  return castControl('setVolume', level);
});

ipcMain.handle('cast:stop', async () => {
  if (session) ++session.castRequest;
  if (session && session.castStream) await session.castStream.stop();
  castManager.stop();
  if (session) {
    session.castConnected = false;
    session.castDevice = null;
  }
});

ipcMain.handle('window:fullscreen', async () => {
  if (!mainWindow) return false;
  mainWindow.setFullScreen(!mainWindow.isFullScreen());
  return mainWindow.isFullScreen();
});

ipcMain.handle('app:info', async () => ({
  platform: process.platform,
  version: app.getVersion()
}));

// MARK: - App lifecycle

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (event, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    const candidate = argv.find((argument) => {
      if (!argument || argument.startsWith('-')) return false;
      const extension = path.extname(argument).slice(1).toLowerCase();
      return VIDEO_EXTENSIONS.has(extension) && fs.existsSync(argument);
    });
    if (candidate) {
      openMedia(candidate).catch((error) => send('media:error', error.message));
    }
  });

  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    if (app.isReady() && mainWindow) {
      openMedia(filePath).catch((error) => send('media:error', error.message));
    } else {
      pendingOpenPath = filePath;
    }
  });

  app.whenReady().then(() => {
    buildMenu();
    createWindow();

    const candidate = process.argv.slice(1).find((argument) => {
      if (!argument || argument.startsWith('-')) return false;
      const extension = path.extname(argument).slice(1).toLowerCase();
      return VIDEO_EXTENSIONS.has(extension) && fs.existsSync(argument);
    });
    if (candidate) pendingOpenPath = candidate;

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    stopRemote();
    stopSession();
    castManager.dispose();
  });
}
