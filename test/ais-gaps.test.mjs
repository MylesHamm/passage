import test from 'node:test';
import assert from 'node:assert/strict';
import { GapTracker, GAP_MIN_MS } from '../lib/ais-gaps.mjs';

const HOUR = 3_600_000, T0 = Date.parse('2026-10-20T00:00:00Z');
// A 5 x 5 block of 0.1-degree cells off Dubai, each heard from two other ships
// every hour: the middle 3 x 3 is "deep inside" reliable reception.
const CENTRE = [55.25, 25.35];
const cellCentre = (dc, dr) => [CENTRE[0] + dc * .1, CENTRE[1] + dr * .1];
function background(tracker, fromHour, toHour, { skip = () => false } = {}) {
  for (let h = fromHour; h < toHour; h++) {
    if (skip(h)) continue;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) for (const [i, minute] of [[1, 5], [2, 20], [1, 35], [2, 50]]) {
      const [lon, lat] = cellCentre(dc, dr);
      tracker.observe({ mmsi: `4${String(i)}${String(dr + 5)}${String(dc + 5)}00000`.slice(0, 9), t: T0 + h * HOUR + minute * 60_000, lon, lat, sog: 0 });
    }
  }
}
const ship = (mmsi, hour, [lon, lat], fields = {}) => ({ mmsi, t: T0 + hour * HOUR, lon, lat, sog: 12, tanker: true, name: 'TEST TANKER', ...fields });

test('coverage must be learned for a day before any gap counts', () => {
  const tracker = new GapTracker();
  background(tracker, 0, 10);
  tracker.observe(ship('311000001', 5, CENTRE));
  const status = tracker.status(T0 + 10 * HOUR);
  assert.equal(status.ready, false); assert.equal(status.summary.darkNow, 0);
});

test('a moving ship that goes silent deep inside coverage is dark; one at anchor or at the edge is not', () => {
  const tracker = new GapTracker();
  background(tracker, 0, 26);
  tracker.observe(ship('311000001', 25.5, CENTRE));
  tracker.observe(ship('311000002', 25.5, cellCentre(0, 1), { sog: 0, name: 'AT ANCHOR' }));
  tracker.observe(ship('311000003', 25.5, cellCentre(2, 0), { name: 'AT THE EDGE' }));
  background(tracker, 26, 30);
  const status = tracker.status(T0 + 29.9 * HOUR);
  assert.equal(status.ready, true); assert.equal(status.feedHealthy, true);
  assert.deepEqual(status.darkNow.map(d => d.mmsi), ['311000001']);
  assert.ok(status.darkNow[0].hours >= 4 && status.darkNow[0].hours < 4.5);
  assert.equal(status.summary.darkNowTankers, 1);
});

test('a ship that reappears closes its gap with the time dark and the distance between sightings', () => {
  const tracker = new GapTracker();
  background(tracker, 0, 26);
  tracker.observe(ship('311000001', 25.5, CENTRE));
  background(tracker, 26, 31);
  tracker.observe(ship('311000001', 30.5, cellCentre(1, 1)));
  const status = tracker.status(T0 + 30.6 * HOUR);
  assert.equal(status.summary.darkNow, 0);
  assert.equal(status.summary.completed7d, 1);
  const [gap] = status.completed;
  assert.equal(gap.hours, 5); assert.ok(gap.distanceNm > 7 && gap.distanceNm < 10);
  assert.equal(status.summary.medianHours, 5); assert.equal(status.summary.longestHours, 5);
});

test('silence shorter than three hours is not a gap', () => {
  const tracker = new GapTracker();
  background(tracker, 0, 28);
  tracker.observe(ship('311000001', 25.5, CENTRE));
  tracker.observe(ship('311000001', 25.5 + (GAP_MIN_MS - 60_000) / HOUR, CENTRE));
  assert.equal(tracker.status(T0 + 27.9 * HOUR).summary.completed7d, 0);
});

test('a feed outage during the silence means it is not counted', () => {
  const tracker = new GapTracker();
  background(tracker, 0, 26);
  tracker.observe(ship('311000001', 25.5, CENTRE));
  background(tracker, 26, 31, { skip: h => h === 27 || h === 28 });
  const status = tracker.status(T0 + 30.9 * HOUR);
  assert.equal(status.summary.darkNow, 0, 'the feed went quiet, so a silent ship proves nothing');
  tracker.observe(ship('311000001', 30.95, CENTRE));
  assert.equal(tracker.status(T0 + 31 * HOUR).summary.completed7d, 0);
});

test('a ship alone in a cell cannot make that cell look well covered', () => {
  const tracker = new GapTracker();
  const far = [57.5, 24.0];
  for (let h = 0; h < 30; h++) tracker.observe(ship('311000009', h, far, { sog: 0 }));
  assert.equal(tracker.reliable('240,575', 30), false);
});

test('the record survives a restart', () => {
  const tracker = new GapTracker();
  background(tracker, 0, 26);
  tracker.observe(ship('311000001', 25.5, CENTRE));
  background(tracker, 26, 30);
  const restored = GapTracker.from(JSON.parse(JSON.stringify(tracker.toJSON())));
  assert.deepEqual(restored.status(T0 + 29.9 * HOUR).darkNow.map(d => d.mmsi), ['311000001']);
  assert.equal(GapTracker.from({ schema: 99 }).status(T0).summary.darkNow, 0);
});

test('Hormuz position reports reach the gap record through the vessel store; Bab el-Mandeb ones do not', async () => {
  const { VesselStore } = await import('../lib/vessel-store.mjs');
  const store = new VesselStore(), now = Date.parse('2026-10-22T10:00:00Z');
  const envelope = (mmsi, lat, lon) => ({ MessageType: 'PositionReport', MetaData: { MMSI: mmsi, ShipName: 'TEST', time_utc: '2026-10-22 09:59:50 +0000 UTC' }, Message: { PositionReport: { Latitude: lat, Longitude: lon, Sog: 11.5, Cog: 90, TrueHeading: 90, Valid: true } } });
  assert.equal(store.ingest(envelope(311000001, 25.3, 55.2), now), true);
  assert.equal(store.ingest(envelope(311000002, 12.6, 43.3), now), true);
  assert.deepEqual([...store.gaps.seen.keys()], ['311000001']);
  assert.equal(store.gaps.seen.get('311000001').moving, true);
});
