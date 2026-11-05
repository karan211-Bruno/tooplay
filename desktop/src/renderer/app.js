(() => {
  'use strict';

  const api = window.tooplay;
  const $ = (id) => document.getElementById(id);

  const VIDEO_RE = /\.(mp4|m4v|mov|mkv|avi|wmv|flv|webm|ts|m2ts|mpg|mpeg|vob|ogv|3gp)$/i;
  const SUBTITLE_RE = /\.(srt|vtt|ass|ssa|smi|sami)$/i;

  const els = {
    stage: $('stage'),
    video: $('video'),
    subtitleLayer: $('subtitleLayer'),
    emptyState: $('emptyState'),
    dropzone: $('dropzone'),
    preparing: $('preparing'),
    prepTitle: $('prepTitle'),
    prepMessage: $('prepMessage'),
    prepBar: $('prepBar'),
    cancelPrep: $('cancelPrep'),
    errorState: $('errorState'),
    errorMessage: $('errorMessage'),
    retryBtn: $('retryBtn'),
    errorOpen: $('errorOpen'),
    castBadge: $('castBadge'),
    castBadgeText: $('castBadgeText'),
    castBadgeStop: $('castBadgeStop'),
    toast: $('toast'),
    controls: $('controls'),
    playBtn: $('playBtn'),
    currentTime: $('currentTime'),
    seek: $('seek'),
    duration: $('duration'),
    muteBtn: $('muteBtn'),
    volume: $('volume'),
    subtitleBtn: $('subtitleBtn'),
    castBtn: $('castBtn'),
    fullscreenBtn: $('fullscreenBtn'),
    subtitleMenu: $('subtitleMenu'),
    castMenu: $('castMenu'),
    fileTitle: $('fileTitle'),
    platformNote: $('platformNote'),
    openBtn: $('openBtn'),
    emptyOpen: $('emptyOpen')
  };

  const state = {
    platform: 'darwin',
    title: '',
    filePath: null,
    mode: null,
    mediaReady: false,
    duration: 0,
    availableDuration: 0,
    conversionFinished: false,
    tracks: [],
    selectedSubtitleId: null,
    cues: [],
    cueKey: '',
    hls: null,
    seeking: false,
    pendingSeek: null,
    volume: 1,
    muted: false,
    menu: null,
    discoveryStarted: false,
    idleTimer: null,
    toastTimer: null,
    dragDepth: 0,
    cast: {
      connecting: false,
      connected: false,
      device: null,
      playerState: 'IDLE',
      currentTime: 0,
      duration: 0,
      volume: 1,
      lastMenuState: ''
    }
  };

  // ---------------------------------------------------------------- helpers

  function icon(id) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', id);
    svg.appendChild(use);
    return svg;
  }

  function setButtonIcon(button, id) {
    const use = button.querySelector('use');
    if (use) use.setAttribute('href', id);
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (typeof text === 'string') node.textContent = text;
    return node;
  }

  function formatTime(seconds) {
    const value = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
    const total = Math.floor(value);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${minutes}:${String(secs).padStart(2, '0')}`;
  }

  function cleanError(error) {
    const raw = error && error.message ? error.message : String(error || '');
    return raw
      .replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
      .trim();
  }

  function toast(message, type) {
    if (!message) return;
    els.toast.textContent = message;
    els.toast.classList.toggle('error', type === 'error');
    els.toast.classList.remove('hidden');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => {
      els.toast.classList.add('hidden');
    }, 3600);
  }

  function isCasting() {
    return state.cast.connected;
  }

  function isPreparing() {
    return !els.preparing.classList.contains('hidden');
  }

  function isPlaying() {
    if (isCasting()) return state.cast.playerState === 'PLAYING';
    return !els.video.paused && !els.video.ended;
  }

  // ------------------------------------------------------------- popovers

  function closeMenus() {
    els.subtitleMenu.classList.add('hidden');
    els.castMenu.classList.add('hidden');
    state.menu = null;
  }

  function showPopover(menu, anchor) {
    menu.classList.remove('hidden');
    menu.style.left = '-9999px';
    menu.style.top = '-9999px';

    const rect = anchor.getBoundingClientRect();
    const width = menu.offsetWidth || 300;
    const height = menu.offsetHeight || 240;

    let left = rect.left + rect.width / 2 - width / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - width - 12));

    let top = rect.top - height - 12;
    if (top < 72) {
      top = Math.min(rect.bottom + 12, window.innerHeight - height - 12);
    }

    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(Math.max(12, top))}px`;
  }

  function toggleMenu(name, anchor) {
    if (state.menu === name) {
      closeMenus();
      return;
    }

    closeMenus();
    state.menu = name;

    if (name === 'subtitle') {
      renderSubtitleMenu();
      showPopover(els.subtitleMenu, anchor);
    } else {
      renderCastMenu();
      showPopover(els.castMenu, anchor);
      startDiscovery();
    }
  }

  // ------------------------------------------------------------ subtitle UI

  function renderSubtitleMenu() {
    const menu = els.subtitleMenu;
    menu.textContent = '';

    const header = element('div', 'popover-header');
    header.appendChild(element('span', 'popover-title', '자막'));
    const count = element('span', 'popover-title', `${state.tracks.length}개`);
    header.appendChild(count);
    menu.appendChild(header);

    const off = element('button', 'menu-item');
    off.type = 'button';
    if (!state.selectedSubtitleId) off.classList.add('selected');
    off.appendChild(element('span', 'check')).appendChild(icon('#i-check'));
    const offLabels = element('span', 'labels');
    offLabels.appendChild(element('span', 'label', '자막 끄기'));
    off.appendChild(offLabels);
    off.appendChild(element('span', 'trailing', 'OFF'));
    off.addEventListener('click', () => selectSubtitle(null));
    menu.appendChild(off);

    menu.appendChild(element('div', 'menu-divider'));

    if (!state.tracks.length) {
      menu.appendChild(
        element(
          'div',
          'menu-note',
          '사용 가능한 자막이 없습니다. 영상과 같은 이름의 SRT · VTT · ASS 파일을 같은 폴더에 두면 자동으로 불러옵니다.'
        )
      );
    } else {
      for (const track of state.tracks) {
        const item = element('button', 'menu-item');
        item.type = 'button';
        if (track.id === state.selectedSubtitleId) item.classList.add('selected');
        item.appendChild(element('span', 'check')).appendChild(icon('#i-check'));

        const labels = element('span', 'labels');
        labels.appendChild(element('span', 'label', track.name || '자막'));
        const origin = track.origin === 'embedded' ? '내장 자막' : '외부 자막';
        const language = track.language ? ` · ${track.language.toUpperCase()}` : '';
        labels.appendChild(element('span', 'sub', `${origin}${language}`));
        item.appendChild(labels);

        item.addEventListener('click', () => selectSubtitle(track.id));
        menu.appendChild(item);
      }
    }

    const footer = element('div', 'menu-footer');
    const openButton = element('button', 'button ghost');
    openButton.type = 'button';
    openButton.appendChild(icon('#i-folder'));
    openButton.appendChild(element('span', '', '자막 파일 열기…'));
    openButton.addEventListener('click', () => {
      closeMenus();
      chooseSubtitle();
    });
    footer.appendChild(openButton);
    menu.appendChild(footer);

    if (state.menu === 'subtitle') {
      showPopover(menu, els.subtitleBtn);
    }
  }

  function applyTracks(payload) {
    state.tracks = Array.isArray(payload && payload.tracks) ? payload.tracks : [];
    state.selectedSubtitleId = (payload && payload.selectedId) || null;
    syncCues();
    renderCue(true);
    els.subtitleBtn.classList.toggle('accent', Boolean(state.selectedSubtitleId));

    if (state.menu === 'subtitle') {
      renderSubtitleMenu();
      showPopover(els.subtitleMenu, els.subtitleBtn);
    }
  }

  function syncCues() {
    const track = state.tracks.find((item) => item.id === state.selectedSubtitleId);
    state.cues = track && Array.isArray(track.cues) ? track.cues : [];
    state.cueKey = '';
  }

  function activeCue(time) {
    const cues = state.cues;
    let low = 0;
    let high = cues.length - 1;

    while (low <= high) {
      const middle = (low + high) >> 1;
      const cue = cues[middle];
      if (time < cue.start) {
        high = middle - 1;
      } else if (time >= cue.end) {
        low = middle + 1;
      } else {
        return cue;
      }
    }

    return null;
  }

  function renderCue(force) {
    if (isCasting()) {
      if (els.subtitleLayer.childElementCount) els.subtitleLayer.textContent = '';
      return;
    }

    const time = els.video.currentTime || 0;
    const cue = activeCue(time);
    const key = cue ? `${cue.start}|${cue.end}|${cue.text}` : '';

    if (!force && key === state.cueKey) return;
    state.cueKey = key;

    els.subtitleLayer.textContent = '';
    if (cue) {
      els.subtitleLayer.appendChild(element('div', 'cue', cue.text));
    }
  }

  async function selectSubtitle(trackId) {
    closeMenus();

    if (!state.mediaReady && !isCasting()) {
      toast('영상을 먼저 열어 주세요.', 'error');
      return;
    }

    state.selectedSubtitleId = trackId || null;
    syncCues();
    renderCue(true);
    els.subtitleBtn.classList.toggle('accent', Boolean(trackId));

    try {
      await api.selectSubtitle(trackId || null);
    } catch (error) {
      toast(cleanError(error), 'error');
    }
  }

  async function chooseSubtitle() {
    if (!state.mediaReady && !isCasting()) {
      toast('영상을 먼저 열어 주세요.', 'error');
      return;
    }

    const filePath = await api.openSubtitleDialog().catch(() => null);
    if (!filePath) return;
    await addSubtitlePath(filePath);
  }

  async function addSubtitlePath(filePath) {
    try {
      await api.addSubtitle(filePath);
      toast('자막을 불러왔습니다.');
    } catch (error) {
      toast(cleanError(error), 'error');
    }
  }

  // ---------------------------------------------------------------- cast UI

  function startDiscovery() {
    if (state.discoveryStarted) return;
    state.discoveryStarted = true;
    api.startDiscovery().catch(() => {});
  }

  function castStateLabel() {
    switch (state.cast.playerState) {
      case 'PLAYING':
        return '재생 중';
      case 'PAUSED':
        return '일시정지';
      case 'BUFFERING':
        return '버퍼링 중';
      default:
        return '연결됨';
    }
  }

  function renderCastMenu() {
    const menu = els.castMenu;
    menu.textContent = '';

    const header = element('div', 'popover-header');
    header.appendChild(element('span', 'popover-title', 'TV로 전송'));

    const refresh = element('button', 'popover-action');
    refresh.type = 'button';
    refresh.title = '다시 검색';
    refresh.appendChild(icon('#i-refresh'));
    refresh.addEventListener('click', () => {
      state.discoveryStarted = false;
      startDiscovery();
      renderCastMenu();
      showPopover(menu, els.castBtn);
    });
    header.appendChild(refresh);
    menu.appendChild(header);

    const devices = state.cast.devices || [];

    if (state.cast.connected) {
      const card = element('div', 'menu-status');
      card.appendChild(element('span', 'pulse'));
      const labels = element('div', 'labels');
      labels.appendChild(
        element('div', 'label', (state.cast.device && state.cast.device.name) || 'TV')
      );
      labels.appendChild(element('div', 'sub', castStateLabel()));
      card.appendChild(labels);
      menu.appendChild(card);

      const stopButton = element('button', 'menu-item');
      stopButton.type = 'button';
      stopButton.appendChild(element('span', 'check'));
      const stopLabels = element('span', 'labels');
      stopLabels.appendChild(element('span', 'label', '전송 중지'));
      stopButton.appendChild(stopLabels);
      stopButton.addEventListener('click', () => {
        closeMenus();
        api.castStop().catch(() => {});
      });
      menu.appendChild(stopButton);
    } else if (state.cast.connecting) {
      const card = element('div', 'menu-status');
      card.appendChild(element('span', 'mini-spinner'));
      const labels = element('div', 'labels');
      labels.appendChild(
        element('div', 'label', (state.cast.device && state.cast.device.name) || 'TV')
      );
      labels.appendChild(element('div', 'sub', 'TV용 영상을 준비하는 중…'));
      card.appendChild(labels);
      menu.appendChild(card);
      const cancel = element('button', 'menu-item');
      cancel.type = 'button';
      cancel.appendChild(element('span', 'label', '전송 준비 취소'));
      cancel.addEventListener('click', () => stopCasting(true));
      menu.appendChild(cancel);
    } else if (!devices.length) {
      const note = element('div', 'menu-note');
      const row = element('div', 'menu-status');
      row.style.border = '0';
      row.style.background = 'transparent';
      row.style.padding = '6px 4px';
      row.appendChild(element('span', 'mini-spinner'));
      const labels = element('div', 'labels');
      labels.appendChild(element('div', 'label', '기기를 찾는 중…'));
      labels.appendChild(element('div', 'sub', 'Chromecast · Google TV'));
      row.appendChild(labels);
      note.appendChild(row);
      note.appendChild(
        document.createTextNode('같은 Wi‑Fi에 연결된 기기만 표시됩니다. 잠시 기다려도 나타나지 않으면 새로 고침을 눌러 주세요.')
      );
      menu.appendChild(note);
    } else {
      for (const device of devices) {
        const item = element('button', 'menu-item');
        item.type = 'button';
        item.appendChild(element('span', 'check'));
        const labels = element('span', 'labels');
        labels.appendChild(element('span', 'label', device.name || 'Chromecast'));
        const model = device.model && device.model !== 'Chromecast' ? device.model : 'Chromecast';
        labels.appendChild(element('span', 'sub', model));
        item.appendChild(labels);
        item.addEventListener('click', () => connectCast(device));
        menu.appendChild(item);
      }
    }

    const footer = element('div', 'menu-footer');
    const note = element(
      'div',
      'menu-note',
      state.platform === 'darwin'
        ? 'AirPlay(Apple TV)는 Tooplay for Mac 앱에서 사용할 수 있습니다.'
        : 'Chromecast가 내장된 Google TV · 스피커로 전송할 수 있습니다.'
    );
    note.appendChild(document.createElement('br'));
    note.appendChild(document.createTextNode('TV 전송 · 안정적인 720p / 최대 30fps'));
    note.style.padding = '8px 8px 4px';
    footer.appendChild(note);
    menu.appendChild(footer);
  }

  async function connectCast(device, propagateError = false) {
    if (state.cast.connecting) {
      if (propagateError) throw new Error('TV 연결을 준비 중입니다.');
      return;
    }

    if (!state.mediaReady) {
      toast('영상 준비가 끝난 뒤 전송할 수 있습니다.', 'error');
      if (propagateError) throw new Error('영상 준비가 끝난 뒤 전송할 수 있습니다.');
      return;
    }

    state.cast.connecting = true;
    state.cast.device = device;
    state.cast.lastMenuState = '';
    renderCastMenu();
    showPopover(els.castMenu, els.castBtn);

    const openedPath = state.filePath;
    const startTime = els.video.currentTime || 0;
    const autoplay = !els.video.paused;
    els.video.pause();
    try {
      const result = await api.castConnect(device.id, { currentTime: startTime, autoplay });
      if (state.filePath !== openedPath) return;
      state.cast.connecting = false;
      state.cast.connected = true;
      state.cast.device = (result && result.device) || device;
      state.cast.playerState = autoplay ? 'BUFFERING' : 'PAUSED';
      state.cast.currentTime = Number.isFinite(result && result.currentTime) ? result.currentTime : startTime;
      state.cast.duration = (result && result.duration) || state.duration;

      els.video.pause();
      closeMenus();
      updateCastUI();
      updateTransport();
      toast(`전송을 시작했습니다 · ${state.cast.device.name}`);
    } catch (error) {
      if (state.filePath !== openedPath) return;
      state.cast.connecting = false;
      state.cast.connected = false;
      state.cast.device = null;
      if (autoplay) attemptPlay();
      toast(cleanError(error), 'error');
      if (state.menu === 'cast') {
        renderCastMenu();
        showPopover(els.castMenu, els.castBtn);
      }
      if (propagateError) throw error;
    }
  }

  function updateCastUI() {
    const connected = state.cast.connected;

    els.castBadge.classList.toggle('hidden', !connected);
    els.castBtn.classList.toggle('accent', connected);
    els.subtitleLayer.classList.toggle('hidden', connected);

    if (connected) {
      const name = (state.cast.device && state.cast.device.name) || 'TV';
      els.castBadgeText.textContent = `${name} · ${castStateLabel()}`;
    } else {
      els.castBadgeText.textContent = 'TV로 전송 중';
    }

    if (state.menu === 'cast') {
      const menuState = `${connected}|${state.cast.connecting}|${state.cast.playerState}`;
      if (menuState !== state.cast.lastMenuState) {
        state.cast.lastMenuState = menuState;
        renderCastMenu();
        showPopover(els.castMenu, els.castBtn);
      }
    }
  }

  function stopCasting(fromButton) {
    api.castStop().catch(() => {});
    if (fromButton) closeMenus();
  }

  // -------------------------------------------------------------- transport

  function currentDuration() {
    if (isCasting()) {
      return state.cast.duration || state.duration || 0;
    }
    if (state.duration > 0) return state.duration;
    return Number.isFinite(els.video.duration) ? els.video.duration : 0;
  }

  function currentPosition() {
    return isCasting() ? state.cast.currentTime : els.video.currentTime || 0;
  }

  function updateTransport() {
    const duration = currentDuration();
    const position = currentPosition();

    if (!state.seeking) {
      els.currentTime.textContent = formatTime(position);
      const max = duration > 0 ? duration : 1;
      els.seek.max = String(max);
      els.seek.value = String(Math.min(Math.max(0, position), max));
      const percent = duration > 0 ? (position / duration) * 100 : 0;
      els.seek.style.setProperty('--fill', `${Math.max(0, Math.min(100, percent))}%`);
    }

    els.duration.textContent = formatTime(duration);
    syncPlayButton();
    syncVolumeUI();
  }

  function syncPlayButton() {
    setButtonIcon(els.playBtn, isPlaying() ? '#i-pause' : '#i-play');
    els.playBtn.title = isPlaying() ? '일시 정지 (Space)' : '재생 (Space)';
  }

  function syncVolumeUI() {
    let volume;
    let muted;

    if (isCasting()) {
      volume = state.cast.volume;
      muted = volume <= 0;
    } else {
      volume = state.volume;
      muted = state.muted || volume <= 0;
    }

    els.volume.value = String(muted ? 0 : volume);
    els.volume.style.setProperty('--fill', `${Math.round((muted ? 0 : volume) * 100)}%`);
    setButtonIcon(els.muteBtn, muted ? '#i-mute' : '#i-volume');
    els.muteBtn.classList.toggle('accent', muted);
  }

  function togglePlay() {
    if (isCasting()) {
      if (state.cast.playerState === 'PLAYING') {
        api.castPause().catch(() => {});
      } else {
        api.castPlay().catch(() => {});
      }
      return;
    }

    if (!state.mediaReady) {
      if (!isPreparing()) toast('영상을 먼저 열어 주세요.', 'error');
      return;
    }

    if (els.video.paused) {
      const promise = els.video.play();
      if (promise && promise.catch) promise.catch(() => {});
    } else {
      els.video.pause();
    }
  }

  function applyPendingSeek() {
    if (state.pendingSeek === null) return;
    const ranges = els.video.seekable;
    const end = ranges.length ? ranges.end(ranges.length - 1) : 0;
    if (state.pendingSeek > end) return;
    const target = state.pendingSeek;
    state.pendingSeek = null;
    els.video.currentTime = target;
    updateTransport();
    renderCue(true);
  }

  function seekTo(seconds) {
    if (!state.mediaReady && !isCasting()) return;

    const duration = currentDuration();
    let target = Math.max(0, Number(seconds) || 0);
    if (duration > 0) target = Math.min(target, duration);
    target = Math.round(target * 1000) / 1000;
    state.pendingSeek = null;

    if (!isCasting() && state.mode === 'hls' && !state.conversionFinished && target > state.availableDuration) {
      target = Math.max(0, state.availableDuration - 0.5);
      toast('아직 변환 중인 구간입니다. 변환이 끝난 구간까지 이동합니다.');
    }

    if (isCasting()) {
      state.cast.currentTime = target;
      updateTransport();
      api.castSeek(target).catch((error) => toast(cleanError(error), 'error'));
      return;
    }

    const ranges = els.video.seekable;
    if (state.hls && (!ranges.length || target > ranges.end(ranges.length - 1))) {
      state.pendingSeek = target;
      toast('선택한 구간을 불러오는 중…');
      return;
    }
    if (state.mode === 'direct' && Number.isFinite(els.video.duration) && els.video.duration > 0) {
      target = Math.min(target, els.video.duration);
    }
    els.video.currentTime = target;
    updateTransport();
    renderCue(true);
  }

  function seekBy(delta) {
    seekTo(currentPosition() + delta);
  }

  function toggleMute() {
    if (isCasting()) {
      const next = state.cast.volume > 0 ? 0 : 1;
      state.cast.volume = next;
      api.castVolume(next).catch(() => {});
      syncVolumeUI();
      return;
    }

    els.video.muted = !els.video.muted;
    state.muted = els.video.muted;
    if (!els.video.muted && els.video.volume === 0) {
      els.video.volume = 1;
    }
    syncVolumeUI();
  }

  function setVolume(value) {
    const level = Math.max(0, Math.min(1, Number(value) || 0));

    if (isCasting()) {
      state.cast.volume = level;
      syncVolumeUI();
      api.castVolume(level).catch(() => {});
      return;
    }

    state.volume = level;
    state.muted = level === 0;
    els.video.volume = level;
    els.video.muted = level === 0;
    syncVolumeUI();
  }

  // ----------------------------------------------------------------- player

  function destroyPlayer() {
    state.pendingSeek = null;
    if (state.hls) {
      try {
        state.hls.destroy();
      } catch {
        // ignore
      }
      state.hls = null;
    }
    try {
      els.video.pause();
    } catch {
      // ignore
    }
    els.video.removeAttribute('src');
    try {
      els.video.load();
    } catch {
      // ignore
    }
  }

  function attemptPlay() {
    const promise = els.video.play();
    if (promise && typeof promise.catch === 'function') promise.catch(() => {});
  }

  function startDirect(url) {
    destroyPlayer();
    els.video.src = url;
    els.video.load();
    attemptPlay();
  }

  function startHls(url) {
    destroyPlayer();

    if (window.Hls && window.Hls.isSupported()) {
      const hls = new window.Hls({
        startPosition: 0,
        liveDurationInfinity: true,
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 90,
        maxBufferLength: 30
      });
      state.hls = hls;

      let recoveries = 0;
      hls.attachMedia(els.video);
      hls.on(window.Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(url));
      hls.on(window.Hls.Events.MANIFEST_PARSED, () => attemptPlay());
      hls.on(window.Hls.Events.LEVEL_UPDATED, () => {
        setTimeout(() => { if (state.hls === hls) applyPendingSeek(); }, 0);
      });
      hls.on(window.Hls.Events.ERROR, (event, data) => {
        if (!data || !data.fatal || state.hls !== hls) return;
        if (++recoveries > 3) { showError('스트림을 복구할 수 없습니다. 다시 시도해 주세요.'); return; }

        if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
          if (!state.mediaReady) return;
          toast('스트림 연결이 끊겨 다시 시도합니다.', 'error');
          hls.startLoad();
          return;
        }

        if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
          return;
        }

        showError(`재생 오류가 발생했습니다.\n${data.details || data.type || ''}`);
      });
      return;
    }

    if (els.video.canPlayType('application/vnd.apple.mpegurl')) {
      els.video.src = url;
      attemptPlay();
      return;
    }

    showError('이 환경에서는 HLS 재생을 지원하지 않습니다.');
  }

  // ------------------------------------------------------------- view state

  function showPreparing(title, message, progress) {
    els.prepTitle.textContent = title || '재생을 준비하는 중';
    els.prepMessage.textContent = message || '';
    els.prepBar.style.width = `${Math.max(0, Math.min(1, progress || 0)) * 100}%`;
    els.preparing.classList.remove('hidden');
    els.errorState.classList.add('hidden');
    els.controls.classList.add('hidden');
  }

  function hidePreparing() {
    els.preparing.classList.add('hidden');
  }

  function showError(message) {
    destroyPlayer();
    state.mediaReady = false;
    hidePreparing();
    els.errorMessage.textContent = message || '알 수 없는 오류가 발생했습니다.';
    els.errorState.classList.remove('hidden');
    els.controls.classList.add('hidden');
    els.subtitleLayer.textContent = '';
  }

  function showControls() {
    els.controls.classList.remove('hidden');
  }

  function resetToEmpty() {
    destroyPlayer();
    state.title = '';
    state.filePath = null;
    state.mode = null;
    state.mediaReady = false;
    state.duration = 0;
    state.availableDuration = 0;
    state.conversionFinished = false;
    state.cast.connecting = false;
    state.cast.connected = false;
    state.cast.device = null;
    updateCastUI();
    state.tracks = [];
    state.selectedSubtitleId = null;
    state.cues = [];
    state.cueKey = '';
    state.seeking = false;
    state.hls = null;

    els.stage.classList.remove('has-media');
    els.emptyState.classList.remove('hidden');
    els.errorState.classList.add('hidden');
    hidePreparing();
    els.controls.classList.add('hidden');
    els.subtitleLayer.textContent = '';
    els.fileTitle.textContent = '영상을 열어 주세요';
    els.fileTitle.removeAttribute('title');
    els.subtitleBtn.classList.remove('accent');
    els.seek.value = '0';
    els.seek.style.setProperty('--fill', '0%');
    els.currentTime.textContent = '0:00';
    els.duration.textContent = '0:00';
    closeMenus();
    wake();
  }

  function wake() {
    els.stage.classList.remove('idle');
    clearTimeout(state.idleTimer);

    if (!isPlaying()) return;
    state.idleTimer = setTimeout(() => {
      if (state.menu || !isPlaying()) return;
      els.stage.classList.add('idle');
    }, 2600);
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
      return;
    }

    const promise = els.stage.requestFullscreen();
    if (promise && typeof promise.catch === 'function') {
      promise.catch(() => {
        api.toggleFullscreen().catch(() => {});
      });
    }
  }

  // ------------------------------------------------------------------ open

  async function chooseVideo() {
    const filePath = await api.openVideoDialog().catch(() => null);
    if (filePath) await openPath(filePath);
  }

  async function openPath(filePath) {
    if (!filePath) return;

    closeMenus();
    els.errorState.classList.add('hidden');
    els.emptyState.classList.add('hidden');
    els.stage.classList.add('has-media');
    els.fileTitle.textContent = filePath.split(/[\\/]/).pop() || filePath;
    els.fileTitle.title = filePath;
    showPreparing('영상을 여는 중', '재생을 준비하는 중…', 0);

    try {
      await api.openMedia(filePath);
    } catch (error) {
      showError(cleanError(error));
    }
  }

  async function retry() {
    if (state.filePath) {
      await openPath(state.filePath);
    } else {
      await chooseVideo();
    }
  }

  // ------------------------------------------------------------------- IPC

  function bindIpc() {
    api.onMediaStarted((payload) => {
      destroyPlayer();
      state.title = (payload && payload.title) || '';
      state.filePath = (payload && payload.filePath) || null;
      state.mode = (payload && payload.mode) || null;
      state.mediaReady = false;
      state.duration = 0;
      state.availableDuration = 0;
      state.conversionFinished = false;
      state.cast.connecting = false;
      state.cast.connected = false;
      state.cast.device = null;
      updateCastUI();
      state.tracks = [];
      state.selectedSubtitleId = null;
      state.cues = [];
      state.cueKey = '';

      els.stage.classList.add('has-media');
      els.emptyState.classList.add('hidden');
      els.errorState.classList.add('hidden');
      els.controls.classList.add('hidden');
      els.subtitleLayer.textContent = '';
      els.fileTitle.textContent = state.title;
      if (state.filePath) els.fileTitle.title = state.filePath;
      els.subtitleBtn.classList.remove('accent');
      els.currentTime.textContent = '0:00';
      els.duration.textContent = '0:00';
      els.seek.value = '0';
      els.seek.style.setProperty('--fill', '0%');

      showPreparing(
        '재생을 준비하는 중',
        state.mode === 'hls' ? 'TV용 스트림을 준비하는 중…' : '영상을 불러오는 중…',
        0
      );
    });

    api.onMediaStatus((status) => {
      if (status && Number.isFinite(status.availableDuration)) state.availableDuration = status.availableDuration;
      if (status && status.phase === 'finishing') state.conversionFinished = true;
      if (!status || state.mediaReady) return;
      if (status.phase === 'transcoding') {
        const progress = Number(status.progress) || 0;
        els.prepBar.style.width = `${progress * 100}%`;
        els.prepMessage.textContent = status.message || `변환 중… ${Math.round(progress * 100)}%`;
      } else if (status.phase === 'finishing') {
        els.prepBar.style.width = '100%';
        els.prepMessage.textContent = status.message || '재생 준비 완료';
      }
    });

    api.onMediaReady((payload) => {
      state.mediaReady = true;
      state.mode = payload.mode;
      hidePreparing();
      showControls();
      els.stage.classList.add('has-media');
      els.emptyState.classList.add('hidden');
      els.errorState.classList.add('hidden');

      if (payload && payload.mode === 'direct') {
        startDirect(payload.url);
      } else {
        startHls(payload.url);
      }

      if (payload && payload.isLoopbackOnly) {
        toast('네트워크 주소를 찾지 못했습니다. TV 전송에는 Wi‑Fi 연결이 필요합니다.', 'error');
      }

      updateTransport();
      wake();
    });

    api.onMediaDuration((duration) => {
      if (!Number.isFinite(duration) || duration <= 0) return;
      state.duration = duration;
      updateTransport();
      renderCue(true);
    });

    api.onMediaError((message) => {
      showError(message);
    });

    api.onMediaWarning((message) => {
      toast(message, 'error');
    });

    api.onMediaStopped(() => {
      resetToEmpty();
    });

    api.onSubtitleTracks((payload) => {
      applyTracks(payload);
    });

    api.onCastPreparing((payload) => {
      toast((payload && payload.message) || 'TV용 영상을 준비하는 중…');
    });

    api.onCastDevices((devices) => {
      state.cast.devices = Array.isArray(devices) ? devices : [];
      if (state.menu === 'cast' && !state.cast.connected && !state.cast.connecting) {
        renderCastMenu();
        showPopover(els.castMenu, els.castBtn);
      }
    });

    api.onCastStatus((status) => {
      if (!status) return;

      state.cast.connected = true;
      state.cast.playerState = status.playerState || 'IDLE';

      if (Number.isFinite(status.currentTime)) {
        state.cast.currentTime = status.currentTime;
      }
      if (Number.isFinite(status.duration) && status.duration > 0) {
        state.cast.duration = status.duration;
      }

      updateCastUI();
      updateTransport();

      if (state.cast.playerState === 'PLAYING') wake();
    });

    api.onCastError((message) => {
      toast(message || 'Chromecast 오류가 발생했습니다.', 'error');
    });

    api.onCastStopped(() => {
      const wasConnected = state.cast.connected;
      const position = state.cast.currentTime;

      state.cast.connecting = false;
      state.cast.connected = false;
      state.cast.device = null;
      state.cast.playerState = 'IDLE';
      state.cast.duration = 0;
      state.cast.currentTime = 0;
      state.cast.lastMenuState = '';

      updateCastUI();
      updateTransport();
      renderCue(true);

      if (wasConnected) {
        toast('TV 전송이 종료되었습니다.');
        if (state.mediaReady && position > 0) {
          els.video.currentTime = Math.min(position, state.duration || position);
        }
      }
    });

    api.onCommand((command) => {
      switch (command) {
        case 'open-video':
          chooseVideo();
          break;
        case 'open-subtitle':
          chooseSubtitle();
          break;
        case 'toggle-play':
          togglePlay();
          break;
        case 'seek-back':
          seekBy(-10);
          break;
        case 'seek-forward':
          seekBy(10);
          break;
        case 'subtitle-off':
          selectSubtitle(null);
          break;
        case 'fullscreen':
          toggleFullscreen();
          break;
        default:
          break;
      }
    });
  }

  // ----------------------------------------------------------------- events

  function bindUi() {
    els.openBtn.addEventListener('click', chooseVideo);
    els.emptyOpen.addEventListener('click', chooseVideo);
    els.playBtn.addEventListener('click', togglePlay);
    els.muteBtn.addEventListener('click', toggleMute);
    els.subtitleBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleMenu('subtitle', els.subtitleBtn);
    });
    els.castBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleMenu('cast', els.castBtn);
    });
    els.fullscreenBtn.addEventListener('click', toggleFullscreen);
    els.castBadgeStop.addEventListener('click', () => stopCasting(false));
    els.retryBtn.addEventListener('click', retry);
    els.errorOpen.addEventListener('click', chooseVideo);
    els.cancelPrep.addEventListener('click', async () => {
      await api.stopMedia().catch(() => {});
      resetToEmpty();
    });

    els.seek.addEventListener('input', () => {
      state.seeking = true;
      const target = Number(els.seek.value) || 0;
      els.currentTime.textContent = formatTime(target);
      const duration = currentDuration();
      els.seek.style.setProperty(
        '--fill',
        `${duration > 0 ? Math.max(0, Math.min(100, (target / duration) * 100)) : 0}%`
      );
    });

    els.seek.addEventListener('change', () => {
      state.seeking = false;
      seekTo(Number(els.seek.value) || 0);
    });

    els.volume.addEventListener('input', () => {
      setVolume(Number(els.volume.value) || 0);
    });

    els.video.addEventListener('play', () => {
      syncPlayButton();
      wake();
    });

    els.video.addEventListener('pause', () => {
      syncPlayButton();
      wake();
    });

    els.video.addEventListener('timeupdate', () => {
      if (isCasting()) return;
      renderCue(false);
      if (!state.seeking) {
        const duration = currentDuration();
        const position = els.video.currentTime || 0;
        els.currentTime.textContent = formatTime(position);
        els.seek.max = String(duration > 0 ? duration : 1);
        els.seek.value = String(Math.min(position, duration > 0 ? duration : position));
        els.seek.style.setProperty(
          '--fill',
          `${duration > 0 ? Math.max(0, Math.min(100, (position / duration) * 100)) : 0}%`
        );
      }
    });

    els.video.addEventListener('durationchange', () => {
      applyPendingSeek();
      if (Number.isFinite(els.video.duration) && els.video.duration > 0) {
        if (!state.duration || state.mode === 'direct') {
          state.duration = els.video.duration;
        }
        updateTransport();
      }
    });

    els.video.addEventListener('volumechange', () => {
      if (isCasting()) return;
      state.volume = els.video.volume;
      state.muted = els.video.muted;
      syncVolumeUI();
    });

    els.video.addEventListener('error', () => {
      if (state.mode === 'direct' && state.mediaReady && els.video.error) {
        showError(`영상을 재생할 수 없습니다. (오류 ${els.video.error.code})`);
      }
    });

    els.video.addEventListener('ended', () => {
      syncPlayButton();
      wake();
    });

    els.video.addEventListener('click', togglePlay);
    els.video.addEventListener('dblclick', toggleFullscreen);

    els.stage.addEventListener('mousemove', wake);
    els.stage.addEventListener('mousedown', wake);

    document.addEventListener('click', (event) => {
      if (!state.menu) return;
      const target = event.target;
      if (
        els.subtitleMenu.contains(target) ||
        els.castMenu.contains(target) ||
        els.subtitleBtn.contains(target) ||
        els.castBtn.contains(target)
      ) {
        return;
      }
      closeMenus();
    });

    document.addEventListener('fullscreenchange', () => {
      closeMenus();
      wake();
    });

    window.addEventListener('resize', closeMenus);

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeMenus();
        return;
      }

      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      switch (event.key) {
        case ' ':
          event.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          if (event.metaKey || event.ctrlKey) return;
          event.preventDefault();
          seekBy(-5);
          wake();
          break;
        case 'ArrowRight':
          if (event.metaKey || event.ctrlKey) return;
          event.preventDefault();
          seekBy(5);
          wake();
          break;
        case 'ArrowUp':
          if (event.metaKey || event.ctrlKey) return;
          event.preventDefault();
          setVolume((isCasting() ? state.cast.volume : state.volume) + 0.05);
          wake();
          break;
        case 'ArrowDown':
          if (event.metaKey || event.ctrlKey) return;
          event.preventDefault();
          setVolume((isCasting() ? state.cast.volume : state.volume) - 0.05);
          wake();
          break;
        case 'm':
        case 'M':
          toggleMute();
          break;
        case 'f':
        case 'F':
          toggleFullscreen();
          break;
        case 'c':
        case 'C':
          toggleMenu('subtitle', els.subtitleBtn);
          break;
        default:
          break;
      }
    });

    bindDragAndDrop();
  }

  function bindDragAndDrop() {
    const setDragging = (active) => {
      els.dropzone.classList.toggle('dragging', active);
    };

    window.addEventListener('dragenter', (event) => {
      event.preventDefault();
      state.dragDepth += 1;
      setDragging(true);
    });

    window.addEventListener('dragover', (event) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      setDragging(true);
    });

    window.addEventListener('dragleave', (event) => {
      event.preventDefault();
      state.dragDepth = Math.max(0, state.dragDepth - 1);
      if (state.dragDepth === 0) setDragging(false);
    });

    window.addEventListener('drop', async (event) => {
      event.preventDefault();
      state.dragDepth = 0;
      setDragging(false);

      const files = Array.from((event.dataTransfer && event.dataTransfer.files) || []);
      if (!files.length) return;

      const videos = [];
      const subtitles = [];

      for (const file of files) {
        const filePath = api.getPathForFile(file);
        if (!filePath) continue;
        if (VIDEO_RE.test(filePath)) videos.push(filePath);
        else if (SUBTITLE_RE.test(filePath)) subtitles.push(filePath);
      }

      if (videos.length) {
        await openPath(videos[0]);
      } else if (subtitles.length && !state.mediaReady) {
        toast('영상을 먼저 열어 주세요.', 'error');
        return;
      }

      for (const filePath of subtitles) {
        await addSubtitlePath(filePath);
      }
    });
  }

  // ------------------------------------------------------------------- init

  let remoteInfo = { enabled: false };
  function renderRemoteInfo(info) {
    remoteInfo = info;
    $('remoteBtn').classList.toggle('accent', info.enabled);
    $('remoteURL').value = info.url || '';
    $('remoteCode').textContent = info.code || '—';
    const seconds = Math.max(0, Math.ceil(((info.expiresAt || 0) - Date.now()) / 1000));
    $('remoteStatus').textContent = !info.enabled ? '연결이 꺼져 있습니다.' :
      `${info.clients || 0}대 연결됨 · ${info.code && seconds ? `코드 유효 시간 ${seconds}초` : '새 코드를 눌러 다른 기기를 연결하세요.'}`;
  }

  function reportRemoteState() {
    if (!remoteInfo.enabled) return Promise.resolve();
    return api.reportRemoteState({ title: state.title, hasMedia: state.mediaReady,
      playing: isCasting() ? state.cast.playerState === 'PLAYING' : !els.video.paused,
      currentTime: currentPosition(), duration: currentDuration(),
      volume: isCasting() ? state.cast.volume : (state.muted ? 0 : state.volume),
      casting: isCasting(), castDevice: state.cast.device,
      subtitles: state.tracks.map(t => ({ id: t.id, name: t.name })), selectedSubtitleId: state.selectedSubtitleId,
      devices: state.cast.devices || [], preparing: state.cast.connecting || isPreparing() });
  }

  async function handleRemoteCommand(request) {
    let error;
    try {
      if (!state.mediaReady && !['stop', 'cast-stop'].includes(request.command)) throw new Error('컴퓨터에서 영상을 먼저 열어 주세요.');
      switch (request.command) {
        case 'play':
          if (isCasting()) await api.castPlay(); else await els.video.play();
          break;
        case 'pause':
          if (isCasting()) await api.castPause(); else els.video.pause();
          break;
        case 'seek':
          if (isCasting()) await api.castSeek(request.value); else seekTo(request.value);
          break;
        case 'volume':
          if (isCasting()) { await api.castVolume(request.value); state.cast.volume = request.value; syncVolumeUI(); }
          else setVolume(request.value);
          break;
        case 'subtitle':
          if (request.trackId && !state.tracks.some(t => t.id === request.trackId)) throw new Error('자막을 찾을 수 없습니다.');
          await api.selectSubtitle(request.trackId);
          state.selectedSubtitleId = request.trackId; syncCues(); renderCue(true);
          els.subtitleBtn.classList.toggle('accent', !!request.trackId);
          break;
        case 'cast-connect': {
          const device = (state.cast.devices || []).find(d => d.id === request.deviceId);
          if (!device) throw new Error('TV를 찾을 수 없습니다.');
          if (isCasting()) throw new Error('기존 TV 전송을 먼저 중지해 주세요.');
          await connectCast(device, true);
          break;
        }
        case 'cast-stop': await api.castStop(); break;
        case 'stop': await api.stopMedia(); break;
        default: throw new Error('지원하지 않는 조작입니다.');
      }
    } catch (failure) { error = cleanError(failure); }
    await reportRemoteState();
    await api.replyRemoteCommand({ id: request.id, error });
  }

  function bindRemote() {
    api.onRemoteInfo(renderRemoteInfo);
    api.onRemoteCommand(request => handleRemoteCommand(request).catch(() => {}));
    api.remoteInfo().then(renderRemoteInfo).catch(() => {});
    $('remoteBtn').addEventListener('click', async () => {
      try {
        renderRemoteInfo(await api.remoteStart()); startDiscovery(); await reportRemoteState();
        $('remoteDialog').showModal();
      } catch (error) { toast(cleanError(error), 'error'); }
    });
    $('remoteClose').addEventListener('click', () => $('remoteDialog').close());
    $('remoteRenew').addEventListener('click', async () => {
      try { renderRemoteInfo(remoteInfo.enabled ? await api.remoteRenew() : await api.remoteStart()); startDiscovery(); }
      catch (error) { toast(cleanError(error), 'error'); }
    });
    $('remoteDisable').addEventListener('click', async () => {
      try { renderRemoteInfo(await api.remoteStop()); } catch (error) { toast(cleanError(error), 'error'); }
    });
    setInterval(() => { reportRemoteState().catch(() => {}); if ($('remoteDialog').open) renderRemoteInfo(remoteInfo); }, 500);
  }

  async function init() {
    bindUi();
    bindIpc();
    bindRemote();

    try {
      const info = await api.getInfo();
      state.platform = info.platform || 'darwin';
      const labels = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };
      els.platformNote.textContent = `${labels[state.platform] || state.platform} · Chromecast`;
      document.body.classList.add(`platform-${state.platform}`);
    } catch {
      document.body.classList.add('platform-darwin');
    }

    syncVolumeUI();
    updateTransport();
    renderCue(true);
  }

  init();
})();
