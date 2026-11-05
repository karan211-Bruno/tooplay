#!/usr/bin/env node
'use strict';

// Independent evidence from the actual Electron <video>, not the mobile display
// or the desktop HTTP state adapter. Uses only an explicitly supplied test fixture.
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { setTimeout: sleep } = require('node:timers/promises');

const usage = `Usage: node verify-remote.js <fixture.json> <command> [options]

Commands:
  snapshot          Read actual Electron video, subtitles, and paired-client count.
  wait-playing      Wait for decoded video to be playing.
  wait-paused       Wait for decoded video to be paused.
  wait-time         Wait for --seconds=N (default tolerance 1 second).
  reset             Pause at zero and renew the test pairing code.
  monitor           Observe ordered mobile actions and write independent evidence.
  finish            Create <fixture.json>.done to close only this test session.

Options:
  --timeout-ms=N     Deadline; default 10000 (monitor:120000).
  --seconds=N        Expected position for wait-time.
  --tolerance=N      Position tolerance; default 1.
  --output=PATH      Save JSON result; required for monitor.
  --expect=LIST      Monitor steps; default connected,play,progress,pause,jump,disconnected.
  --interval-ms=N    Monitor sampling; default 100, minimum 50.
  --revoke-clients   With reset, revoke old test pairings before making a new code.

Fixture is produced by the desktop scripts/smoke-test.js with
TOOPLAY_REMOTE_FIXTURE=<absolute fixture path>. That process retains the isolated
app for 20 minutes or until the .done marker. The helper never selects a TV.
`;

const parsed = parseArgs({ allowPositionals: true, options: {
  'timeout-ms': { type: 'string' }, seconds: { type: 'string' }, tolerance: { type: 'string' },
  output: { type: 'string' }, expect: { type: 'string' }, 'interval-ms': { type: 'string' },
  'revoke-clients': { type: 'boolean' },
  help: { type: 'boolean' }
} });
const [fixtureArgument, command] = parsed.positionals;
if (parsed.values.help || !fixtureArgument || !command) {
  process.stdout.write(usage); process.exit(parsed.values.help ? 0 : 2);
}
const fixturePath = path.resolve(fixtureArgument);
const numeric = (name, fallback, minimum, maximum) => {
  const value = parsed.values[name] === undefined ? fallback : Number(parsed.values[name]);
  if (!Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`Invalid --${name}`);
  return value;
};

async function readFixture() {
  // The desktop rewrites this small file once per second, so tolerate that window.
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
      const debuggerURL = new URL(fixture.debuggerURL);
      if (debuggerURL.protocol !== 'ws:' || debuggerURL.hostname !== '127.0.0.1' ||
          !debuggerURL.pathname.startsWith('/devtools/page/')) throw new Error('Fixture must identify a local Electron test debugger');
      return fixture;
    } catch (error) { if (attempt === 9) throw error; await sleep(50); }
  }
}

function writeResult(value) {
  if (parsed.values.output) {
    const output = path.resolve(parsed.values.output);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(value, null, 2) + '\n');
  }
}

async function connect(fixture) {
  const socket = new WebSocket(fixture.debuggerURL);
  const pending = new Map(); let sequence = 0;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('Debugger connection timed out')); }, 5000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Debugger connection failed')); }, { once: true });
  });
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    const waiting = pending.get(message.id);
    if (!waiting) return;
    pending.delete(message.id); clearTimeout(waiting.timer);
    message.error ? waiting.reject(new Error(message.error.message)) : waiting.resolve(message.result);
  });
  socket.addEventListener('close', () => {
    for (const waiting of pending.values()) { clearTimeout(waiting.timer); waiting.reject(new Error('Debugger closed')); }
    pending.clear();
  });
  const cdp = (method, params) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Debugger request timed out: ${method}`)); }, 5000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  if (!await evaluate('Boolean(window.smokeEvents && window.tooplay && document.getElementById("video"))')) {
    socket.close(); throw new Error('Debugger is not the isolated Tooplay smoke-test app');
  }
  const snapshot = () => evaluate(`(async () => {
    const video = document.getElementById('video');
    const info = await window.tooplay.remoteInfo();
    const quality = video.getVideoPlaybackQuality ? video.getVideoPlaybackQuality() : null;
    return {
      currentTime: video.currentTime, duration: video.duration,
      paused: video.paused, ended: video.ended, readyState: video.readyState,
      volume: video.volume, muted: video.muted,
      decodedFrames: quality ? quality.totalVideoFrames : (video.webkitDecodedFrameCount || 0),
      subtitle: document.getElementById('subtitleLayer').textContent,
      error: video.error ? video.error.message : null,
      remoteEnabled: info.enabled, clients: info.clients
    };
  })()`);
  return { evaluate, snapshot, close: () => socket.close() };
}

async function main() {
  const fixture = await readFixture();
  if (command === 'finish') {
    fs.writeFileSync(fixturePath + '.done', 'mobile simulator tests finished\n', { mode: 0o600 });
    console.log('Requested cleanup of the specified isolated desktop fixture.'); return;
  }
  const client = await connect(fixture);
  try {
    const timeout = numeric('timeout-ms', command === 'monitor' ? 120000 : 10000, 100, 1200000);
    if (command === 'snapshot') {
      const result = await client.snapshot(); writeResult(result); console.log(JSON.stringify(result)); return;
    }
    if (command === 'reset') {
      const pairing = await client.evaluate(`(async () => {
        const video=document.getElementById('video'); video.pause(); video.currentTime=0;
        ${parsed.values['revoke-clients'] ? 'await tooplay.remoteStop(); const info=await tooplay.remoteStart();' : 'const info=await tooplay.remoteRenew();'}
        return { code:info.code, address:info.url };
      })()`);
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const published = await readFixture();
        if (published.code === pairing.code && published.address === pairing.address) {
          console.log('Paused at zero; fresh pairing code is available in the fixture file.'); return;
        }
        await sleep(100);
      }
      throw new Error('Desktop has not published the renewed pairing code');
    }
    if (command.startsWith('wait-')) {
      const seconds = numeric('seconds', 0, 0, 86400);
      const tolerance = numeric('tolerance', 1, 0, 30);
      const deadline = Date.now() + timeout;
      let latest;
      while (Date.now() < deadline) {
        latest = await client.snapshot();
        if (latest.error) throw new Error(latest.error);
        const decoded = latest.readyState >= 3 && latest.decodedFrames > 0;
        const matches = decoded && (
          (command === 'wait-playing' && !latest.paused && !latest.ended) ||
          (command === 'wait-paused' && latest.paused) ||
          (command === 'wait-time' && Math.abs(latest.currentTime - seconds) <= tolerance)
        );
        if (matches) { writeResult(latest); console.log(JSON.stringify({ passed: true, command, ...latest })); return; }
        await sleep(100);
      }
      writeResult({ passed: false, command, lastState: latest });
      throw new Error(`Actual desktop video did not satisfy ${command}`);
    }
    if (command !== 'monitor') throw new Error('Unknown command');
    if (!parsed.values.output) throw new Error('monitor requires --output');
    const steps = (parsed.values.expect || 'connected,play,progress,pause,jump,disconnected').split(',');
    const allowed = new Set(['connected', 'play', 'progress', 'pause', 'jump', 'disconnected']);
    if (steps.some(step => !allowed.has(step))) throw new Error('Unknown monitor step');
    const interval = numeric('interval-ms', 100, 50, 2000);
    const started = Date.now(), deadline = started + timeout;
    const samples = [], matched = [];
    let previous, playBaseline, stopReason = null;
    const interrupted = () => { stopReason = 'interrupted'; };
    process.once('SIGTERM', interrupted); process.once('SIGINT', interrupted);
    console.log('READY: independently observing actual desktop video and pairing state.');
    try {
      while (Date.now() < deadline && !stopReason && matched.length < steps.length) {
        const state = await client.snapshot();
        const sample = { elapsed: Number(((Date.now() - started) / 1000).toFixed(3)), ...state };
        samples.push(sample);
        if (state.error) throw new Error(state.error);
        const expected = steps[matched.length];
        const decoded = state.readyState >= 3 && state.decodedFrames > 0;
        const match = expected === 'connected' ? state.clients > 0 :
          expected === 'play' ? decoded && !state.paused && !state.ended :
          expected === 'progress' ? playBaseline && state.currentTime - playBaseline.currentTime >= 1 && state.decodedFrames > playBaseline.decodedFrames :
          expected === 'pause' ? decoded && state.paused :
          expected === 'jump' ? previous && state.currentTime - previous.currentTime >= 7 :
          expected === 'disconnected' ? state.clients === 0 : false;
        if (match) {
          matched.push({ step: expected, ...sample });
          if (expected === 'play') playBaseline = state;
          console.log(`PASS desktop evidence: ${expected}`);
        }
        previous = state;
        if (matched.length < steps.length) await sleep(interval);
      }
    } finally {
      process.removeListener('SIGTERM', interrupted); process.removeListener('SIGINT', interrupted);
      const passed = matched.length === steps.length;
      writeResult({ passed, evidence: 'Actual packaged Electron HTMLVideoElement and main-process pairing count via local CDP',
        expectedSteps: steps, matched, reason: passed ? null : stopReason || 'timeout', samples });
    }
    if (matched.length !== steps.length) throw new Error(`Desktop monitor stopped before ${steps[matched.length]}`);
    console.log('PASS: real desktop accepted the ordered mobile play, pause, seek and disconnect sequence.');
  } finally { client.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
