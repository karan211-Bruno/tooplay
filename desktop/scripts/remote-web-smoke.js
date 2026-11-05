// Real Chrome + production RemoteServer/web assets; only the player adapter is simulated.
// Uses an isolated temporary browser profile. Does not open user tabs or contact a TV.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { RemoteServer } = require('../src/main/remote-server');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await sleep(80); }
  throw new Error(`Timed out: ${label}`);
}

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tooplay-remote-web-'));
  const profile = path.join(directory, 'chrome-profile');
  const state = { title: '한국어 테스트 <영상>', hasMedia: true, playing: false, currentTime: 12,
    duration: 180, volume: 0.6, casting: false, castDevice: null, preparing: false,
    subtitles: [{ id: 'ko', name: '한국어' }, { id: 'en', name: 'English' }], selectedSubtitleId: null, devices: [] };
  const commands = [], checks = [], errors = [], pending = new Map();
  let failNext = false, browser, socket, launchError, logs = '', sequence = 0, pausedRequests = [];
  const remote = new RemoteServer({ name: 'UI test computer', getState: () => ({ ...state }), command: async body => {
    commands.push(body);
    if (failNext) { failNext = false; throw new Error('테스트 조작 오류'); }
    switch (body.command) {
      case 'play': state.playing = true; break;
      case 'pause': state.playing = false; break;
      case 'seek': state.currentTime = Math.min(body.value, state.duration); break;
      case 'volume': state.volume = body.value; break;
      case 'subtitle': state.selectedSubtitleId = body.trackId; break;
      default: throw new Error('Unexpected smoke-test command');
    }
  } });
  try {
    // The HTTP listener is real; loopback keeps this browser test independent of Wi-Fi availability.
    const pairing = await remote.start('192.168.0.5');
    const base = `http://127.0.0.1:${remote.port}`;
    const executable = process.env.TOOPLAY_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    assert.ok(fs.existsSync(executable), 'Chrome executable exists');
    browser = spawn(executable, ['--headless=new', '--no-first-run', '--no-default-browser-check',
      '--disable-background-networking', '--disable-component-update', '--disable-sync',
      '--disable-extensions', '--disable-features=Translate', '--remote-debugging-port=0',
      '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, 'about:blank'],
    { stdio: ['ignore', 'pipe', 'pipe'] });
    browser.on('error', error => { launchError = error; });
    browser.stderr.on('data', chunk => { logs = (logs + chunk).slice(-6000); });
    browser.stdout.on('data', chunk => { logs = (logs + chunk).slice(-6000); });
    const activePort = path.join(profile, 'DevToolsActivePort');
    await until(() => {
      if (launchError) throw launchError;
      if (browser.exitCode !== null || browser.signalCode) throw new Error(`Chrome exited: ${logs}`);
      return fs.existsSync(activePort);
    }, 'isolated Chrome launch', 45000);
    const port = Number(fs.readFileSync(activePort, 'utf8').split('\n')[0]);
    let target;
    await until(async () => {
      target = (await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json())).find(page => page.type === 'page');
      return !!target;
    }, 'headless page');
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
      if (message.method === 'Fetch.requestPaused') pausedRequests.push(message.params.requestId);
      const waiting = pending.get(message.id);
      if (!waiting) return;
      clearTimeout(waiting.timer); pending.delete(message.id);
      message.error ? waiting.reject(new Error(message.error.message)) : waiting.resolve(message.result);
    });
    const cdp = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
      pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    const click = id => evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
    const text = id => evaluate(`document.getElementById(${JSON.stringify(id)}).textContent`);
    const ready = () => evaluate('!document.getElementById("play").disabled');
    const select = (id, value) => evaluate(`(() => { const el = document.getElementById(${JSON.stringify(id)}); el.value = ${JSON.stringify(String(value))}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    const submitCode = code => evaluate(`document.getElementById('code').value = ${JSON.stringify(code)}; document.getElementById('pairForm').requestSubmit()`);
    await cdp('Runtime.enable'); await cdp('Page.enable');
    await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await cdp('Page.navigate', { url: base });
    await until(() => evaluate('document.readyState === "complete" && !!document.getElementById("pairForm")'), 'remote page');
    assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, 'phone viewport has no horizontal overflow');
    assert.equal(await evaluate('document.getElementById("player").hidden'), true);
    checks.push('phone viewport and initial pairing screen');

    await submitCode(pairing.code === '000000' ? '111111' : '000000');
    await until(async () => (await text('message')).includes('연결 코드'), 'incorrect-code error');
    assert.equal(remote.info().clients, 0); checks.push('incorrect code rejected in UI');
    await submitCode(pairing.code);
    await until(async () => (await text('title')) === state.title && await ready(), 'paired state');
    assert.equal(remote.info().clients, 1);
    assert.equal(await text('duration'), '3:00'); assert.equal(await text('position'), '0:12');
    assert.equal(await evaluate('document.getElementById("title").children.length'), 0, 'title is text, not markup');
    checks.push('one-time pairing and rendered player state');

    await click('play'); await until(async () => state.playing && (await text('play')) === '일시정지' && await ready(), 'play');
    await click('play'); await until(async () => !state.playing && (await text('play')) === '재생' && await ready(), 'pause');
    checks.push('play and pause');
    await select('seek', 42); await until(async () => state.currentTime === 42 && (await text('position')) === '0:42' && await ready(), 'seek');
    await click('forward'); await until(async () => state.currentTime === 52 && await ready(), 'forward');
    await click('back'); await until(async () => state.currentTime === 42 && await ready(), 'backward');
    checks.push('seek and ten-second controls');
    await select('volume', 0.35); await until(async () => state.volume === 0.35 && await ready(), 'volume');
    assert.equal(await evaluate('Number(document.getElementById("volume").value)'), 0.35);
    checks.push('volume');
    await select('subtitle', 'ko'); await until(async () => state.selectedSubtitleId === 'ko' && await ready(), 'subtitle on');
    await select('subtitle', ''); await until(async () => state.selectedSubtitleId === null && await ready(), 'subtitle off');
    checks.push('subtitle selection and off');

    failNext = true;
    await click('play'); await until(async () => (await text('message')).includes('테스트 조작 오류') && await ready(), 'command failure surfaced');
    assert.equal(state.playing, false); checks.push('server command error surfaced');
    await click('play'); await until(async () => state.playing && await ready(), 'recovery after error');
    checks.push('control recovery after error');

    // Hold the first state response during reload to verify restored tokens cannot enable controls prematurely.
    await cdp('Fetch.enable', { patterns: [{ urlPattern: '*/api/state', requestStage: 'Request' }] });
    await cdp('Page.reload', { ignoreCache: true });
    await until(() => pausedRequests.length > 0, 'restored-token state request');
    assert.equal(await evaluate('document.getElementById("pair").hidden'), true);
    assert.equal(await evaluate('document.getElementById("play").disabled'), true);
    assert.equal(await evaluate('document.getElementById("seek").disabled'), true);
    for (const requestId of pausedRequests.splice(0)) await cdp('Fetch.continueRequest', { requestId });
    await cdp('Fetch.disable');
    await until(async () => (await text('title')) === state.title && await ready(), 'restored-token refreshed state');
    checks.push('restored token keeps controls disabled until first state');

    const oldToken = await evaluate('sessionStorage.getItem("tooplay-token")');
    await click('disconnect');
    await until(() => evaluate('!document.getElementById("pair").hidden && document.getElementById("player").hidden'), 'disconnect UI');
    assert.equal(remote.info().clients, 0);
    assert.equal(await evaluate('sessionStorage.getItem("tooplay-token")'), null);
    assert.equal((await fetch(base + '/api/state', { headers: { Authorization: `Bearer ${oldToken}` } })).status, 401);
    checks.push('disconnect revokes server token and clears browser session');
    assert.deepEqual(errors, [], 'no uncaught browser runtime errors');
    checks.push('no uncaught browser runtime errors');
    const version = await cdp('Browser.getVersion');
    console.log(JSON.stringify({ passed: true, browser: version.product, viewport: '390x844', checks,
      commandCount: commands.length, scope: 'Real headless Chrome and production LAN HTTP/web client; simulated player adapter; no TV interaction.' }, null, 2));
  } finally {
    for (const waiting of pending.values()) { clearTimeout(waiting.timer); waiting.reject(new Error('Smoke test ended')); }
    pending.clear();
    if (socket) socket.close();
    remote.stop();
    if (browser && browser.exitCode === null && !browser.signalCode) {
      browser.kill('SIGTERM');
      await Promise.race([new Promise(resolve => browser.once('exit', resolve)), sleep(5000)]);
      if (browser.exitCode === null && !browser.signalCode) browser.kill('SIGKILL');
    }
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 });
  }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
