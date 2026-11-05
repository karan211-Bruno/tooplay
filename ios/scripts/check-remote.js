const { spawn } = require('node:child_process');
const os = require('node:os');
const assert = require('node:assert/strict');
const http = require('node:http');
const { randomBytes } = require('node:crypto');
const { RemoteServer, localAddress } = require('../../desktop/src/main/remote-server');
(async () => {
  const address = Object.values(os.networkInterfaces()).flat().find(a => a.family === 'IPv4' && !a.internal && localAddress(a.address))?.address;
  assert.ok(address, 'A private LAN address is required');
  const state = { title: 'Protocol test fixture', hasMedia: true, playing: true, currentTime: 20, duration: 600, volume: 0.5, casting: false, castDevice: null, subtitles: [{ id: 'ko', name: '한국어' }], selectedSubtitleId: 'ko', devices: [], preparing: false };
  const commands = [];
  let clockOffset = 0;
  const server = new RemoteServer({ name: 'Tooplay protocol test', now: () => Date.now() + clockOffset, getState: () => state,
    command: async command => { commands.push(command); if (command.command === 'pause') state.playing = false; }
  });
  // Test-only fault injection; the application server exposes no such control routes.
  let holdNextCommand = false, holdNextPair = false, heldCommand, heldPair;
  const originalHandle = server.handle.bind(server);
  server.handle = async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (request.method === 'POST' && pathname === '/api/command' && holdNextCommand) {
      holdNextCommand = false; request.resume();
      await new Promise(resolve => { heldCommand = resolve; }); heldCommand = null;
      return server.json(response, 401, { error: 'Old command session expired' });
    }
    if (request.method === 'POST' && pathname === '/api/pair' && holdNextPair) {
      holdNextPair = false; request.resume();
      await new Promise(resolve => { heldPair = resolve; }); heldPair = null;
      return server.json(response, 401, { error: 'Old pairing attempt expired' });
    }
    return originalHandle(request, response);
  };
  const controlPath = '/' + randomBytes(24).toString('hex');
  const control = http.createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== controlPath) { response.writeHead(404); return response.end(); }
    try {
      let data = ''; for await (const chunk of request) data += chunk;
      const input = JSON.parse(data);
      let output = { ok: true };
      switch (input.action) {
        case 'renew': clockOffset += 60001; output.code = server.renewCode().code; break;
        case 'expire': server.tokens.clear(); break;
        case 'state': Object.assign(state, input.state); break;
        case 'holdCommand': holdNextCommand = true; break;
        case 'holdPair': holdNextPair = true; break;
        case 'releaseCommand': heldCommand?.(); break;
        case 'releasePair': heldPair?.(); break;
        case 'status': output = { heldCommand: !!heldCommand, heldPair: !!heldPair, tokens: server.tokens.size }; break;
        default: throw new Error('Unknown test control');
      }
      response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(output));
    } catch (error) { response.writeHead(500); response.end(JSON.stringify({ error: error.message })); }
  });
  try {
    const info = await server.start(address);
    await new Promise((resolve, reject) => { control.once('error', reject); control.listen(0, '127.0.0.1', resolve); });
    const child = spawn(process.argv[2], [], { stdio: 'inherit', env: { ...process.env,
      TOOPLAY_TEST_ADDRESS: info.url, TOOPLAY_TEST_CODE: info.code, TOOPLAY_HTTP_TEST: '1',
      TOOPLAY_TEST_CONTROL: `http://127.0.0.1:${control.address().port}${controlPath}` } });
    const timer = setTimeout(() => child.kill('SIGKILL'), 45000);
    let status;
    try { status = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); }); }
    finally { clearTimeout(timer); }
    assert.equal(status, 0, 'Swift tests must pass');
    assert.deepEqual(commands, [{ command: 'pause' }]);
    assert.equal(server.tokens.size, 0, 'Disconnect must revoke the token');
    console.log('PASS: Swift URLSession client, desktop protocol, token expiry, re-pairing, polling restart and stale-response isolation');
  } finally { heldCommand?.(); heldPair?.(); server.stop(); control.closeAllConnections(); control.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
