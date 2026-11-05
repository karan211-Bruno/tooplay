const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CastStream } = require('../src/main/cast-stream');
const tick = () => new Promise(resolve => setImmediate(resolve));
class FakeTranscoder {
  constructor(options) { this.options=options; this.availableDuration=0; FakeTranscoder.last=this; }
  setDuration(value) { this.duration=value; }
  start() {}
  cancel() { this.cancelled=true; return Promise.resolve(); }
  publish(seconds) { this.availableDuration=seconds; this.options.onReady(); this.options.onProgress(0.3); }
  finish(seconds) { this.availableDuration=seconds; this.options.onFinished(); }
}
function stream(t) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'tooplay-cast-test-'));
  const instance=new CastStream({ffmpeg:'unused',input:'movie.mp4',directory,duration:1000,encoder:'libx264',TranscoderType:FakeTranscoder});
  t.after(async()=>{await instance.stop();fs.rmSync(directory,{recursive:true,force:true});});
  return instance;
}

test('TV waits for eight seconds and encodes from the requested original position',async(t)=>{
  const instance=stream(t); let settled=false;
  const preparation=instance.prepare(340).then(value=>{settled=true;return value;}); await tick();
  const job=FakeTranscoder.last; assert.equal(job.options.purpose,'cast'); assert.equal(job.options.startTime,340); assert.equal(job.duration,660);
  job.publish(2); await tick(); assert.equal(settled,false);
  job.publish(8); const ready=await preparation; assert.equal(ready.offset,340); assert.equal(instance.canSeek(344),true); assert.equal(instance.canSeek(330),false); assert.equal(instance.canSeek(500),false);
});

test('short clips wait for completed output and can still start',async(t)=>{
  const instance=stream(t); const preparation=instance.prepare(998);await tick();
  FakeTranscoder.last.finish(2); const ready=await preparation;assert.equal(ready.offset,998);assert.equal(ready.finished,true);
});

test('stopping while buffering cancels both readiness and ffmpeg',async(t)=>{
  const instance=stream(t);const preparation=instance.prepare();const rejected=assert.rejects(preparation,{code:'ABORT_ERR'});await tick();
  const job=FakeTranscoder.last;await instance.stop();await rejected;assert.equal(job.cancelled,true);assert.equal(instance.current,null);
});

test('seeking outside the generated window cancels the old encoder and retires its files after loading',async(t)=>{
  const instance=stream(t);const first=instance.prepare(30);await tick();FakeTranscoder.last.publish(8);const previous=await first;
  const job=FakeTranscoder.last;const next=instance.prepare(600);await tick();assert.equal(job.cancelled,true);FakeTranscoder.last.publish(8);const current=await next;
  assert.notEqual(previous.name,current.name);assert.equal(fs.existsSync(previous.directory),true);
  instance.releaseRetired();assert.equal(fs.existsSync(previous.directory),false);assert.equal(fs.existsSync(current.directory),true);
});
