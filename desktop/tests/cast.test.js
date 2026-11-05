const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { CastManager } = require('../src/main/cast');
class FakePlayer extends EventEmitter {
  constructor() { super(); this.media={currentSession:null}; this.loads=[]; this.status={mediaSessionId:1,playerState:'PAUSED',currentTime:42}; }
  load(media, options, cb) { this.loads.push({media,options}); this.loadCallback=cb; queueMicrotask(()=>cb(null,this.status)); }
  getStatus(cb) { cb(null,this.status); }
  stop(cb) { this.stopCallback=cb; }
  pause(cb) { cb(); }
}
class FakeClient extends EventEmitter {
  static instances=[];
  constructor() { super(); FakeClient.instances.push(this); this.player=new FakePlayer(); }
  connect(options,cb) { this.options=options; this.connected=cb; if(!FakeClient.hold) queueMicrotask(cb); }
  launch(app,cb) { cb(null,this.player); }
  close() { this.closed=true; this.emit('close'); }
  stop(player,cb) { cb(); }
}
const device={host:'192.0.2.1',port:9000};

test('Cast honors port, playback position, pause and initializes media session', async(t)=>{
  const manager=new CastManager({ClientType:FakeClient}); t.after(()=>manager.dispose());
  await manager.connect(device,{duration:100},{currentTime:42,autoplay:false,activeTrackIds:[1]});
  assert.deepEqual(manager.client.options,{host:device.host,port:9000});
  assert.equal(manager.player.loads[0].options.currentTime,42);
  assert.equal(manager.player.loads[0].options.autoplay,false);
  assert.equal(manager.player.media.currentSession.mediaSessionId,1);
  await manager.reloadTracks([{trackId:2}],[2]);
  assert.equal(manager.player.loads[1].options.currentTime,42);
  assert.equal(manager.player.loads[1].options.autoplay,false);
});

test('disconnect rejects pending connection promptly',async()=>{
  FakeClient.hold=true;
  const manager=new CastManager({ClientType:FakeClient});
  const pending=manager.connect(device,{}); manager.disconnect();
  await assert.rejects(pending,/취소/); FakeClient.hold=false;
});

test('late stop callbacks never close a new TV connection',async(t)=>{
  const manager=new CastManager({ClientType:FakeClient}); t.after(()=>manager.dispose());
  await manager.connect(device,{}); const previous=manager.client; const player=manager.player;
  manager.stop(); await manager.connect(device,{}); const next=manager.client;
  player.stopCallback(); assert.equal(manager.client,next); assert.equal(next.closed,undefined); assert.equal(previous.closed,true);
});

test('runtime socket errors close the client and stop polling',async()=>{
  const manager=new CastManager({ClientType:FakeClient}); manager.on('error',()=>{});
  await manager.connect(device,{}); const client=manager.client; client.emit('error',new Error('lost network'));
  assert.equal(manager.client,null); assert.equal(manager.pollTimer,null); assert.equal(client.closed,true);
});

test('connection timeout closes socket and rejects once',async()=>{
  FakeClient.hold=true; const manager=new CastManager({ClientType:FakeClient,connectionTimeout:15});
  const pending=manager.connect(device,{}); const client=manager.client;
  await assert.rejects(pending,/초과/); assert.equal(client.closed,true); FakeClient.hold=false;
});


test('mDNS socket errors are reported and refresh survives stopping playback', async(t)=>{
  class FakeBonjour {
    constructor() { this.server={mdns:new EventEmitter()}; this.browser=new EventEmitter(); this.browser.update=()=>this.updates++; this.browser.stop=()=>{}; this.updates=0; }
    find() { return this.browser; }
    destroy() {}
  }
  const manager=new CastManager({ClientType:FakeClient,BonjourType:FakeBonjour}); t.after(()=>manager.dispose());
  const errors=[]; manager.on('error',(message)=>errors.push(message)); manager.startDiscovery();
  manager.bonjour.server.mdns.emit('error',new Error('permission denied'));
  assert.match(errors[0],/permission denied/);
  const refresh=manager.refreshTimer; manager.stop(); assert.equal(manager.refreshTimer,refresh);
  manager.startDiscovery(); assert.equal(manager.bonjour.updates,2);
});
