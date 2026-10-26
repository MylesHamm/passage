import test from 'node:test';
import assert from 'node:assert/strict';
import {Collector} from '../collector.mjs';
import {WorkerAisFeed} from '../ais.mjs';
import {OpenWatersFeed,openWatersSubscription,openWatersEnvelope,OPENWATERS_URL,OPENWATERS_PROVIDER} from '../../lib/openwaters.mjs';
import {sqliteState,FakeSocket,position,confirmation} from './helpers.mjs';

const welcome={type:'welcome',role:'anonymous',limits:{conns:2,rate:20,area:100,mmsis:10}};
const ATTRIBUTION='Open Waters AIS (https://openwaters.io/ais/). AISHub (https://www.aishub.net)';
// A native event as the live stream sends it: the decoded message carries the coordinates.
const event=(now,{mmsi=576215000,latitude=25.35,longitude=54.46,source='aishub',time=new Date(now).toISOString(),type='PositionReport'}={})=>({
  type:'event',id:'e1',time,source,license:'aishub-terms',attribution:ATTRIBUTION,station:source,mmsi,msg_type:type,lat:latitude+1,lon:longitude+1,
  message:type==='ShipStaticData'?{UserID:mmsi,Valid:true,Name:'TEST TANKER',Type:84}:{UserID:mmsi,Valid:true,Latitude:latitude,Longitude:longitude,Sog:11,Cog:120,TrueHeading:118},
});

test('the subscription names Passage\'s two areas as minLat, minLon, maxLat, maxLon, last messages first',()=>{
  assert.deepEqual(openWatersSubscription(),{type:'subscribe',bbox:[[11,41,16,47.5],[23,52,28,60]],snapshot:true});
});

test('only a decoded message becomes an envelope; the event\'s own lat and lon are never used',()=>{
  const now=Date.parse('2026-10-26T15:00:00Z'),envelope=openWatersEnvelope(event(now));
  assert.equal(envelope.MessageType,'PositionReport');assert.equal(envelope.Message.PositionReport.Latitude,25.35);assert.equal(envelope.MetaData.time_utc,new Date(now).toISOString());
  assert.equal(openWatersEnvelope({...event(now),message:null}),null);
  assert.equal(openWatersEnvelope({...event(now),mmsi:'12'}),null);
  assert.equal(openWatersEnvelope({...event(now),msg_type:'BinaryBroadcastMessage'}),null);
  assert.equal(openWatersEnvelope({type:'welcome'}),null);
});

test('a relayed position is stored with its relay, upstream source and credit, and shares one store with AISStream',()=>{
  let now=Date.parse('2026-10-26T15:00:00Z');FakeSocket.sockets.length=0;
  const ais=new WorkerAisFeed({apiKey:'key',Socket:FakeSocket,now:()=>now});
  const relay=new OpenWatersFeed({store:ais.store,Socket:FakeSocket,now:()=>now});ais.relays.push(relay);
  ais.tick();
  const socket=FakeSocket.sockets.find(s=>s.url===OPENWATERS_URL);assert.ok(socket,'the relay opens the native stream');
  socket.open();assert.deepEqual(JSON.parse(socket.sent[0]),openWatersSubscription());
  socket.message(welcome);assert.equal(relay.connection,'connected');
  socket.message(event(now,{type:'ShipStaticData'}));socket.message(event(now-60_000));
  const [vessel]=ais.snapshot({touch:false}).vessels;
  assert.equal(vessel.provider,OPENWATERS_PROVIDER);assert.equal(vessel.relaySource,'aishub');assert.equal(vessel.attribution,undefined,'the credit travels once, in the relay status');assert.deepEqual(ais.snapshot({touch:false}).relays[0].attribution,[ATTRIBUTION]);
  assert.equal(vessel.latitude,25.35,'coordinates come from the decoded payload');assert.equal(vessel.positionTime,new Date(now-60_000).toISOString());
  assert.equal(vessel.shipTypeCode,84);assert.equal(vessel.shipTypeProvider,OPENWATERS_PROVIDER);
  // AISStream's newer report of the same ship replaces the relayed one; an older one does not.
  const own=FakeSocket.sockets.find(s=>s.url!==OPENWATERS_URL);own.open();own.message(confirmation);
  own.message(position(now-120_000,{mmsi:576215000,latitude:25.4,longitude:54.5}));
  assert.equal(ais.snapshot({touch:false}).vessels[0].provider,OPENWATERS_PROVIDER,'an older AISStream report never replaces a newer relayed one');
  own.message(position(now,{mmsi:576215000,latitude:25.4,longitude:54.5}));
  const replaced=ais.snapshot({touch:false});
  assert.equal(replaced.vessels[0].provider,'AISStream');assert.equal(ais.store.vessels.get('576215000').attribution,null);
  const status=replaced.relays[0];assert.equal(status.id,'openwaters');assert.equal(status.connection,'connected');assert.equal(status.positionsAccepted,1);assert.equal(status.recordCount,0);
});

test('an error frame or silence retries with backoff; silence never means an empty sea',()=>{
  let now=Date.parse('2026-10-26T15:00:00Z');FakeSocket.sockets.length=0;
  const relay=new OpenWatersFeed({store:new WorkerAisFeed({}).store,Socket:FakeSocket,now:()=>now,random:()=>0});
  relay.tick();let socket=FakeSocket.sockets.at(-1);socket.open();socket.message(welcome);
  socket.message({type:'error',message:'limit'});assert.equal(relay.connection,'disconnected');assert.ok(relay.retryAt>now);
  now=relay.retryAt;relay.tick();socket=FakeSocket.sockets.at(-1);socket.open();socket.message(welcome);
  now+=181_000;relay.tick();assert.equal(relay.connection,'disconnected');assert.match(relay.error,/does not establish an empty waterway/);
});

test('the hosted collector opens Open Waters only when the deploy opts in, and keeps relayed credit through a restart',async()=>{
  let now=Date.parse('2026-10-26T15:00:00Z');FakeSocket.sockets.length=0;
  const off=new Collector(sqliteState(),{},{Socket:FakeSocket,now:()=>now,serviceFactory:()=>({collect:async()=>{}})});
  await off.initialize();assert.ok(!FakeSocket.sockets.some(s=>s.url===OPENWATERS_URL),'no relay without OPENWATERS');
  const state=sqliteState(),env={OPENWATERS:'true'},options={now:()=>now,Socket:FakeSocket,serviceFactory:()=>({collect:async()=>{}})};
  const collector=new Collector(state,env,options);await collector.initialize();
  const socket=FakeSocket.sockets.find(s=>s.url===OPENWATERS_URL);socket.open();socket.message(welcome);socket.message(event(now));
  assert.ok(await state.storage.getAlarm()<=now+15_000,'the relay is supervised every 15 seconds');
  state.clearAlarm();await collector.alarm();collector.ais.close();await Promise.all(state.waits);
  now+=5*60_000;const restarted=new Collector(state,env,options);await restarted.initialize();
  const [restored]=restarted.ais.snapshot({touch:false}).vessels;
  assert.equal(restored.provider,OPENWATERS_PROVIDER);assert.equal(restored.relaySource,'aishub');assert.equal(restarted.ais.store.vessels.get('576215000').attribution,ATTRIBUTION);assert.equal(restored.ageSeconds,300);
  restarted.ais.close();await Promise.all(state.waits);state.db.close();
});

test('a token goes only into the connection address, never into status or errors',()=>{
  FakeSocket.sockets.length=0;const relay=new OpenWatersFeed({store:new WorkerAisFeed({}).store,Socket:FakeSocket,token:'secret-token'});
  relay.tick();const socket=FakeSocket.sockets.at(-1);
  assert.equal(socket.url,`${OPENWATERS_URL}?key=secret-token`);assert.equal(relay.url,OPENWATERS_URL);
  socket.open();socket.message({type:'error',error:'limit'});
  const status=JSON.stringify(relay.status([]));assert.ok(!status.includes('secret-token'));assert.match(status,/"access":"token"/);
  assert.ok(!String(relay.error).includes('secret-token'));
});
