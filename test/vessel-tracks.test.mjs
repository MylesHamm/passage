import test from 'node:test';
import assert from 'node:assert/strict';
import {VesselStore, TRACK_MAX_POINTS, TRACK_WINDOW_MS, nauticalMiles} from '../lib/vessel-store.mjs';
import {WorkerAisFeed} from '../cloud/ais.mjs';

const start = Date.parse('2026-10-20T18:00:00Z');
const position = (minute, {lon = 56.25 + minute * .002, lat = 26.57, mmsi = 123456789} = {}) => ({
  MessageType: 'PositionReport',
  MetaData: {MMSI: mmsi, ShipName: 'Test tanker', time_utc: new Date(start + minute * 60000).toISOString()},
  Message: {PositionReport: {UserID: mmsi, Latitude: lat, Longitude: lon, Sog: 10, Cog: 90, TrueHeading: 90}},
});
const tankerType = (minute, code = 80, mmsi = 123456789) => ({
  MessageType: 'ShipStaticData',
  MetaData: {MMSI: mmsi, time_utc: new Date(start + minute * 60000).toISOString()},
  Message: {ShipStaticData: {UserID: mmsi, Name: 'Test tanker', Type: code}},
});
function sail(store, minutes, options) {
  for (let m = 0; m < minutes; m += .25) store.ingest(position(m, options), start + m * 60000 + 500);
}

test('received tracks keep at most one point a minute and never more than an hour', () => {
  const store = new VesselStore();
  store.ingest(tankerType(0), start);
  sail(store, 10);
  const track = store.tracks.get('123456789');
  assert.equal(track.length, 10, 'quarter-minute reports collapse to one point per minute');
  for (let i = 1; i < track.length; i++) assert.ok(Date.parse(track[i][2]) - Date.parse(track[i - 1][2]) >= 60000);
  const long = new VesselStore();
  sail(long, 90);
  const points = long.tracks.get('123456789');
  assert.ok(points.length <= TRACK_MAX_POINTS);
  assert.ok(Date.parse(points.at(-1)[2]) - Date.parse(points[0][2]) < TRACK_WINDOW_MS);
});

test('a jump faster than 60 knots restarts the track instead of drawing across land', () => {
  const store = new VesselStore();
  store.ingest(position(0), start);
  store.ingest(position(2), start + 120000);
  assert.equal(store.tracks.get('123456789').length, 2);
  store.ingest(position(4, {lon: 58.5}), start + 240000);
  assert.ok(nauticalMiles([56.254, 26.57], [58.5, 26.57]) / (2 / 60) > 60);
  assert.deepEqual(store.tracks.get('123456789').map(p => p[0]), [58.5]);
});

test('snapshots carry tracks for reported tankers only', () => {
  const store = new VesselStore();
  store.ingest(tankerType(0), start);
  store.ingest(tankerType(0, 70, 223456789), start);
  sail(store, 5);
  sail(store, 5, {mmsi: 223456789, lat: 26.4});
  const now = start + 5 * 60000;
  const [tanker, cargo] = ['123456789', '223456789'].map(id => store.snapshot(now).find(v => v.mmsi === id));
  assert.equal(tanker.shipTypeCode, 80);
  assert.ok(tanker.track.length >= 2);
  assert.equal(cargo.track, undefined, 'non-tankers keep only their latest position on the wire');
});

test('leaving the area or expiring clears a track', () => {
  const store = new VesselStore();
  sail(store, 3);
  store.ingest(position(4, {lon: 40, lat: 20}), start + 240000);
  assert.equal(store.tracks.has('123456789'), false);
  const expiring = new VesselStore();
  sail(expiring, 3);
  expiring.snapshot(start + 3 * 60000 + 31 * 60000);
  assert.equal(expiring.tracks.has('123456789'), false);
});

test('Worker checkpoints restore valid track points and drop tampered ones', () => {
  const feed = new WorkerAisFeed({now: () => start + 10 * 60000});
  feed.store.ingest(tankerType(0), start);
  sail(feed.store, 10);
  feed.lastPositionAt = start + 10 * 60000;
  const saved = feed.checkpoint();
  assert.equal(saved.schema, 4);
  const [, points] = saved.tracks[0];
  saved.tracks[0][1] = [...points, [NaN, 26.5, points.at(-1)[2]], [10, 10, points.at(-1)[2]], [56.3, 26.5, new Date(start + 99 * 60000).toISOString()]];
  const restored = new WorkerAisFeed({now: () => start + 11 * 60000});
  restored.restore(saved);
  const track = restored.store.tracks.get('123456789');
  assert.ok(track.length >= 9, 'valid points survive the restart');
  assert.ok(track.every(p => Number.isFinite(p[0]) && p[0] > 52 && p[0] < 60), 'out-of-area and non-finite points are dropped');
  assert.ok(track.every(p => Date.parse(p[2]) <= start + 10 * 60000), 'points after the current position are dropped');
});
