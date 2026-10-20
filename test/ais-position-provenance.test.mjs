import test from 'node:test';
import assert from 'node:assert/strict';
import {VesselStore, TYPES, STALE_MS, EXPIRE_MS} from '../lib/vessel-store.mjs';

const now = Date.parse('2026-10-20T18:00:00Z');
const reportAt = '2026-10-20T17:59:30.000Z';
const report = ({type='PositionReport', fields={}, meta={}}={}) => ({
  MessageType:type,
  MetaData:{
    MMSI:123456789, ShipName:'Test vessel', time_utc:reportAt,
    latitude:26.57, longitude:56.25, Latitude:26.57, Longitude:56.25,
    ...meta,
  },
  Message:{[type]:{
    UserID:123456789, Valid:true, Latitude:12.58, Longitude:43.33,
    Sog:10, Cog:90, TrueHeading:90, ...fields,
  }},
});

test('every supported position type requires both decoded payload coordinates', () => {
  for(const type of TYPES){
    for(const fields of [
      {Latitude:undefined}, {Longitude:undefined},
      {Latitude:undefined,Longitude:undefined},
      {Latitude:null}, {Longitude:null},
    ]){
      const store = new VesselStore();
      assert.equal(store.ingest(report({type,fields}),now),false,`${type} must not fall back to cached envelope coordinates`);
      assert.equal(store.lastOutcome,'coordinates');
      assert.deepEqual(store.snapshot(now),[]);
    }
  }
});

test('unavailable or malformed payload coordinates cannot refresh a retained position', () => {
  const store = new VesselStore();
  assert.equal(store.ingest(report(),now),true);
  const first = store.snapshot(now)[0];
  for(const fields of [
    {Latitude:91}, {Longitude:181}, {Latitude:-91}, {Longitude:-181},
    {Latitude:NaN}, {Longitude:Infinity}, {Latitude:'12.58'}, {Longitude:null},
  ]){
    assert.equal(store.ingest(report({fields,meta:{time_utc:'2026-10-20T18:00:05Z'}}),now+5000),false);
    assert.equal(store.lastOutcome,'coordinates');
    const retained = store.snapshot(now+5000)[0];
    for(const key of ['latitude','longitude','positionTime','providerReportAt','receivedAt','positionEvidence']){
      assert.equal(retained[key],first[key],`${key} must retain its original position-report provenance`);
    }
  }
});

test('accepted coordinates come from the position payload, with report and receipt clocks distinct', () => {
  const store = new VesselStore();
  assert.equal(store.ingest(report({meta:{time_utc:'2026-10-20 17:59:30.123 +0000 UTC'}}),now),true);
  const vessel = store.snapshot(now)[0];
  assert.equal(vessel.latitude,12.58);assert.equal(vessel.longitude,43.33);
  assert.equal(vessel.theater,'bab');
  assert.equal(vessel.positionEvidence,'position-report');
  assert.equal(vessel.providerReportAt,'2026-10-20T17:59:30.123Z');
  assert.equal(vessel.sourceAt,vessel.providerReportAt);
  assert.equal(vessel.positionTime,vessel.providerReportAt);
  assert.equal(vessel.receivedAt,'2026-10-20T18:00:00.000Z');
  assert.notEqual(vessel.providerReportAt,vessel.receivedAt);
});

test('missing or invalid provider time remains unknown rather than becoming an observation claim', () => {
  for(const time_utc of [undefined,'invalid','2026-10-20T18:10:00Z']){
    const store = new VesselStore();
    assert.equal(store.ingest(report({meta:{time_utc}}),now),true);
    const vessel = store.snapshot(now)[0];
    assert.equal(vessel.providerReportAt,null);
    assert.equal(vessel.sourceAt,null);
    assert.equal(vessel.positionTime,vessel.receivedAt);
    assert.equal(vessel.timestampBasis,'received');
    assert.match(vessel.timestampNote,/receipt time/);
    assert.equal(vessel.positionEvidence,'position-report');
  }
});

test('fresh static metadata cannot move or renew an earlier position report', () => {
  const store = new VesselStore();
  assert.equal(store.ingest(report(),now),true);
  const first = store.snapshot(now)[0], later=now+STALE_MS;
  assert.equal(store.ingest(report({
    type:'ShipStaticData',fields:{Name:'Updated test name',Type:80,Latitude:26.6,Longitude:56.3},
    meta:{time_utc:new Date(later).toISOString()},
  }),later),false);
  assert.equal(store.lastOutcome,'static');
  const retained = store.snapshot(later)[0];
  assert.equal(retained.name,'Updated test name');assert.equal(retained.shipType,'tanker');
  assert.equal(retained.stale,true);
  for(const key of ['latitude','longitude','positionTime','providerReportAt','receivedAt','positionEvidence']){
    assert.equal(retained[key],first[key]);
  }
  assert.deepEqual(store.snapshot(Date.parse(first.positionTime)+EXPIRE_MS),[]);
});
