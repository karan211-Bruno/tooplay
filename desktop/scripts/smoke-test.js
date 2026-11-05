const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const { spawn, execFileSync } = require('child_process');
const { ffmpegPath } = require('../src/main/binaries');

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, message, timeout = 45000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await pause(150); }
  throw new Error(`Timed out: ${message}`);
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tooplay-smoke-'));
  let child, socket;
  let diagnostics = async () => null;
  try {
    const ffmpeg = process.env.TOOPLAY_FIXTURE_FFMPEG || ffmpegPath();
    assert.ok(ffmpeg, 'Bundled ffmpeg is present');
    const source = path.join(dir, 'movie.mp4');
    const subtitle = path.join(dir, 'movie.ko.srt');
    const manual = path.join(dir, 'manual.srt');
    fs.writeFileSync(subtitle, '1\n00:00:00,000 --> 00:00:05,000\n외부 한국어 자막\n\n2\n00:00:05,000 --> 00:00:12,000\n두 번째 자막\n');
    fs.writeFileSync(manual, '1\n00:00:00,000 --> 00:00:12,000\n수동 자막\n');
    const run = (args) => execFileSync(ffmpeg, ['-v', 'error', '-nostdin', '-y', ...args], { timeout: 60000, stdio: 'pipe' });
    run(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
      '-t', '12', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source]);
    run(['-i', source, '-i', subtitle, '-map', '0:v', '-map', '0:a', '-map', '1:0', '-c:v', 'copy', '-c:a', 'copy', '-c:s', 'ass', path.join(dir, 'embedded.mkv')]);
    run(['-i', source, '-c:v', 'mpeg4', '-q:v', '5', '-c:a', 'aac', path.join(dir, 'legacy.mp4')]);
    run(['-stream_loop', '39', '-i', source, '-t', '480', '-c', 'copy', path.join(dir, 'progressive.mkv')]);
    fs.writeFileSync(path.join(dir, 'broken.mp4'), 'not a video');
    const executable = process.env.TOOPLAY_APP || require('electron');
    const root = path.join(__dirname, '..');
    const args = process.env.TOOPLAY_APP ? [] : [root];
    const listener = net.createServer();
    await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
    const debugPort = listener.address().port;
    await new Promise((resolve) => listener.close(resolve));
    args.push(`--remote-debugging-port=${debugPort}`, '--remote-debugging-address=127.0.0.1', `--user-data-dir=${path.join(dir, 'profile')}`);
    const launchEnv = { ...process.env };
    delete launchEnv.ELECTRON_RUN_AS_NODE;
    delete launchEnv.FFMPEG_BIN;
    if (process.platform === 'darwin') launchEnv.PATH = '/usr/bin:/bin';
    child = spawn(executable, args, { env: launchEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let logs = '';
    child.on('error', (error)=>console.error('Electron launch:',error));
    child.stderr.on('data', (data) => { logs += data; if (process.env.TOOPLAY_DEBUG) process.stderr.write(data); });
    child.stdout.on('data', (data) => { logs += data; });
    console.log('Launching Electron playback checks…');
    await until(() => {
      if (child.exitCode !== null || child.signalCode) throw new Error(`App exited ${child.exitCode || child.signalCode}: ${logs}`);
      return /DevTools listening on ws:\/\/127.0.0.1:(\d+)/.test(logs);
    }, 'Electron debugger', 120000);
    const port = logs.match(/DevTools listening on ws:\/\/127.0.0.1:(\d+)/)[1];
    let target;
    await until(async () => {
      const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
      target = pages.find((entry) => entry.type === 'page' && /index.html/.test(entry.url));
      return target;
    }, 'renderer');
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, {once:true}); socket.addEventListener('error', reject, {once:true}); });
    let sequence = 0;
    const pending = new Map();
    socket.addEventListener('message', ({data}) => {
      const message = JSON.parse(data);
      if (pending.has(message.id)) {
        const {resolve,reject,timer} = pending.get(message.id); clearTimeout(timer); pending.delete(message.id);
        message.error ? reject(new Error(message.error.message)) : resolve(message.result);
      }
    });
    const cdp = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {pending.delete(id); reject(new Error(`CDP timeout: ${method}`));},45000);
      pending.set(id,{resolve,reject,timer}); socket.send(JSON.stringify({id,method,params}));
    });
    const evaluate = async (expression, userGesture = false) => {
      const result = await cdp('Runtime.evaluate',{expression, awaitPromise:true, returnByValue:true, userGesture});
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception.description);
      return result.result.value;
    };
    await until(() => evaluate('Boolean(window.tooplay)'), 'preload bridge');
    await until(() => evaluate('document.getElementById("platformNote")?.textContent.includes("Chromecast")'), 'renderer initialized');
    await evaluate(`window.smokeEvents = {tracks:[],statuses:[],errors:[]};
      tooplay.onSubtitleTracks(p=>smokeEvents.tracks=p.tracks);
      tooplay.onMediaStatus(p=>smokeEvents.statuses.push(p));
      tooplay.onMediaError(p=>smokeEvents.errors.push(p));`);
    diagnostics = () => evaluate(`({time:video.currentTime,duration:video.duration,paused:video.paused,ready:video.readyState,seekable:Array.from({length:video.seekable.length},(_,i)=>[video.seekable.start(i),video.seekable.end(i)]),buffered:Array.from({length:video.buffered.length},(_,i)=>[video.buffered.start(i),video.buffered.end(i)]),error:document.getElementById("errorMessage").textContent,hlsLogs:window.smokeHlsLogs,events:smokeEvents})`);
    const videoState = () => evaluate(`({ time: video.currentTime, duration: video.duration, ready: video.readyState, paused: video.paused, error: video.error && video.error.message })`);
    if (process.env.TOOPLAY_REMOTE_FIXTURE) {
      const fixturePath = process.env.TOOPLAY_REMOTE_FIXTURE;
      await evaluate(`tooplay.openMedia(${JSON.stringify(source)})`);
      await until(async () => (await videoState()).ready >= 3, 'mobile integration movie');
      await evaluate('video.pause();document.getElementById("remoteBtn").click()');
      await until(() => evaluate('document.getElementById("remoteDialog").open'), 'mobile integration pairing');
      const deadline = Date.now() + 20 * 60000;
      while (!fs.existsSync(fixturePath + '.done') && Date.now() < deadline) {
        let info = await evaluate('tooplay.remoteInfo()');
        if (!info.clients && (!info.code || info.expiresAt - Date.now() < 20000)) info = await evaluate('tooplay.remoteRenew()');
        fs.writeFileSync(fixturePath, JSON.stringify({address:info.url,code:info.code,clients:info.clients,debuggerURL:target.webSocketDebuggerUrl,source,subtitle}), {mode:0o600});
        await pause(1000);
      }
      await evaluate('tooplay.remoteStop();tooplay.stopMedia()');
      fs.rmSync(fixturePath,{force:true});fs.rmSync(fixturePath+'.done',{force:true});
      console.log('Mobile integration desktop closed.');
      return;
    }
    let opened = await evaluate(`tooplay.openMedia(${JSON.stringify(source)})`);
    assert.equal(opened.mode,'direct');
    await until(async () => (await videoState()).ready >= 3, 'MP4 decoded frames');
    await until(async () => (await evaluate('smokeEvents.tracks.length')) >= 1, 'external subtitle');
    await evaluate('video.currentTime=1; video.pause()');
    await until(() => evaluate('subtitleLayer.textContent.includes("외부 한국어 자막")'), 'Korean overlay');
    await evaluate('document.getElementById("playBtn").click()');
    await until(async () => !(await videoState()).paused, 'play');
    await evaluate('document.getElementById("playBtn").click()');
    await until(async () => (await videoState()).paused, 'pause');
    await evaluate('const range=document.getElementById("seek");range.value="7";range.dispatchEvent(new Event("change"));');
    await until(async () => Math.abs((await videoState()).time - 7) < 0.6, 'seek');
    await until(() => evaluate('subtitleLayer.textContent.includes("두 번째 자막")'), 'subtitle after seeking');
    await evaluate('document.getElementById("subtitleBtn").click()');
    assert.equal(await evaluate('document.getElementById("subtitleMenu").classList.contains("hidden")'), false);
    await evaluate('document.querySelector("#subtitleMenu .menu-item").click()');
    assert.equal(await evaluate('subtitleLayer.textContent'), '');
    await evaluate(`tooplay.addSubtitle(${JSON.stringify(manual)})`);
    await until(() => evaluate('subtitleLayer.textContent.includes("수동 자막")'), 'manual subtitle');

    // Actual HTTP -> main process -> renderer -> decoded media, without controlling a TV.
    await evaluate('document.getElementById("remoteBtn").click()');
    await until(() => evaluate('document.getElementById("remoteDialog").open'), 'pairing dialog');
    const pairing = await evaluate('tooplay.remoteInfo()');
    const remoteURL = new URL(pairing.url); remoteURL.hostname = '127.0.0.1';
    const remoteBase = remoteURL.origin;
    assert.equal((await fetch(`${remoteBase}/api/state`)).status, 401);
    const paired = await fetch(`${remoteBase}/api/pair`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:pairing.code,name:'Smoke test'})}).then(r=>r.json());
    assert.match(paired.token,/^[a-f0-9]{64}$/);
    const headers = {Authorization:`Bearer ${paired.token}`,'Content-Type':'application/json'};
    const remoteState = () => fetch(`${remoteBase}/api/state`,{headers}).then(r=>r.json());
    const remoteCommand = async body => {
      const response = await fetch(`${remoteBase}/api/command`,{method:'POST',headers,body:JSON.stringify(body)});
      const result = await response.json(); assert.ok(response.ok, JSON.stringify(result));
    };
    await until(async () => (await remoteState()).hasMedia, 'remote media state');
    assert.equal((await remoteState()).title, 'movie.mp4');
    await remoteCommand({command:'play'}); await until(async () => !(await videoState()).paused, 'remote play');
    await remoteCommand({command:'pause'}); await until(async () => (await videoState()).paused, 'remote pause');
    await remoteCommand({command:'seek',value:7}); await until(async () => Math.abs((await videoState()).time-7)<0.6,'remote seek');
    await until(async () => !(await remoteState()).preparing, 'remote seek complete');
    await remoteCommand({command:'volume',value:0.35}); assert.equal(await evaluate('video.volume'),0.35);
    await remoteCommand({command:'subtitle',trackId:null}); assert.equal(await evaluate('subtitleLayer.textContent'),'');
    const remoteTracks=(await remoteState()).subtitles;
    await remoteCommand({command:'subtitle',trackId:remoteTracks.at(-1).id});
    await until(() => evaluate('subtitleLayer.textContent.includes("수동 자막")'), 'remote subtitle');
    await remoteCommand({command:'cast-connect',deviceId:'nonexistent-smoke-device'});
    await until(async () => !!(await remoteState()).lastError,'remote asynchronous error');
    await evaluate('document.getElementById("remoteDisable").click()');
    await until(async () => !(await evaluate('tooplay.remoteInfo()')).enabled,'remote off');
    await evaluate('document.getElementById("remoteClose").click()');
    console.log('PASS: paired remote controls real playback, seek, volume, subtitles, errors and revocation.');
    await evaluate('document.getElementById("fullscreenBtn").click()', true);
    await until(() => evaluate('Boolean(document.fullscreenElement)'), 'fullscreen');
    await evaluate('document.exitFullscreen()');
    await pause(1000);
    await evaluate('document.getElementById("castBtn").click()');
    assert.equal(await evaluate('document.getElementById("castMenu").classList.contains("hidden")'), false);
    console.log('PASS MP4, Korean subtitles, manual subtitles, play/pause, seeking, fullscreen, Cast menu');

    await evaluate(`window.smokeHlsLogs=[]; const BaseHls=window.Hls; window.Hls=class extends BaseHls {
      constructor(options) { const logger={}; for(const key of ['trace','debug','log','warn','error','info']) logger[key]=(...args)=>smokeHlsLogs.push(args.join(' '));
        super({...options,debug:logger}); window.smokeHls=this; }
    };`);
    opened = await evaluate(`tooplay.openMedia(${JSON.stringify(path.join(dir,'embedded.mkv'))})`);
    assert.equal(opened.mode,'hls');
    await until(async () => (await videoState()).ready >= 3, 'MKV HLS decoding');
    await until(() => evaluate('smokeEvents.tracks.some(t=>t.origin==="embedded")'), 'embedded ASS extraction');
    await until(() => evaluate('smokeEvents.statuses.some(s=>s.phase==="finishing")'), 'HLS completion');
    assert.equal(await evaluate('document.getElementById("duration").textContent'), '0:12');
    await evaluate('video.pause(); const hlsSeek=document.getElementById("seek");hlsSeek.value="7";hlsSeek.dispatchEvent(new Event("change"));');
    await until(async () => Math.abs((await videoState()).time-7)<0.6, 'HLS seek', 7000);
    console.log('PASS MKV HLS, embedded ASS, duration, seeking');

    await evaluate('smokeEvents.statuses=[]');
    opened = await evaluate(`tooplay.openMedia(${JSON.stringify(path.join(dir,'progressive.mkv'))})`);
    await until(async () => (await videoState()).ready >= 3, 'progressive HLS decoding');
    assert.equal(await evaluate('document.getElementById("duration").textContent'), '8:00');
    const converting = await evaluate('!smokeEvents.statuses.some(s=>s.phase==="finishing")');
    assert.equal(converting,true,'Long-video check must run while transcoding');
    await evaluate('video.pause(); const longSeek=document.getElementById("seek");longSeek.value="475";longSeek.dispatchEvent(new Event("change"));');
    assert.ok((await videoState()).time < 475, 'Unconverted seeks are limited to completed segments');
    assert.ok(await evaluate('document.getElementById("toast").textContent.includes("아직 변환")'));
    await evaluate('tooplay.stopMedia()');
    console.log('PASS 8-minute progressive HLS, full duration, unconverted seek guard and cancellation');

    opened = await evaluate(`tooplay.openMedia(${JSON.stringify(path.join(dir,'legacy.mp4'))})`);
    assert.equal(opened.mode,'hls');
    await until(async () => (await videoState()).ready >= 3, 'MPEG4-in-MP4 conversion');
    console.log('PASS unsupported MP4 codec conversion');
    await evaluate(`Promise.all([tooplay.openMedia(${JSON.stringify(path.join(dir,'embedded.mkv'))}), tooplay.openMedia(${JSON.stringify(source)})])`);
    await until(async () => (await videoState()).ready >= 3, 'rapid media replacement');
    await evaluate('tooplay.stopMedia()');
    await until(() => evaluate('!document.getElementById("emptyState").classList.contains("hidden")'), 'stop reset');
    await evaluate(`tooplay.openMedia(${JSON.stringify(path.join(dir,'broken.mp4'))}).then(()=>{throw Error('Should fail')},()=>true)`);
    await evaluate(`tooplay.openMedia(${JSON.stringify(source)})`);
    await until(async () => (await videoState()).ready >= 3, 'recovery after invalid file');
    console.log('PASS media replacement, stop/cancellation, invalid file recovery');
    assert.deepEqual(await evaluate('smokeEvents.errors'), []);
    if (process.env.TOOPLAY_SCREENSHOT) {
      await evaluate('video.pause();video.currentTime=1;'); await pause(300);
      const capture = await cdp('Page.captureScreenshot',{format:'png'});
      fs.writeFileSync(process.env.TOOPLAY_SCREENSHOT, Buffer.from(capture.data,'base64'));
    }
    await evaluate('tooplay.stopMedia()');
    console.log('All Electron playback smoke checks passed.');
  } catch (error) {
    try { console.error(JSON.stringify(await diagnostics())); } catch {}
    throw error;
  } finally {
    if(socket) socket.close();
    if(child && child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([new Promise((resolve)=>child.once('exit',resolve)),pause(5000)]);
      if(child.exitCode === null) child.kill('SIGKILL');
    }
    fs.rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:200});
  }
}
main().catch((error)=>{console.error(error);process.exitCode=1;});
