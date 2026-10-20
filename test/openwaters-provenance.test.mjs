import test from 'node:test';
import assert from 'node:assert/strict';
import {parseOpenWaters, parseOpenWatersAttribution} from '../lib/openwaters.mjs';

const now = Date.parse('2026-10-20T18:00:00Z');
const feature = (properties={}, coordinates=[56.25,26.57]) => ({
  type:'Feature', geometry:{type:'Point',coordinates},
  properties:{mmsi:999000001,name:'Test snapshot',type:80,source:'station:test',
    station:'receiver-test',msg_type:'PositionReport',seen:'2026-10-20T17:59:00Z',...properties},
});
const collection = (...features) => ({type:'FeatureCollection',features});

test('snapshot clocks and latest-message provenance never establish coordinate provenance', () => {
  const [row] = parseOpenWaters(collection(feature()), now);
  assert.equal(row.positionEvidence, 'snapshot');
  assert.equal(row.positionObservedAt, null);
  assert.equal(row.positionSource, null);
  assert.equal(row.lastMessageAt, '2026-10-20T17:59:00.000Z');
  assert.equal(row.lastMessageSource, 'station:test');
  assert.equal(row.lastMessageStation, 'receiver-test');
  assert.equal(row.lastMessageType, 'PositionReport');
  assert.equal(row.timestampBasis, 'provider-last-message');
  assert.equal(row.retentionTime, row.lastMessageAt);
  assert.equal(row.positionTime, row.retentionTime, 'legacy clock is only a retention alias');
  assert.equal(row.sourceAt, row.lastMessageAt, 'legacy source clock means latest message');
  assert.match(row.timestampNote, /does not supply.*position observation time or source/);
});

test('a newer static message advances only last-message time, not position observation time', () => {
  const [before] = parseOpenWaters(collection(feature()), now);
  const [after] = parseOpenWaters(collection(feature({
    seen:'2026-10-20T17:59:50Z',msg_type:'ShipStaticData',
    source:'different-provider',station:'different-station',name:'New static name',
  })), now);
  assert.deepEqual([after.longitude,after.latitude], [before.longitude,before.latitude]);
  assert.notEqual(after.lastMessageAt, before.lastMessageAt);
  assert.equal(after.lastMessageSource, 'different-provider');
  assert.equal(after.lastMessageType, 'ShipStaticData');
  assert.equal(after.positionObservedAt, null);
  assert.equal(after.positionSource, null);
  assert.equal(after.positionEvidence, 'snapshot');
});

test('a latest PositionReport message cannot upgrade snapshot geometry to a current observation', () => {
  // An unavailable-coordinate position message may update message metadata
  // while the upstream snapshot keeps these older cached coordinates.
  const [row] = parseOpenWaters(collection(feature({
    seen:'2026-10-20T17:59:59Z',msg_type:'PositionReport',source:'new-message-source',
  })), now);
  assert.equal(row.lastMessageType, 'PositionReport');
  assert.equal(row.lastMessageAt, '2026-10-20T17:59:59.000Z');
  assert.equal(row.positionObservedAt, null);
  assert.equal(row.positionSource, null);
  assert.equal(row.positionEvidence, 'snapshot');
});

test('missing, malformed and future message clocks remain unknown and use receipt only for retention', () => {
  for (const seen of [undefined,null,'bad time','2026-10-20T18:00:01Z']) {
    const [row] = parseOpenWaters(collection(feature({seen})), now);
    assert.equal(row.lastMessageAt, null);
    assert.equal(row.positionObservedAt, null);
    assert.equal(row.sourceAt, null);
    assert.equal(row.timestampBasis, 'snapshot-received');
    assert.equal(row.retentionTime, new Date(now).toISOString());
    assert.equal(row.receivedAt, row.retentionTime);
    assert.match(row.timestampNote, /retention uses receipt time/);
  }
});

test('snapshot retention rejects old messages without inventing a new coordinate observation clock', () => {
  assert.deepEqual(parseOpenWaters(collection(feature({seen:'2026-10-20T17:30:00Z'})), now), []);
  assert.equal(parseOpenWaters(collection(feature({seen:'2026-10-20T17:30:00.001Z'})), now).length, 1);
});

test('collection attribution is retained as plain text and is not assigned as geometry permission', () => {
  const payload = {...collection(feature()),attribution:{
    'station':'Volunteer receptions · CC0',
    'digitraffic':'Digitraffic / Fintraffic · CC BY 4.0',
  }};
  assert.deepEqual(parseOpenWatersAttribution(payload), payload.attribution);
  const [row] = parseOpenWaters(payload, now);
  assert.equal(row.positionSource, null);
  assert.equal(row.license, undefined);
  assert.equal(row.attribution, undefined, 'collection credits should be stored once in the source envelope');
});

test('untrusted attribution is bounded plain text without prototype mutation or nested data', () => {
  const attribution=JSON.parse('{"__proto__":"bad","constructor":"bad","station":"Line one\\nLine two","nested":{"grant":true},"empty":"  ","bad key":"ignored"}');
  const result=parseOpenWatersAttribution({attribution});
  assert.deepEqual(result,{station:'Line one Line two'});
  assert.equal(Object.getPrototypeOf(result),Object.prototype);
  assert.equal(parseOpenWatersAttribution({attribution:{station:'x'.repeat(3000)}}).station.length,2048);
  assert.deepEqual(parseOpenWatersAttribution({attribution:['not a map']}),{});
  assert.deepEqual(parseOpenWatersAttribution({}),{});
});
