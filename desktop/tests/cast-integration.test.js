const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { Module, createRequire } = require('module');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ffmpegPath, ffprobePath } = require('../src/main/binaries');

// Exercise the actual main-process IPC, encoder, HTTP server and VTT conversion.
// Only the Electron shell and unavailable physical Cast receiver are replaced.
test('Cast uses a buffered, bounded stream even for direct MP4; seeks and subtitles retain original time', {timeout:60000}, async(t) => {
  const ffmpeg=ffmpegPath(), ffprobe=ffprobePath();
  if(!ffmpeg || !ffprobe) return t.skip('ffmpeg and ffprobe are required');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'tooplay-cast-integration-'));
  const file=path.join(directory,'movie.mp4');
  execFileSync(ffmpeg,['-v','error','-nostdin','-y','-f','lavfi','-i','testsrc2=size=320x180:rate=60','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','16',
    '-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac',file],{timeout:30000});
  const subtitle=path.join(directory,'movie.ko.srt');fs.writeFileSync(subtitle,'1\n00:00:03,000 --> 00:00:09,000\n한국어 자막\n');
  const handlers=new Map(), messages=[];
  const app=new EventEmitter();Object.assign(app,{commandLine:{appendSwitch(){}},requestSingleInstanceLock:()=>true,
    whenReady:()=>Promise.resolve(),quit(){},getVersion:()=> '0.2.1',isReady:()=>true});
  class Window extends EventEmitter {
    constructor(){super();this.webContents={send:(channel,payload)=>messages.push({channel,payload}),setWindowOpenHandler(){}};}
    loadFile(){} isDestroyed(){return false;}
    static getAllWindows(){return [];}
  }
  let manager;
  class Receiver extends EventEmitter {
    constructor(){super();manager=this;this.loads=[];this.client=null;this.lastStatus=null;}
    getDevice(id){return {id,name:'Test receiver',host:'192.0.2.3',port:8009};}
    async connect(device,media,options){this.client={};this.loads.push({media,options});this.lastStatus={playerState:'PAUSED',currentTime:0,duration:media.duration};this.emit('status',this.lastStatus);}
    seek(value,callback){this.seekValue=value;callback();}
    play(callback){callback(this.controlError);}
    pause(callback){callback(this.controlError);}
    setVolume(value,callback){this.volume=value;callback(this.controlError);}
    async reloadTracks(tracks,active){this.loadedTracks={tracks,active};}
    stop(){this.client=null;this.emit('stopped');}
    dispose(){this.stop();} startDiscovery(){} stopDiscovery(){}
  }
  const filename=path.join(__dirname,'../src/main/main.js');
  const requireFromMain=createRequire(filename);
  const main=new Module(filename);main.filename=filename;main.paths=Module._nodeModulePaths(path.dirname(filename));
  main.require=(name)=>{
    if(name==='electron')return {app,BrowserWindow:Window,Menu:{buildFromTemplate:()=>({}),setApplicationMenu(){}},
      ipcMain:{handle:(channel,handler)=>handlers.set(channel,handler)},dialog:{},shell:{}};
    if(name==='./cast')return {CastManager:Receiver};
    if(name==='os')return {...os,networkInterfaces:()=>({en0:[{family:'IPv4',internal:false,address:'192.0.2.2'}]})};
    return requireFromMain(name);
  };
  main._compile(fs.readFileSync(filename,'utf8'),filename);
  await new Promise(resolve=>setImmediate(resolve));
  const invoke=(channel,...args)=>handlers.get(channel)({},...args);
  t.after(async()=>{await invoke('media:stop');await new Promise(resolve=>setTimeout(resolve,100));fs.rmSync(directory,{recursive:true,force:true});});
  const opened=await invoke('media:open',file);assert.equal(opened.mode,'direct');
  const result=await invoke('cast:connect','tv',{currentTime:2,autoplay:false});
  manager.controlError=new Error('receiver unavailable');
  for(const name of ['cast:play','cast:pause','cast:volume']) await assert.rejects(invoke(name,0.5),/receiver unavailable/);
  manager.controlError=null;
  await invoke('cast:play');await invoke('cast:pause');await invoke('cast:volume',0.25);assert.equal(manager.volume,0.25);
  assert.equal(result.currentTime,2);assert.equal(result.duration,16);
  const load=manager.loads.at(-1);assert.match(load.media.contentId,/\/cast\/stream-\d+\/index.m3u8$/);
  assert.equal(load.options.currentTime,0);assert.equal(load.options.autoplay,false);
  assert.equal(load.media.duration,14);
  const local=(url)=>{const parsed=new URL(url);parsed.hostname='127.0.0.1';return parsed.href;};
  const playlist=await fetch(local(load.media.contentId)).then(r=>r.text());
  const seconds=[...playlist.matchAll(/#EXTINF:([\d.]+)/g)].reduce((sum,m)=>sum+Number(m[1]),0);
  assert.ok(seconds>=8,'TV must have eight complete seconds before LOAD');
  const vtt=await fetch(local(load.media.tracks[0].trackContentId)).then(r=>r.text());
  assert.match(vtt,/00:00:01.000 --> 00:00:07.000/);
  const status=messages.filter(m=>m.channel==='cast:status').at(-1).payload;
  assert.equal(status.currentTime,2);assert.equal(status.duration,16);
  await invoke('cast:seek',6);assert.equal(manager.seekValue,4);
  const restarted=await invoke('cast:seek',1);assert.equal(restarted.currentTime,1);assert.equal(manager.loads.length,2);
  const reloaded=manager.loads.at(-1);assert.notEqual(reloaded.media.contentId,load.media.contentId);
  const nextVtt=await fetch(local(reloaded.media.tracks[0].trackContentId)).then(r=>r.text());
  assert.match(nextVtt,/00:00:02.000 --> 00:00:08.000/);
  const extra=path.join(directory,'extra.srt');fs.writeFileSync(extra,'1\n00:00:04,000 --> 00:00:10,000\n추가 자막\n');
  await invoke('subtitle:add',extra);assert.equal(manager.loadedTracks.tracks.length,2);
  const added=await fetch(local(manager.loadedTracks.tracks.at(-1).trackContentId)).then(r=>r.text());
  assert.match(added,/00:00:03.000 --> 00:00:09.000/);
  await invoke('cast:stop');assert.equal(manager.client,null);
  const pending=invoke('cast:connect','tv',{currentTime:0});
  const rejected=assert.rejects(pending,/취소/);
  await invoke('cast:stop');await rejected;
});
