import test from 'node:test';
import assert from 'node:assert/strict';
import {Collector} from '../collector.mjs';
import {sqliteState,FakeSocket,position,confirmation} from './helpers.mjs';

test('alarm collects without any viewers, coalesces overlapping recovery calls and schedules a second cycle',async()=>{
  let now=Date.parse('2026-09-23T00:00:00Z'),calls=0,finish;
  const state=sqliteState(),collector=new Collector(state,{}, {now:()=>now,serviceFactory:()=>({collect:async()=>{calls++;await new Promise(resolve=>finish=resolve);}})});
  await collector.initialize();assert.equal(await state.storage.getAlarm(),now+1000);
  state.clearAlarm();const first=collector.alarm(),joined=collector.alarm();await Promise.resolve();assert.equal(calls,1);assert.equal(collector.status().collecting,true);
  finish();await Promise.all([first,joined]);assert.equal(collector.status().cycles,1);assert.equal(await state.storage.getAlarm(),now+300_000);
  now+=300_000;state.clearAlarm();const second=collector.alarm();await Promise.resolve();finish();await second;
  assert.equal(calls,2);assert.equal(collector.status().cycles,2);assert.equal(collector.lastCompletedAt,new Date(now).toISOString());
  const restarted=new Collector(state,{}, {now:()=>now+1000,serviceFactory:()=>({collect:async()=>{}})});await restarted.initialize();assert.equal(restarted.status().cycles,2);assert.equal(restarted.lastCompletedAt,collector.lastCompletedAt);state.db.close();
});

test('failed background collection retains prior completion time and recovers on its next due alarm',async()=>{
  let now=Date.parse('2026-09-23T00:00:00Z'),fail=false;const state=sqliteState();
  const collector=new Collector(state,{}, {now:()=>now,serviceFactory:()=>({collect:async()=>{if(fail)throw Error('secret internal failure');}})});
  await collector.initialize();state.clearAlarm();await collector.alarm();const completed=collector.lastCompletedAt;
  now+=300_000;fail=true;state.clearAlarm();await collector.alarm();assert.equal(collector.lastCompletedAt,completed);assert.match(collector.error,/did not finish/);assert.ok(!collector.error.includes('secret'));assert.equal(await state.storage.getAlarm(),now+300_000);
  now+=300_000;fail=false;state.clearAlarm();await collector.alarm();assert.equal(collector.error,null);assert.equal(collector.cycles,2);state.db.close();
});

test('continuous AIS survives a checkpoint and collector restart with its original observation age',async()=>{
  let now=Date.parse('2026-09-23T00:00:00Z');const state=sqliteState(),env={AISSTREAM_API_KEY:'server-secret'};
  const options={now:()=>now,Socket:FakeSocket,serviceFactory:()=>({collect:async()=>{}})};
  const collector=new Collector(state,env,options);await collector.initialize();const socket=collector.ais.socket;socket.open();socket.message(confirmation);socket.message(position(now));
  state.clearAlarm();await collector.alarm();const original=collector.ais.snapshot({touch:false}).vessels[0];collector.ais.close();await Promise.all(state.waits);
  now+=5*60_000;state.clearAlarm();const restarted=new Collector(state,env,options);await restarted.initialize();const restored=restarted.ais.snapshot({touch:false}).vessels[0];
  assert.equal(restored.positionTime,original.positionTime);assert.equal(restored.receivedAt,original.receivedAt);assert.equal(restored.ageSeconds,300);assert.ok(restarted.ais.socket);assert.equal(await state.storage.getAlarm(),now+1000);restarted.ais.close();await Promise.all(state.waits);state.db.close();
});

test('actual hosted service exposes only sanitized configuration and permanently disables ACLED',async()=>{
  const state=sqliteState(),collector=new Collector(state,{EIA_API_KEY:'eia-secret',AISSTREAM_API_KEY:'ais-secret',RELIEFWEB_APPNAME:'rw-secret'},{Socket:FakeSocket});await collector.initialize();
  const config=await (await collector.fetch(new Request('https://collector.internal/api/config'))).json();assert.equal(config.hosted,true);assert.equal(config.acled,false);assert.equal(config.eia,true);assert.ok(!JSON.stringify(config).includes('secret'));
  const acled=await (await collector.fetch(new Request('https://collector.internal/api/acled/events?days=90'))).json();assert.equal(acled.configured,false);assert.deepEqual(acled.events,[]);
  assert.equal((await collector.fetch(new Request('https://collector.internal/api/acled/connect',{method:'POST'}))).status,404);
  collector.ais.close();await Promise.all(state.waits);state.db.close();
});

test('public views coalesce concurrent requests and cache only five seconds',async()=>{
  let now=Date.now(),calls=0,finish;const state=sqliteState(),collector=new Collector(state,{}, {now:()=>now,serviceFactory:()=>({get:async()=>{calls++;await new Promise(resolve=>finish=resolve);return {checkedAt:'original-source-clock'};}})});await collector.initialize();
  const request=()=>new Request('https://collector.internal/api/news');const one=collector.fetch(request()),two=collector.fetch(request());await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);finish();await Promise.all([one,two]);
  const cached=await (await collector.fetch(request())).json();assert.equal(calls,1);assert.equal(cached.checkedAt,'original-source-clock');now+=5001;const fresh=collector.fetch(request());await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,2);finish();await fresh;await Promise.all(state.waits);state.db.close();
});

test('owner pause stops transport, scheduled work and public fetches without deleting stored metadata',async()=>{
  const state=sqliteState();await state.storage.setAlarm(Date.now()+1000);let calls=0;
  const collector=new Collector(state,{COLLECTOR_PAUSED:'true',AISSTREAM_API_KEY:'secret'},{Socket:FakeSocket,serviceFactory:()=>({get:()=>{calls++;},collect:()=>{calls++;}})});
  await collector.files.writeFile('/cache/preserved.json','keep');await collector.initialize();await collector.alarm();
  assert.equal(collector.ais.socket,null);assert.equal(await state.storage.getAlarm(),null);assert.equal(collector.status().active,false);assert.equal(calls,0);
  assert.equal((await collector.fetch(new Request('https://collector.internal/api/news'))).status,503);
  const health=await collector.fetch(new Request('https://collector.internal/api/health'));assert.equal(health.status,503);assert.equal((await health.json()).ready,false);
  assert.equal(await collector.files.readFile('/cache/preserved.json','utf8'),'keep');assert.equal(calls,0);state.db.close();
});
