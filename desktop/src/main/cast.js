const { EventEmitter } = require('events');
const { Client, DefaultMediaReceiver } = require('castv2-client');
const { Bonjour } = require('bonjour-service');

class CastManager extends EventEmitter {
  constructor({ ClientType = Client, BonjourType = Bonjour, connectionTimeout = 12000 } = {}) {
    super();
    this.bonjour = null;
    this.browser = null;
    this.devices = new Map();
    this.client = null;
    this.player = null;
    this.pollTimer = null;
    this.refreshTimer = null;
    this.currentDuration = 0;
    this.ClientType = ClientType;
    this.BonjourType = BonjourType;
    this.connectionTimeout = connectionTimeout;
    this.pendingCancel = null;
    this.lastStatus = null;
    this.media = null;
  }

  // MARK: - Discovery

  startDiscovery() {
    if (this.browser) { this.browser.update(); return; }

    try {
      this.bonjour = new this.BonjourType({}, (error) => {
        this.emit('error', `Chromecast 검색 중 오류가 발생했습니다: ${error.message || error}`);
      });
      const mdns = this.bonjour.server && this.bonjour.server.mdns;
      if (mdns) mdns.on('error', (error) => this.emit('error', `Chromecast 검색 중 오류가 발생했습니다: ${error.message}`));
      this.browser = this.bonjour.find({ type: 'googlecast' });

      this.browser.on('up', (service) => {
        const txt = service.txt || {};
        const id = txt.id || service.name;
        const address = (service.addresses || []).find((value) => /^\d+\.\d+\.\d+\.\d+$/.test(value));
        const host = address || service.host;

        if (!host) return;

        this.devices.set(id, {
          id,
          name: txt.fn || service.name,
          model: txt.md || 'Chromecast',
          host,
          port: service.port || 8009
        });
        this.emitDevices();
      });

      this.browser.on('down', (service) => {
        const txt = service.txt || {};
        const id = txt.id || service.name;
        if (this.devices.delete(id)) this.emitDevices();
      });

      this.browser.on('error', (error) => {
        this.emit('error', `Chromecast 검색 중 오류가 발생했습니다: ${error && error.message ? error.message : error}`);
      });

      this.browser.update();
      this.refreshTimer = setInterval(() => {
        try {
          this.browser.update();
        } catch {
          // ignore
        }
      }, 8000);
    } catch (error) {
      this.stopDiscovery();
      this.emit('error', `Chromecast 검색을 시작할 수 없습니다: ${error.message}`);
    }
  }

  stopDiscovery() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
    if (this.browser) {
      try {
        this.browser.stop();
      } catch {
        // ignore
      }
      if (this.refreshTimer) {
        clearInterval(this.refreshTimer);
        this.refreshTimer = null;
      }
      this.browser = null;
    }
    if (this.bonjour) {
      try {
        this.bonjour.destroy();
      } catch {
        // ignore
      }
      this.bonjour = null;
    }
    this.devices.clear();
    this.emitDevices();
  }

  emitDevices() {
    const list = Array.from(this.devices.values())
      .sort((a, b) => a.name.localeCompare(b.name));
    this.emit('devices', list);
  }

  getDevice(id) {
    return this.devices.get(id) || null;
  }

  // MARK: - Connection

  connect(device, media, options = {}) {
    this.disconnect();
    const client = new this.ClientType();
    this.client = client;
    this.currentDuration = Number(media.duration) || 0;
    this.media = media;
    return new Promise((resolve, reject) => {
      let settled = false;
      let timeout;
      const active = () => this.client === client;
      const fail = (message) => {
        if (!active()) return;
        clearTimeout(timeout);
        if (!settled) { settled = true; reject(new Error(message)); }
        this.pendingCancel = null;
        this.disconnect();
        this.emit('stopped');
      };
      this.pendingCancel = () => {
        clearTimeout(timeout);
        if (!settled) { settled = true; reject(new Error('TV 연결이 취소되었습니다.')); }
      };
      client.on('error', (error) => {
        if (!active()) return;
        fail(`Chromecast 오류: ${error.message}`);
        this.emit('error', `Chromecast 오류: ${error.message}`);
      });
      client.on('close', () => fail('TV 연결이 종료되었습니다.'));
      timeout = setTimeout(() => fail('Chromecast 연결 시간이 초과되었습니다. 같은 Wi-Fi를 확인하세요.'), this.connectionTimeout);
      client.connect({ host: device.host, port: device.port || 8009 }, () => {
        if (!active()) return;
        client.launch(DefaultMediaReceiver, (error, player) => {
          if (!active()) return;
          if (error) return fail(`TV 플레이어를 실행할 수 없습니다: ${error.message}`);
          this.player = player;
          player.on('status', (status) => { if (active()) this.emitStatus(status); });
          player.on('close', () => fail('TV 플레이어가 종료되었습니다.'));
          player.load(media, {
            autoplay: options.autoplay !== false,
            currentTime: Math.max(0, Number(options.currentTime) || 0),
            activeTrackIds: options.activeTrackIds || []
          }, (loadError, status) => {
            if (!active() || settled) return;
            if (loadError) return fail(`TV 재생을 시작하지 못했습니다: ${loadError.message}`);
            clearTimeout(timeout);
            settled = true;
            this.pendingCancel = null;
            // castv2-client does not initialize currentSession in its LOAD callback.
            if (status && player.media) player.media.currentSession = status;
            if (status) this.emitStatus(status);
            this.startPolling();
            resolve();
          });
        });
      });
    });
  }

  startPolling() {
    this.stopPolling();
    const player = this.player;
    this.pollTimer = setInterval(() => {
      if (this.player !== player) return;
      player.getStatus((error, status) => {
        if (this.player === player && !error && status) this.emitStatus(status);
      });
    }, 1000);
  }

  stopPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  emitStatus(status) {
    if (!status) return;
    this.lastStatus = status;
    if (this.player && this.player.media) this.player.media.currentSession = status;
    this.emit('status', {
      playerState: status.playerState || 'IDLE',
      currentTime: Number(status.currentTime) || 0,
      duration: (status.media && Number(status.media.duration)) || this.currentDuration || 0,
      mediaSessionId: status.mediaSessionId
    });
  }

  reloadTracks(tracks, activeTrackIds) {
    const player = this.player;
    if (!player || !this.media) return Promise.reject(new Error('TV가 연결되어 있지 않습니다.'));
    const media = { ...this.media, tracks };
    const status = this.lastStatus || {};
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('TV 자막 변경 시간이 초과되었습니다.')), this.connectionTimeout);
      player.load(media, {
        autoplay: status.playerState === 'PLAYING' || status.playerState === 'BUFFERING',
        currentTime: Number(status.currentTime) || 0, activeTrackIds
      }, (error, nextStatus) => {
        clearTimeout(timeout);
        if (this.player !== player) return reject(new Error('TV 연결이 변경되었습니다.'));
        if (error) return reject(error);
        this.media = media;
        if (nextStatus) this.emitStatus(nextStatus);
        resolve();
      });
    });
  }

  // MARK: - Remote control

  play(callback = () => {}) {
    if (!this.player || !this.player.media.currentSession) return callback(new Error('TV 재생 세션이 없습니다.'));
    this.player.play(callback);
  }

  pause(callback = () => {}) {
    if (!this.player || !this.player.media.currentSession) return callback(new Error('TV 재생 세션이 없습니다.'));
    this.player.pause(callback);
  }

  seek(seconds, callback = () => {}) {
    if (!this.player || !this.player.media.currentSession) return callback(new Error('TV 재생 세션이 없습니다.'));
    this.player.seek(Math.max(0, Number(seconds) || 0), callback);
  }

  setSubtitle(activeTrackIds, callback = () => {}) {
    if (!this.player || !this.player.media || !this.player.media.currentSession) return callback(new Error('TV 재생 세션이 없습니다.'));
    this.player.media.sessionRequest({
      type: 'EDIT_TRACKS_INFO',
      activeTrackIds: activeTrackIds || []
    }, callback);
  }

  setVolume(level, callback = () => {}) {
    if (!this.client) return callback(new Error('not connected'));
    this.client.setVolume({ level: Math.max(0, Math.min(1, Number(level) || 0)) }, callback);
  }

  stop() {
    const client = this.client;
    const player = this.player;
    this.disconnect(false);
    this.emit('stopped');
    if (!client) return;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      try { client.close(); } catch { /* Already closed. */ }
    };
    const timeout = setTimeout(finish, 1500);
    try {
      if (player && player.media && player.media.currentSession) {
        player.stop(() => {
          if (finished) return;
          try { client.stop(player, finish); } catch { finish(); }
        });
      } else finish();
    } catch { finish(); }
  }

  disconnect(close = true) {
    const client = this.client;
    this.client = null;
    this.player = null;
    if (this.pendingCancel) this.pendingCancel();
    this.pendingCancel = null;
    this.stopPolling();
    this.lastStatus = null;
    this.media = null;
    if (close && client) { try { client.close(); } catch { /* Already closed. */ } }
  }

  dispose() {
    this.disconnect();
    this.stopDiscovery();
  }
}

module.exports = { CastManager };
