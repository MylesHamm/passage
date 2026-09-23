import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { parseEIAApi } from '../lib/eia.mjs';
import { VesselStore, AisFeed, EXPIRE_MS, STALE_MS, STATIC_EXPIRE_MS } from '../lib/ais.mjs';
import { parseOpenWaters } from '../lib/openwaters.mjs';
const now = Date.parse('2026-09-13T17:00:00Z');
const row = (period, value, extra = {}) => ({ period, value, series: 'RBRTE', units: '$/BBL', ...extra });
const payload = data => ({ response: { frequency: 'daily', data }, request: { params: { api_key: 'TEST-SECRET-DO-NOT-EXPORT' } } });
const report = (extra = {}, meta = {}, type = 'PositionReport') => ({ MessageType: type, MetaData: { MMSI: 123456789, ShipName: 'TEST VESSEL', time_utc: '2026-09-13 17:00:00.123 +0000 UTC', ...meta }, Message: { [type]: { UserID: 123456789, Valid: true, Latitude: 12.7, Longitude: 43.5, Sog: 10.1, Cog: 30.1, TrueHeading: 30, ...extra } } });

test('EIA retains only valid daily prices and never echoed request credentials', () => {
  const parsed = parseEIAApi(payload([row('2026-09-12','105.2'),row('2026-09-11',-3),row('2026-09-10',null),row('2026-09-09',''),row('2026-09-08','NA'),row('2026-09-31',2),row('2026-09-14',1),row('2026-09-11',-3)]), 'RBRTE', now);
  assert.deepEqual(parsed.observations, [{ date: '2026-09-11', value: -3 }, { date: '2026-09-12', value: 105.2 }]);
  assert.ok(!JSON.stringify(parsed).includes('TEST-SECRET'));
  assert.throws(() => parseEIAApi(payload([row('2026-09-12',100,{series:'RWTC'})]), 'RBRTE', now));
  assert.throws(() => parseEIAApi(payload([row('2026-09-12',100,{units:'EUR'})]), 'RBRTE', now));
  assert.throws(() => parseEIAApi({response:{frequency:'monthly',data:[]}}, 'RBRTE', now));
});

test('AIS supports all position types, normalizes timestamps, and excludes invalid sentinels', () => {
  for (const type of ['PositionReport','StandardClassBPositionReport','ExtendedClassBPositionReport']) {
    const store = new VesselStore();
    assert.equal(store.ingest(report({Sog:102.3,Cog:360,TrueHeading:511,...(type==='ExtendedClassBPositionReport'?{Type:80}:{})},{},type),now),true);
    const v = store.snapshot(now)[0];
    assert.equal(v.sourceAt,'2026-09-13T17:00:00.123Z');
    assert.equal(v.timestampBasis,'provider');assert.equal(v.theater,'bab');
    assert.equal(v.speedKnots,null);assert.equal(v.courseDegrees,null);assert.equal(v.headingDegrees,null);assert.equal(v.shipTypeCode,type==='ExtendedClassBPositionReport'?80:null);assert.equal(v.shipType,type==='ExtendedClassBPositionReport'?'tanker':'unknown');
  }
  const store = new VesselStore();
  assert.equal(store.ingest(report({Latitude:91}),now),false);
  assert.equal(store.ingest(report({Latitude:null},{Latitude:null}),now),false);
  assert.equal(store.ingest(report({Valid:false}),now),false);
  assert.equal(store.ingest(report({UserID:987654321}),now),false);
  assert.equal(store.ingest(report({},{MMSI:'bad'}),now),false);
});

test('AIS receipt time is explicit when provider timestamp is absent', () => {
  const store = new VesselStore();
  store.ingest(report({Latitude:26,Longitude:56},{time_utc:undefined}),now);
  const v = store.snapshot(now)[0];assert.equal(v.sourceAt,null);assert.equal(v.timestampBasis,'received');assert.equal(v.positionTime,new Date(now).toISOString());assert.equal(v.theater,'hormuz');
});

test('static metadata never refreshes a position; older reports cannot replace newer ones', () => {
  const store = new VesselStore();store.ingest(report(),now);
  const first = store.snapshot(now)[0];
  store.ingest(report({},{time_utc:'2026-09-13T16:59:00Z'}),now+2000);
  assert.equal(store.snapshot(now)[0].positionTime,first.positionTime);
  store.ingest(report({Name:'TEST NEW NAME',Type:80},{ShipName:'TEST NEW NAME'},'ShipStaticData'),now+STALE_MS+1000);
  const old=store.snapshot(now+STALE_MS+1000)[0];
  assert.equal(old.stale,true);assert.equal(old.receivedAt,first.receivedAt);assert.equal(old.name,'TEST NEW NAME');assert.equal(old.shipTypeCode,80);assert.equal(old.shipType,'tanker');
  assert.equal(store.snapshot(now+EXPIRE_MS+1000).length,0);
});

test('AIS drops out-of-area and expired reports and bounds retained memory', () => {
  const store = new VesselStore({limit:1});store.ingest(report(),now);
  store.ingest(report({UserID:223456789},{MMSI:223456789}),now);
  assert.equal(store.snapshot(now).length,1);assert.equal(store.snapshot(now)[0].mmsi,'223456789');
  store.ingest(report({UserID:223456789,Latitude:50,Longitude:10},{MMSI:223456789}),now+1000);
  assert.equal(store.snapshot(now).length,0);
  assert.equal(store.ingest(report({},{time_utc:'2026-09-13T16:00:00Z'}),now),false);
});

test('Open Waters GeoJSON snapshot keeps current, in-area vessel positions',()=>{
  const payload={type:'FeatureCollection',features:[
    {id:671153100,geometry:{type:'Point',coordinates:[55.33,25.445]},properties:{mmsi:671153100,seen:'2026-09-13T16:59:30Z',type:80,sog:0.1,cog:150.7,source:'aishub'}},
    {id:123456789,geometry:{type:'Point',coordinates:[10,10]},properties:{mmsi:123456789,seen:'2026-09-13T16:59:30Z'}},
    {id:223456789,geometry:{type:'Point',coordinates:[55,25]},properties:{mmsi:223456789,seen:'2026-09-13T15:00:00Z'}},
  ]};
  const vessels=parseOpenWaters(payload,now);assert.equal(vessels.length,1);assert.equal(vessels[0].mmsi,'671153100');assert.equal(vessels[0].provider,'Open Waters');assert.equal(vessels[0].theater,'hormuz');assert.equal(vessels[0].shipTypeCode,80);assert.equal(vessels[0].shipType,'tanker');assert.equal(vessels[0].sourceAt,'2026-09-13T16:59:30.000Z');
});

class FakeSocket extends EventEmitter {
  static instances=[];
  constructor(url,options){super();this.options=options;FakeSocket.instances.push(this);}
  send(data){this.sent=JSON.parse(data);}
  terminate(){this.emit('close');}
}

test('one authenticated compressed AIS socket serves repeated snapshots without exposing its key', () => {
  FakeSocket.instances=[];
  const feed=new AisFeed({apiKey:'TEST-SECRET-KEY',Socket:FakeSocket,now:()=>now});
  try {
    assert.equal(feed.snapshot().source.connection,'connecting');feed.snapshot();
    assert.equal(FakeSocket.instances.length,1);
    const ws=FakeSocket.instances[0];assert.equal(ws.options.perMessageDeflate,true);
    ws.emit('open');assert.equal(ws.sent.APIKey,'TEST-SECRET-KEY');assert.deepEqual(ws.sent.BoundingBoxes,[[[16,41],[11,47.5]],[[28,52],[23,60]]]);assert.deepEqual(ws.sent.FilterMessageTypes,['PositionReport','StandardClassBPositionReport','ExtendedClassBPositionReport','ShipStaticData','StaticDataReport']);
    ws.emit('message',Buffer.from(JSON.stringify({MessageType:'SubscriptionConfirmation',Message:{CompressionEnabled:true}})));
    assert.equal(feed.snapshot().source.connection,'connected');assert.equal(feed.snapshot().vessels.length,0);
    ws.emit('message',Buffer.from(JSON.stringify(report())));
    const snapshot=feed.snapshot();assert.equal(snapshot.vessels.length,1);assert.equal(snapshot.source.positionFrames,1);assert.equal(snapshot.source.positionsAccepted,1);assert.ok(!JSON.stringify(snapshot).includes('TEST-SECRET'));
    ws.emit('message',Buffer.from(JSON.stringify({error:'TEST-SECRET-KEY was rejected'})));
    assert.equal(feed.snapshot().source.connection,'disconnected');assert.ok(!JSON.stringify(feed.snapshot()).includes('TEST-SECRET'));
  } finally {feed.close();}
});

test('unconfigured AIS remains explicit and does not open a connection', () => {
  FakeSocket.instances=[];const feed=new AisFeed({Socket:FakeSocket});
  try {assert.equal(feed.snapshot().configured,false);assert.equal(feed.snapshot().source.connection,'not configured');assert.equal(FakeSocket.instances.length,0);} finally {feed.close();}
});

class HeartbeatSocket extends EventEmitter {
  static instances=[];static reply=true;
  constructor(){super();HeartbeatSocket.instances.push(this);this.terminated=false;}
  send(data){this.subscription=JSON.parse(data);}
  ping(token){this.pingToken=token;if(HeartbeatSocket.reply)this.emit('pong',Buffer.from(token));}
  terminate(){this.terminated=true;this.emit('close');}
}
function heartbeatFixture(){let clock=now;HeartbeatSocket.instances=[];HeartbeatSocket.reply=true;const events=[];const feed=new AisFeed({apiKey:'AUDIT-SECRET',Socket:HeartbeatSocket,now:()=>clock,random:()=>0,onEvent:e=>events.push(e)});const confirm=()=>{const socket=HeartbeatSocket.instances.at(-1);socket.emit('open');socket.emit('message',Buffer.from(JSON.stringify({MessageType:'SubscriptionConfirmation',Message:{CompressionEnabled:true}})));return socket;};feed.snapshot();return {feed,events,confirm,advance:ms=>clock+=ms};}
test('source clock stays stale when an old provider report arrives now',()=>{
 const {feed,confirm}=heartbeatFixture();try{const socket=confirm();socket.emit('message',Buffer.from(JSON.stringify(report({},{time_utc:'2026-09-13T16:45:00Z'}))));const d=feed.snapshot();assert.equal(d.source.freshness,'stale');assert.equal(d.source.latest,'2026-09-13T16:45:00.000Z');assert.equal(d.source.lastPositionReceivedAt,'2026-09-13T17:00:00.000Z');assert.equal(d.vessels[0].stale,true);}finally{feed.close();}
});
test('healthy heartbeat with no AIS positions remains connected and observable',()=>{
 const {feed,confirm,advance}=heartbeatFixture();try{confirm();for(let i=0;i<4;i++){advance(30000);feed.snapshot();feed.tick();}const d=feed.diagnostics();assert.equal(d.connection,'connected');assert.equal(d.recordCount,0);assert.equal(d.counts.heartbeats,4);assert.equal(d.counts.heartbeatTimeouts,0);assert.equal(d.heartbeat,'verified');}finally{feed.close();}
});
test('silent socket times out and reconnects once after backoff',()=>{
 const {feed,confirm,advance,events}=heartbeatFixture();try{const socket=confirm();HeartbeatSocket.reply=false;advance(30000);feed.snapshot();feed.tick();advance(15000);feed.tick();assert.equal(socket.terminated,true);assert.equal(feed.snapshot().source.connection,'disconnected');assert.equal(HeartbeatSocket.instances.length,1);advance(1999);feed.tick();assert.equal(HeartbeatSocket.instances.length,1);advance(1);feed.tick();assert.equal(HeartbeatSocket.instances.length,2);confirm();assert.equal(feed.diagnostics().counts.reconnects,1);assert.ok(events.some(e=>e.outcome==='heartbeat_timeout'));}finally{feed.close();}
});
test('bad JSON and fallback timestamps are counted without logging content',()=>{
 const {feed,confirm}=heartbeatFixture();try{const socket=confirm();socket.emit('message',Buffer.from('BAD SECRET'));socket.emit('message',Buffer.from('null'));socket.emit('message',Buffer.from(JSON.stringify(report({},{time_utc:'2027-01-01T00:00:00Z'}))));const d=feed.snapshot();assert.equal(d.source.freshness,'unknown');assert.match(d.vessels[0].timestampNote,/invalid or in the future/);const diag=feed.diagnostics();assert.equal(diag.counts.rejected.json,1);assert.equal(diag.counts.rejected.invalid_message,1);assert.equal(diag.counts.receiptTimeFallbacks,1);assert.ok(!JSON.stringify(diag).includes('AUDIT-SECRET'));assert.ok(!JSON.stringify(diag).includes('123456789'));}finally{feed.close();}
});
test('idle disconnect, resume and diagnostics do not keep an unused stream alive',()=>{
 const {feed,confirm,advance}=heartbeatFixture();try{const socket=confirm();advance(91000);feed.diagnostics();feed.tick();assert.equal(socket.terminated,true);assert.equal(feed.snapshot({touch:false}).source.connection,'idle');feed.snapshot();assert.equal(HeartbeatSocket.instances.length,2);assert.equal(feed.snapshot({touch:false}).source.connectedAt,null);}finally{feed.close();}
});
test('provider position and source availability expire together',()=>{
 const {feed,confirm,advance}=heartbeatFixture();try{const socket=confirm();socket.emit('message',Buffer.from(JSON.stringify(report())));advance(1801000);const d=feed.snapshot({touch:false});assert.equal(d.vessels.length,0);assert.equal(d.source.recordCount,0);assert.equal(d.source.latest,null);assert.equal(d.source.freshness,'unknown');}finally{feed.close();}
});

test('AIS type comes only from the documented typed message fields',()=>{
 const store=new VesselStore();
 store.ingest(report({MessageID:1,Type:80,ShipType:80},{Type:80,ShipType:80}),now);
 assert.equal(store.snapshot(now)[0].shipType,'unknown');
 store.ingest(report({Type:80},{},'ShipStaticData'),now);
 store.ingest(report({Type:70,ShipType:70}),now+1000);
 let vessel=store.snapshot(now+1000)[0];
 assert.equal(vessel.shipType,'tanker');assert.equal(vessel.shipTypeMessage,'ShipStaticData');assert.equal(vessel.shipTypeProvider,'AISStream');
 store.ingest(report({Name:'CLASS B',Type:70},{time_utc:'2026-09-13T17:00:02Z'},'ExtendedClassBPositionReport'),now+2000);
 vessel=store.snapshot(now+2000)[0];assert.equal(vessel.shipType,'cargo');assert.equal(vessel.name,'CLASS B');assert.equal(vessel.shipTypeMessage,'ExtendedClassBPositionReport');
});
test('AIS class B partial metadata preserves separate fields and checks nested validation',()=>{
 const store=new VesselStore();
 store.ingest(report({ReportA:{Valid:true,Name:'B CLASS'},ReportB:{Valid:false,ShipType:80}},{},'StaticDataReport'),now);
 store.ingest(report(),now);
 assert.equal(store.snapshot(now)[0].name,'B CLASS');assert.equal(store.snapshot(now)[0].shipType,'unknown');
 store.ingest(report({ReportA:{Valid:false,Name:'BAD NAME'},ReportB:{Valid:true,ShipType:80}},{time_utc:'2026-09-13T17:00:01Z'},'StaticDataReport'),now+1000);
 const vessel=store.snapshot(now+1000)[0];assert.equal(vessel.name,'B CLASS');assert.equal(vessel.shipType,'tanker');assert.equal(vessel.receivedAt,'2026-09-13T17:00:00.000Z');
});
test('AIS metadata expires independently and name-only reports cannot keep a tanker classification alive',()=>{
 const store=new VesselStore();
 store.ingest(report({Type:80},{time_utc:'2026-09-13T17:00:00Z'},'ShipStaticData'),now);
 store.ingest(report({ReportA:{Valid:true,Name:'NEW NAME'}},{time_utc:'2026-09-14T16:59:00Z'},'StaticDataReport'),now+STATIC_EXPIRE_MS-60000);
 store.ingest(report({},{time_utc:'2026-09-14T17:00:00Z'}),now+STATIC_EXPIRE_MS);
 const vessel=store.snapshot(now+STATIC_EXPIRE_MS)[0];
 assert.equal(vessel.name,'NEW NAME');assert.equal(vessel.shipType,'unknown');assert.equal(vessel.shipTypeObservedAt,null);
 store.snapshot(now+STATIC_EXPIRE_MS*2);assert.equal(store.static.size,0);
});
test('AIS metadata rejects an older replacement, respects explicit unavailable code and is size bounded',()=>{
 const store=new VesselStore({limit:1});
 store.ingest(report({Type:80},{},'ShipStaticData'),now);
 store.ingest(report({Type:70},{time_utc:'2026-09-13T16:59:00Z'},'ShipStaticData'),now+1000);
 store.ingest(report(),now+1000);assert.equal(store.snapshot(now+1000)[0].shipType,'tanker');
 store.ingest(report({Type:0},{time_utc:'2026-09-13T17:00:02Z'},'ShipStaticData'),now+2000);
 assert.equal(store.snapshot(now+2000)[0].shipType,'unknown');
 store.ingest(report({Type:80,UserID:223456789},{MMSI:223456789},'ShipStaticData'),now+2000);
 assert.equal(store.static.size,1);assert.ok(store.static.has('223456789'));
});
