const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME_TYPES = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.m3u': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
  '.m4s': 'video/iso.segment',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.vtt': 'text/vtt',
  '.aac': 'audio/aac',
  '.mp3': 'audio/mpeg'
};

class MediaServer {
  constructor() {
    this.routes = new Map();
    this.server = null;
    this.port = 0;
    this.stopped = false;
  }

  addFile(route, filePath) {
    this.routes.set(route, { kind: 'file', filePath: path.resolve(filePath) });
  }

  addDirectory(prefix, directory) {
    const normalized = prefix.endsWith('/') ? prefix : `${prefix}/`;
    this.routes.set(normalized, { kind: 'directory', directory: path.resolve(directory) });
  }

  start() {
    this.stopped = false;
    return new Promise((resolve, reject) => {
      this.startReject = reject;
      this.server = http.createServer((request, response) => {
        this.handle(request, response).catch((error) => {
          console.error('HTTP server error:', error);
          this.sendError(response, 500, 'Internal Server Error');
        });
      });

      const server = this.server;
      server.on('error', reject);
      server.listen(0, '0.0.0.0', () => {
        if (this.stopped) { server.close(); reject(new Error('재생 준비가 취소되었습니다.')); return; }
        this.startReject = null;
        this.port = server.address().port;
        resolve(this.port);
      });
    });
  }

  stop() {
    this.stopped = true;
    if (this.startReject) { this.startReject(new Error('재생 준비가 취소되었습니다.')); this.startReject = null; }
    if (!this.server) return;
    try {
      this.server.close();
      this.server.closeAllConnections();
    } catch {
      // ignore
    }
    this.server = null;
    this.port = 0;
    this.stopped = false;
  }

  resolve(pathname) {
    if (this.routes.has(pathname)) {
      const route = this.routes.get(pathname);
      return route.kind === 'file' ? route.filePath : null;
    }

    for (const [prefix, route] of this.routes) {
      if (route.kind !== 'directory' || !pathname.startsWith(prefix)) continue;

      const relative = pathname.slice(prefix.length);
      if (!relative || relative.includes('..') || relative.includes('\0')) return null;

      const candidate = path.resolve(route.directory, relative);
      const root = route.directory.endsWith(path.sep) ? route.directory : `${route.directory}${path.sep}`;
      if (!candidate.startsWith(root)) return null;
      return candidate;
    }

    return null;
  }

  async handle(request, response) {
    this.setCORS(response);

    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, Content-Type',
        'Access-Control-Max-Age': '86400',
        'Content-Length': '0'
      });
      response.end();
      return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      this.sendError(response, 405, 'Method Not Allowed');
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    } catch {
      this.sendError(response, 400, 'Bad Request');
      return;
    }

    const filePath = this.resolve(pathname);
    if (!filePath) {
      this.sendError(response, 404, 'Not Found');
      return;
    }

    let stat;
    try {
      stat = await fs.promises.stat(filePath);
    } catch {
      this.sendError(response, 404, 'Not Found');
      return;
    }

    if (!stat.isFile()) {
      this.sendError(response, 404, 'Not Found');
      return;
    }

    const totalSize = stat.size;
    const range = this.parseRange(request.headers.range, totalSize);
    if (request.headers.range && range === null && /^bytes=\d*-\d*$/.test(request.headers.range)) {
      response.writeHead(416, { 'Content-Range': `bytes */${totalSize}`, 'Content-Length': '0' });
      response.end();
      return;
    }
    const start = range ? range.start : 0;
    const end = range ? range.end : Math.max(0, totalSize - 1);
    const length = totalSize === 0 ? 0 : Math.max(0, end - start + 1);
    const status = range ? 206 : 200;
    const extension = path.extname(filePath).toLowerCase();
    const isPlaylist = extension === '.m3u8' || extension === '.m3u';

    const headers = {
      'Content-Type': extension === '.vtt' ? 'text/vtt; charset=utf-8' : MIME_TYPES[extension] || 'application/octet-stream',
      'Content-Length': String(length),
      'Accept-Ranges': 'bytes',
      'Cache-Control': isPlaylist ? 'no-store, no-cache, must-revalidate' : 'no-cache',
      'Connection': 'close'
    };

    if (range) {
      headers['Content-Range'] = `bytes ${range.start}-${range.end}/${totalSize}`;
    }

    response.writeHead(status, headers);

    if (request.method === 'HEAD' || length === 0) {
      response.end();
      return;
    }

    const stream = fs.createReadStream(filePath, { start, end });
    stream.on('error', () => {
      response.destroy();
    });
    response.on('close', () => stream.destroy());
    stream.pipe(response);
  }

  parseRange(header, size) {
    if (!header || size <= 0) return null;
    const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
    if (!match) return null;

    const [, startText, endText] = match;
    let start;
    let end;

    if (!startText) {
      const suffix = Number(endText);
      if (!Number.isFinite(suffix) || suffix <= 0) return null;
      start = Math.max(0, size - suffix);
      end = size - 1;
    } else {
      start = Number(startText);
      if (!Number.isFinite(start) || start < 0 || start >= size) return null;
      end = endText ? Number(endText) : size - 1;
      if (!Number.isFinite(end) || end < start) return null;
      end = Math.min(end, size - 1);
    }

    return { start, end };
  }

  setCORS(response) {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
    response.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range');
  }

  sendError(response, status, message) {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    const body = Buffer.from(message);
    response.writeHead(status, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Length': String(body.length),
      'Connection': 'close'
    });
    response.end(body);
  }
}

module.exports = { MediaServer };
