const http = require('http');
const fs = require('fs');
const path = require('path');
const { randomBytes, randomInt, timingSafeEqual } = require('crypto');

function localAddress(value) {
  const address = String(value || '').replace(/^::ffff:/, '');
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) return false;
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return parts[0] === 127 || parts[0] === 10 || (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
}

function validCommand(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  switch (body.command) {
    case 'play': case 'pause': case 'stop': case 'cast-stop': return true;
    case 'seek': return Number.isFinite(body.value) && body.value >= 0 && body.value <= 604800;
    case 'volume': return Number.isFinite(body.value) && body.value >= 0 && body.value <= 1;
    case 'subtitle': return body.trackId === null || (typeof body.trackId === 'string' && body.trackId.length <= 200);
    case 'cast-connect': return typeof body.deviceId === 'string' && body.deviceId.length > 0 && body.deviceId.length <= 300;
    default: return false;
  }
}

// A deliberately small LAN control surface: no file paths, browsing, uploads, or shell commands.
class RemoteServer {
  constructor({ getState, command, onChange = () => {}, name = 'Tooplay', now = Date.now }) {
    Object.assign(this, { getState, command, onChange, name, now });
    this.server = null;
    this.tokens = new Map();
    this.attempts = [];
    this.sockets = new Set();
    this.busy = false;
    this.generation = 0;
    this.lastError = null;
  }

  async start(address) {
    if (this.startPromise) return this.startPromise;
    if (this.server) return this.info();
    if (!localAddress(address) || address.startsWith('127.')) throw new Error('같은 Wi-Fi의 사설 IPv4 주소가 필요합니다.');
    this.address = address;
    this.server = http.createServer((req, res) => this.handle(req, res).catch(() => this.json(res, 500, { error: '연결 요청을 처리하지 못했습니다.' })));
    this.server.requestTimeout = 15000;
    this.server.headersTimeout = 10000;
    this.server.keepAliveTimeout = 5000;
    this.server.maxHeadersCount = 32;
    this.server.on('connection', socket => { this.sockets.add(socket); socket.once('close', () => this.sockets.delete(socket)); });
    const server = this.server;
    const starting = new Promise((resolve, reject) => {
      this.cancelStart = () => reject(new Error('휴대폰 연결 시작이 취소되었습니다.'));
      server.on('error', error => { reject(error); if (this.server === server) this.stop(); });
      server.listen(0, '0.0.0.0', () => {
        if (this.server !== server) { server.close(); reject(new Error('휴대폰 연결 시작이 취소되었습니다.')); return; }
        resolve();
      });
    }).then(() => {
      if (this.server !== server) throw new Error('휴대폰 연결 시작이 취소되었습니다.');
      this.port = server.address().port;
      this.renewCode();
      return this.info();
    }).finally(() => {
      if (this.startPromise === starting) { this.startPromise = null; this.cancelStart = null; }
    });
    this.startPromise = starting;
    return starting;
  }

  renewCode() {
    if (!this.server) throw new Error('휴대폰 연결을 먼저 켜 주세요.');
    this.code = String(randomInt(0, 1000000)).padStart(6, '0');
    this.expiresAt = this.now() + 120000;
    this.onChange(this.info());
    return this.info();
  }

  info() {
    return this.server ? { enabled: true, url: `http://${this.address}:${this.port}`, code: this.code,
      expiresAt: this.expiresAt, clients: this.tokens.size } : { enabled: false, clients: 0 };
  }

  stop() {
    ++this.generation;
    if (this.cancelStart) this.cancelStart();
    this.cancelStart = null;
    this.startPromise = null;
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    if (this.server) this.server.close();
    this.server = null;
    this.tokens.clear();
    this.attempts = [];
    this.code = null;
    this.busy = false;
    this.lastError = null;
    this.onChange(this.info());
  }

  json(res, status, value) {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    res.end(JSON.stringify(value));
  }

  async body(req) {
    if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new Error('JSON 요청이 필요합니다.');
    let size = 0; const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 2048) throw new Error('요청이 너무 큽니다.');
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }

  async handle(req, res) {
    if (!localAddress(req.socket.remoteAddress)) return this.json(res, 403, { error: '같은 로컬 네트워크에서만 연결할 수 있습니다.' });
    const allowedHosts = [`${this.address}:${this.port}`, `127.0.0.1:${this.port}`];
    if (!allowedHosts.includes(req.headers.host)) return this.json(res, 403, { error: '잘못된 주소입니다.' });
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return this.json(res, 403, { error: '외부 웹사이트에서 연결할 수 없습니다.' });
    if (req.headers['sec-fetch-site'] === 'cross-site') return this.json(res, 403, { error: '외부 웹사이트에서 연결할 수 없습니다.' });
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const staticFiles = { '/': ['index.html', 'text/html; charset=utf-8'], '/remote.js': ['remote.js', 'text/javascript; charset=utf-8'], '/remote.css': ['remote.css', 'text/css; charset=utf-8'] };
    if (req.method === 'GET' && staticFiles[pathname]) {
      const [file, type] = staticFiles[pathname];
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        'Referrer-Policy': 'no-referrer' });
      return res.end(fs.readFileSync(path.join(__dirname, '../remote', file)));
    }
    let body;
    if (req.method === 'POST') {
      try { body = await this.body(req); } catch { return this.json(res, 400, { error: '잘못된 요청입니다.' }); }
    }
    if (req.method === 'POST' && pathname === '/api/pair') {
      this.attempts = this.attempts.filter(time => time > this.now() - 60000);
      if (this.attempts.length >= 5) return this.json(res, 429, { error: '연결 시도가 많습니다. 1분 뒤 다시 시도하세요.' });
      this.attempts.push(this.now());
      const input = String(body?.code || '');
      if (!this.code || this.now() >= this.expiresAt || !/^\d{6}$/.test(input) ||
          !timingSafeEqual(Buffer.from(input), Buffer.from(this.code))) return this.json(res, 401, { error: '연결 코드가 다르거나 만료되었습니다. 컴퓨터에서 새 코드를 받으세요.' });
      for (const [token, expiry] of this.tokens) if (expiry <= this.now()) this.tokens.delete(token);
      if (this.tokens.size >= 8) return this.json(res, 409, { error: '연결 가능한 기기 수를 초과했습니다.' });
      const token = randomBytes(32).toString('hex');
      this.tokens.set(token, this.now() + 8 * 60 * 60 * 1000);
      this.code = null; this.expiresAt = 0; // Each code may pair exactly one device.
      this.onChange(this.info());
      return this.json(res, 200, { token, serverName: this.name, protocolVersion: 1 });
    }
    const token = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization || '')?.[1];
    const expiry = this.tokens.get(token);
    if (!expiry || expiry < this.now()) {
      if (expiry) { this.tokens.delete(token); this.onChange(this.info()); }
      return this.json(res, 401, { error: '연결이 만료되었습니다. 다시 연결해 주세요.' });
    }
    if (req.method === 'DELETE' && pathname === '/api/session') {
      this.tokens.delete(token); this.onChange(this.info());
      return this.json(res, 200, { ok: true });
    }
    if (req.method === 'GET' && pathname === '/api/state') {
      return this.json(res, 200, { ...this.getState(), protocolVersion: 1, preparing: this.busy || !!this.getState().preparing, lastError: this.lastError });
    }
    if (req.method === 'POST' && pathname === '/api/command') {
      if (!validCommand(body)) return this.json(res, 400, { error: '지원하지 않는 조작입니다.' });
      if (this.busy && !['stop', 'cast-stop'].includes(body.command)) return this.json(res, 409, { error: '이전 조작을 처리 중입니다.' });
      const long = ['cast-connect', 'seek'].includes(body.command);
      const generation = ++this.generation;
      this.busy = true; this.lastError = null;
      const operation = Promise.resolve().then(() => this.command(body)).finally(() => { if (generation === this.generation) this.busy = false; });
      if (long) {
        operation.catch(error => { if (generation === this.generation) this.lastError = error.message; });
        return this.json(res, 202, { ok: true });
      }
      try { await operation; return this.json(res, 200, { ok: true }); }
      catch (error) { if (generation === this.generation) this.lastError = error.message; return this.json(res, 409, { error: error.message }); }
    }
    this.json(res, 404, { error: '요청을 찾을 수 없습니다.' });
  }
}

module.exports = { RemoteServer, localAddress, validCommand };
