// Byte-accurate network-budget regression. This is not a physical Chromecast test.
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { Transcoder, detectEncoder } = require(process.env.TOOPLAY_TRANSCODER || '../src/main/transcoder');
const { MediaServer } = require('../src/main/server');

async function main() {
  const ffmpeg = process.env.TOOPLAY_FFMPEG || require('../src/main/binaries').ffmpegPath();
  const fixture = path.join(os.tmpdir(), 'tooplay-cast-1080p60-fixture.mkv');
  if (!fs.existsSync(fixture)) execFileSync(ffmpeg, ['-v','error','-nostdin','-y','-f','lavfi','-i',
    'testsrc2=size=1920x1080:rate=60','-t','12','-c:v','libx264','-preset','ultrafast','-crf','18',fixture], {timeout:60000});
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tooplay-cast-budget-'));
  const server = new MediaServer();
  let job;
  try {
    await new Promise(async (resolve, reject) => {
      job = new Transcoder({ffmpeg,input:fixture,outputDirectory:directory,
        encoder:await detectEncoder(ffmpeg),purpose:'cast',onFinished:resolve,onError:reject});
      job.setDuration(12); job.start();
    });
    server.addDirectory('/cast/', directory);
    const port = await server.start();
    const playlist = await fetch(`http://127.0.0.1:${port}/cast/index.m3u8`).then(r=>r.text());
    const entries = [...playlist.matchAll(/#EXTINF:([\d.]+),[^\n]*\n([^#\n]+\.ts)/g)];
    const segments=[];
    for (const [,duration,file] of entries) {
      const response=await fetch(`http://127.0.0.1:${port}/cast/${file}`);
      assert.equal(response.status,200);
      segments.push({duration:Number(duration),bits:(await response.arrayBuffer()).byteLength*8});
    }
    const ffprobe = require('../src/main/binaries').ffprobePath();
    const first = path.join(directory, entries[0][2]);
    const info = JSON.parse(execFileSync(ffprobe, ['-v','error','-select_streams','v:0','-show_entries','stream=width,height,avg_frame_rate,profile,level','-of','json',first], {encoding:'utf8'})).streams[0];
    const [numerator,denominator] = info.avg_frame_rate.split('/').map(Number);
    const bits=segments.reduce((sum,s)=>sum+s.bits,0);
    const duration=segments.reduce((sum,s)=>sum+s.duration,0);
    const sourceMbps=bits/duration/1e6;
    // Replay these exact HTTP-delivered segments for ten minutes on a 5 Mbps link.
    const linkMbps=5, initialBuffer=60, step=0.1;
    let buffer=initialBuffer, credit=0, next=0, delay=0, firstUnderrun=null;
    for(let elapsed=0;elapsed<600;elapsed+=step) {
      const played=Math.min(step,buffer);buffer-=played;
      if(played<step) { delay+=step-played;if(firstUnderrun===null) firstUnderrun=elapsed; }
      credit+=linkMbps*1e6*step;
      while(buffer<initialBuffer && credit>=segments[next%segments.length].bits) {
        const fragment=segments[next++%segments.length];credit-=fragment.bits;buffer=Math.min(initialBuffer,buffer+fragment.duration);
      }
      if(buffer>=initialBuffer) credit=0;
    }
    const result={sourceMbps:Number(sourceMbps.toFixed(3)),linkMbps,bufferedAtTenMinutes:Number(buffer.toFixed(1)),
      firstBufferUnderrunSeconds:firstUnderrun===null ? null : Number(firstUnderrun.toFixed(1)),
      accumulatedDelaySeconds:Number(delay.toFixed(1)),segments:segments.length};
    console.log(JSON.stringify({...result,width:info.width,height:info.height,fps:numerator/denominator,profile:info.profile,level:info.level}));
    assert.ok(firstUnderrun===null && delay<1,'TV stream drains its initial buffer and accumulates delay over time');
    assert.ok(info.width<=1280 && info.height<=720 && numerator/denominator<=30);
    assert.equal(info.profile,'Main'); assert.equal(info.level,31);
    console.log('PASS: ten-minute network-budget replay has no growing buffering delay.');
  } finally { if(job) await job.cancel(); server.stop(); fs.rmSync(directory,{recursive:true,force:true}); }
}
main().catch(error=>{console.error(error.message || error);process.exitCode=1;});
