const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Transcoder } = require('../src/main/transcoder');
const { canPlayDirect } = require('../src/main/media-info');

test('codec compatibility is checked inside MP4 containers', () => {
  const media=(codec,pix_fmt='yuv420p',audio='aac')=>({streams:[{codec_type:'video',codec_name:codec,pix_fmt},{codec_type:'audio',codec_name:audio}]});
  assert.equal(canPlayDirect('mp4',media('h264')),true);
  assert.equal(canPlayDirect('mp4',media('hevc')),false);
  assert.equal(canPlayDirect('mp4',media('h264','yuv420p10le')),false);
  assert.equal(canPlayDirect('mp4',media('h264','yuv420p','ac3')),false);
  assert.equal(canPlayDirect('mkv',media('h264')),false);
});

test('conversion failure after first playable segment is still an error', () => {
  let finished=false, message='';
  const job=new Transcoder({onFinished:()=>finished=true,onError:(value)=>message=value});
  job.ready=true; job.handleClose(1);
  assert.equal(finished,false); assert.match(message,/실패/);
});

test('a successful process without a playlist is an error', (t) => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tooplay-no-playlist-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  let message=''; const job=new Transcoder({outputDirectory:dir,onError:(value)=>message=value}); job.handleClose(0);
  assert.match(message,/스트림이 없습니다/);
});

test('playlist progress counts only completed segments', (t) => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tooplay-playlist-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.writeFileSync(path.join(dir,'index.m3u8'),'#EXTM3U\n#EXTINF:2.0,\nseg0.ts\n');
  let ready=0; const job=new Transcoder({outputDirectory:dir,onReady:()=>ready++}); job.checkPlaylist();
  fs.appendFileSync(path.join(dir,'index.m3u8'),'#EXTINF:1.5,\nseg1.ts\n'); job.checkPlaylist();
  assert.equal(job.availableDuration,3.5); assert.equal(ready,1);
});
