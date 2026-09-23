import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkerAisFeed} from '../ais.mjs';
import {AIS_AREAS} from '../../lib/vessel-store.mjs';
import {FakeSocket,position,confirmation} from './helpers.mjs';

function setup(){let now=Date.parse('2026-09-23T00:00:00Z');const feed=new WorkerAisFeed({apiKey:'never-return-this-secret',Socket:FakeSocket,now:()=>now,random:()=>1});return {feed,now:()=>now,advance:ms=>now+=ms};}
test('continuous AIS connects with no viewer and uses one geographically bounded subscription',()=>{
  const {feed,advance}=setup();feed.tick();const socket=feed.socket;socket.open();
  const subscription=JSON.parse(socket.sent[0]);assert.equal(subscription.APIKey,'never-return-this-secret');assert.deepEqual(subscription.BoundingBoxes,AIS_AREAS.map(a=>a.providerBounds));assert.ok(subscription.FilterMessageTypes.includes('StaticDataReport'));
  socket.message(confirmation);advance(120000);feed.tick();assert.equal(feed.socket,socket);assert.equal(socket.closed,false);assert.equal(feed.snapshot({touch:false}).source.compression,true);
  assert.ok(!JSON.stringify(feed.snapshot()).includes('never-return-this-secret'));assert.match(feed.diagnostics().heartbeat,/Not exposed/);feed.close();
});
test('native frames preserve provider and receipt ages; static data does not refresh position',()=>{
  const {feed,now,advance}=setup();feed.tick();const socket=feed.socket;socket.open();socket.message(confirmation);
  socket.message(position(now()-60_000));const first=feed.snapshot({touch:false}).vessels[0];assert.equal(first.ageSeconds,60);
  advance(60_000);socket.message({MessageType:'ShipStaticData',MetaData:{MMSI:123456789,time_utc:new Date(now()).toISOString()},Message:{ShipStaticData:{UserID:123456789,Type:80,Name:'TANKER'}}});
  const typed=feed.snapshot({touch:false}).vessels[0];assert.equal(typed.positionTime,first.positionTime);assert.equal(typed.ageSeconds,120);assert.equal(typed.shipTypeCode,80);
  socket.message(position(now(),{mmsi:987654321,sourceAt:null}));const receipt=feed.snapshot({touch:false}).vessels.find(v=>v.mmsi==='987654321');assert.equal(receipt.timestampBasis,'received');assert.equal(receipt.sourceAt,null);
  advance(10*60_000);assert.ok(feed.snapshot({touch:false}).vessels.every(v=>v.stale));advance(30*60_000);assert.equal(feed.snapshot({touch:false}).vessels.length,0);feed.close();
});
test('persisted AIS restores original times and independently expires static metadata',()=>{
  const {feed,now,advance}=setup();feed.tick();const socket=feed.socket;socket.open();socket.message(confirmation);
  socket.message(position(now(),{sourceAt:null}));socket.message({MessageType:'ShipStaticData',MetaData:{MMSI:123456789,time_utc:new Date(now()).toISOString()},Message:{ShipStaticData:{Type:80,Name:'TANKER'}}});
  const saved=feed.checkpoint(),original=saved.vessels[0];feed.close();advance(5*60_000);
  const restored=new WorkerAisFeed({now,Socket:FakeSocket});restored.restore(saved);const vessel=restored.snapshot({touch:false}).vessels[0];
  assert.equal(vessel.receivedAt,original.receivedAt);assert.equal(vessel.positionTime,original.positionTime);assert.equal(vessel.timestampBasis,'received');assert.equal(vessel.sourceAt,null);assert.equal(vessel.ageSeconds,300);assert.equal(vessel.shipTypeCode,80);
  advance(30*60_000);assert.equal(restored.snapshot({touch:false}).vessels.length,0);assert.equal(restored.store.static.size,1);advance(24*60*60_000);restored.snapshot({touch:false});assert.equal(restored.store.static.size,0);
});
test('silence, stale socket callbacks, backoff and proactive connection rotation are bounded',()=>{
  const {feed,now,advance}=setup();feed.tick();const first=feed.socket;first.open();first.message(confirmation);
  advance(180_000);feed.tick();assert.equal(feed.socket,null);assert.equal(feed.retryAt,now()+5000);assert.match(feed.error,/does not establish an empty waterway/);
  advance(4999);feed.tick();assert.equal(feed.socket,null);advance(1);feed.tick();const second=feed.socket;assert.notEqual(second,first);assert.equal(feed.connection,'connecting');
  first.message(position(now()));assert.equal(feed.store.vessels.size,0);second.open();second.message(confirmation);
  for(let i=0;i<13;i++){advance(60_000);second.message(position(now()));feed.tick();}
  advance(60_000);second.message(position(now()));feed.tick();assert.equal(second.closed,true);assert.equal(feed.socket,null);assert.match(feed.error,/rotating/);feed.close();
});
test('malformed, oversized, identity mismatch and outside-area frames never become vessel positions',()=>{
  const {feed,now}=setup();feed.tick();const socket=feed.socket;socket.message('bad json');socket.message('x'.repeat(1024*1024+1));
  const mismatch=position(now());mismatch.Message.PositionReport.UserID=987654321;socket.message(mismatch);socket.message(position(now(),{latitude:51,longitude:0}));
  assert.equal(feed.snapshot({touch:false}).vessels.length,0);assert.equal(feed.counts.rejected,4);feed.close();
});
