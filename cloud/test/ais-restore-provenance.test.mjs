import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkerAisFeed} from '../ais.mjs';
import {EXPIRE_MS, STATIC_EXPIRE_MS} from '../../lib/vessel-store.mjs';

const started=Date.parse('2026-10-20T18:00:00Z');
const envelope=(sourceAt,{type='PositionReport',fields={}}={})=>({
  MessageType:type,
  MetaData:{MMSI:123456789,ShipName:'Test tanker',time_utc:sourceAt},
  Message:{[type]:{UserID:123456789,Latitude:26.57,Longitude:56.25,Sog:10,Cog:90,TrueHeading:90,...fields}},
});
function checkpoint({receiptOnly=false}={}){
  const feed=new WorkerAisFeed({now:()=>started});
  feed.store.ingest(envelope(receiptOnly?undefined:new Date(started-60000).toISOString()),started);
  feed.store.ingest(envelope(new Date(started).toISOString(),{type:'ShipStaticData',fields:{Name:'Test tanker',Type:80}}),started);
  feed.lastPositionAt=started;
  return feed.checkpoint();
}
const restored=(saved,now=started+5*60000)=>{
  const feed=new WorkerAisFeed({now:()=>now});
  feed.restore(saved);
  return feed;
};

test('schema 2 restores provider report time separately from original receipt and restart time',()=>{
  const current=checkpoint();
  assert.equal(current.schema,3,'new checkpoints carry received tracks');
  const {tracks,...withoutTracks}=current,saved={...withoutTracks,schema:2},original=saved.vessels[0],feed=restored(saved);
  const [vessel]=feed.snapshot({touch:false}).vessels;
  assert.equal(vessel.positionEvidence,'position-report');
  assert.equal(vessel.providerReportAt,original.providerReportAt);
  assert.equal(vessel.positionTime,original.positionTime);
  assert.equal(vessel.sourceAt,original.sourceAt);
  assert.equal(vessel.receivedAt,original.receivedAt);
  assert.notEqual(vessel.providerReportAt,vessel.receivedAt);
  assert.equal(vessel.ageSeconds,360);
  assert.equal(vessel.shipTypeCode,80);
});

test('receipt-only checkpoint never fabricates provider report time on either restore or another checkpoint',()=>{
  const saved=checkpoint({receiptOnly:true}),feed=restored(saved);
  const [vessel]=feed.snapshot({touch:false}).vessels;
  assert.equal(vessel.providerReportAt,null);
  assert.equal(vessel.sourceAt,null);
  assert.equal(vessel.timestampBasis,'received');
  assert.equal(vessel.positionTime,saved.vessels[0].positionTime);
  assert.equal(vessel.receivedAt,saved.vessels[0].receivedAt);
  assert.equal(vessel.ageSeconds,300);
  assert.match(vessel.timestampNote,/original receipt time/);
  const again=restored(feed.checkpoint(),started+10*60000).snapshot({touch:false}).vessels[0];
  assert.equal(again.providerReportAt,null);
  assert.equal(again.receivedAt,vessel.receivedAt);
  assert.equal(again.ageSeconds,600);
});

test('legacy schema positions are not upgraded but independently dated static metadata survives',()=>{
  const saved=checkpoint(),legacy={...saved,schema:1},before=structuredClone(legacy);
  const feed=restored(legacy);
  assert.deepEqual(feed.snapshot({touch:false}).vessels,[]);
  assert.equal(feed.lastPositionAt,null);
  assert.equal(feed.store.static.get('123456789').shipTypeCode,80);
  assert.deepEqual(legacy,before,'restore must not rewrite the supplied persisted state');
  feed.store.ingest(envelope(new Date(started+5*60000).toISOString()),started+5*60000);
  const [fresh]=feed.store.snapshot(started+5*60000);
  assert.equal(fresh.positionEvidence,'position-report');
  assert.equal(fresh.shipTypeCode,80,'retained static metadata may enrich a new actual position');
  assert.equal(fresh.providerReportAt,new Date(started+5*60000).toISOString());
  feed.store.snapshot(started+STATIC_EXPIRE_MS);
  assert.equal(feed.store.static.size,0);
});

test('schema 2 requires explicit report evidence and consistent report/receipt clocks',()=>{
  const saved=checkpoint();
  for(const update of [
    {positionEvidence:undefined},
    {positionEvidence:'snapshot'},
    {providerReportAt:undefined},
    {providerReportAt:null},
    {providerReportAt:saved.vessels[0].receivedAt},
    {sourceAt:null},
    {latitude:91},
    {longitude:181},
  ]){
    const malformed=structuredClone(saved);
    Object.assign(malformed.vessels[0],update);
    const feed=restored(malformed);
    assert.deepEqual(feed.snapshot({touch:false}).vessels,[]);
    assert.equal(feed.lastPositionAt,null);
  }
  const receipt=checkpoint({receiptOnly:true});
  receipt.vessels[0].providerReportAt=receipt.vessels[0].receivedAt;
  assert.deepEqual(restored(receipt).snapshot({touch:false}).vessels,[]);
});

test('restore respects original position expiry rather than extending retention until restart',()=>{
  for(const receiptOnly of [false,true]){
    const saved=checkpoint({receiptOnly});
    const originalExpiry=Date.parse(saved.vessels[0].positionTime)+EXPIRE_MS;
    assert.deepEqual(restored(saved,originalExpiry).snapshot({touch:false}).vessels,[]);
  }
});
