const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { MediaServer } = require('../src/main/server');

test('HTTP video ranges, HEAD, CORS, subtitle encoding and traversal', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tooplay-http-test-'));
  const file = path.join(dir, 'movie.mp4');
  fs.writeFileSync(file, '0123456789');
  fs.writeFileSync(path.join(dir, 'ko.vtt'), 'WEBVTT\n\n한국어');
  const server = new MediaServer(); server.addFile('/media', file); server.addDirectory('/subs/', dir);
  const port = await server.start();
  t.after(() => { server.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  const get = (route, options) => fetch(`http://127.0.0.1:${port}${route}`, options);
  for (const [range, expected] of [['bytes=2-5','2345'], ['bytes=-3','789'], ['bytes=8-99','89'], ['bytes=6-','6789']]) {
    const r = await get('/media', { headers: { Range: range } });
    assert.equal(r.status, 206); assert.equal(await r.text(), expected);
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
  }
  const invalid = await get('/media', { headers: { Range: 'bytes=10-' } });
  assert.equal(invalid.status, 416); assert.equal(invalid.headers.get('content-range'), 'bytes */10');
  const head = await get('/media', { method: 'HEAD' });
  assert.equal(head.headers.get('content-length'), '10'); assert.equal(await head.text(), '');
  assert.equal((await get('/media', { method: 'OPTIONS' })).status, 204);
  assert.equal((await get('/media', { method: 'POST' })).status, 405);
  const subtitle = await get('/subs/ko.vtt'); assert.match(subtitle.headers.get('content-type'), /charset=utf-8/);
  assert.match(await subtitle.text(), /한국어/);
  assert.equal(server.resolve('/subs/../outside'), null);
  assert.equal(server.resolve('/subs/%00'), path.join(dir, '%00'));
  assert.equal((await get('/subs/%00')).status, 404);
  assert.equal((await get('/unknown')).status, 404);
});

test('stopping a server before listening does not leak or crash', async () => {
  const server = new MediaServer(); const starting = server.start(); server.stop();
  await assert.rejects(starting, /취소/);
});
