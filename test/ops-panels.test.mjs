import test from 'node:test';
import assert from 'node:assert/strict';
import {
  esc, ageLabel, dayLabel, vesselCounts, heroCountsMarkup, vesselCardMarkup, oddsMarkup, headlineItems, headlinesMarkup,
  latestPrices, transitRowMarkup, sourceState, statusSummary, aboutMarkup, isTanker, chartSeries,
} from '../dist/ops/panels.mjs';
import { segmentBearing, trackPoints, positionAt } from '../dist/ops/hero-map.mjs';

const now = Date.parse('2026-10-20T21:00:00Z');
const iso = ms => new Date(ms).toISOString();
const vessel = (fields = {}) => ({ mmsi: '123456789', name: 'TEST', theater: 'hormuz', latitude: 25.2, longitude: 55.2, positionTime: iso(now - 60000), shipTypeCode: 80, speedKnots: 0, headingDegrees: 316, ...fields });

test('markup escapes provider text everywhere', () => {
  assert.equal(esc('<img onerror=x>"&\''), '&lt;img onerror=x&gt;&quot;&amp;&#39;');
  const card = vesselCardMarkup(vessel({ name: '<script>alert(1)</script>' }), now);
  assert.doesNotMatch(card, /<script>/);
  const odds = oddsMarkup([{ question: '<b>Will</b>?', probability: .5, url: 'javascript:alert(1)' }]);
  assert.doesNotMatch(odds, /<b>|javascript:/);
  assert.match(odds, /href="https:\/\/polymarket\.com\/"/, 'non-Polymarket links fall back to the Polymarket home page');
});

test('ages and dates are labelled without inventing values', () => {
  assert.equal(ageLabel(42_000), '42s ago');
  assert.equal(ageLabel(5 * 60_000), '5 min ago');
  assert.equal(ageLabel(-1), '');
  assert.equal(ageLabel(NaN), '');
  assert.equal(dayLabel('2026-10-18'), '18 Oct');
  assert.equal(dayLabel('not a date'), '');
});

test('vessel counts include only current Hormuz positions and count tankers by AIS type 80–89', () => {
  const list = [vessel(), vessel({ mmsi: '223456789', shipTypeCode: 70 }), vessel({ mmsi: '323456789', positionTime: iso(now - 31 * 60000) }), vessel({ mmsi: '423456789', theater: 'bab' }), vessel({ mmsi: '523456789', positionTime: iso(now + 60000) })];
  const counts = vesselCounts(list, now);
  assert.equal(counts.total, 2); assert.equal(counts.tankers, 1);
  assert.equal(counts.newestAgeMs, 60000);
  assert.match(heroCountsMarkup(counts), /<strong>1<\/strong> tanker<\/span>/);
  assert.match(heroCountsMarkup({ total: 0 }), /No current positions/);
  assert.match(heroCountsMarkup(counts, { connected: false }), /unavailable/);
  assert.equal(isTanker({ shipTypeCode: 89 }), true); assert.equal(isTanker({ shipTypeCode: 90 }), false); assert.equal(isTanker({}), false);
});

test('a vessel without a reported heading or speed says so instead of guessing', () => {
  const card = vesselCardMarkup(vessel({ headingDegrees: null, courseDegrees: null, speedKnots: null }), now);
  assert.match(card, /<dt>Heading<\/dt><dd>Not reported<\/dd>/);
  assert.match(card, /<dt>Speed<\/dt><dd>Not reported<\/dd>/);
  assert.match(vesselCardMarkup(vessel({ positionTime: iso(now - 15 * 60000) }), now), /OLDER POSITION/);
});

test('odds show valid probabilities only, with bounded labels', () => {
  const markup = oddsMarkup([
    { question: 'A?', probability: .115, url: 'https://polymarket.com/event/a' },
    { question: 'B?', probability: .004, url: 'https://polymarket.com/event/b' },
    { question: 'C?', probability: 1.4, url: 'https://polymarket.com/event/c' },
    { question: '', probability: .5 },
  ]);
  assert.match(markup, />12%</, 'ten percent and above show whole percentages'); assert.match(markup, />&lt;1%</);
  assert.match(markup, /title="Polymarket"/, 'no blank resolution date in the tooltip');
  assert.doesNotMatch(markup, /C\?/); assert.equal((markup.match(/odds-item/g) || []).length, 2);
  assert.match(oddsMarkup([]), /No related markets/);
});

test('headlines come only from core publishers, newest first, filtered by region', () => {
  const items = [
    { sourceId: 'bbc', title: 'Old', url: 'https://bbc.co.uk/1', publishedAt: iso(now - 7200000), theaters: ['hormuz'], source: 'BBC' },
    { sourceId: 'mee', title: 'New', url: 'https://mee.net/2', publishedAt: iso(now - 600000), theaters: ['bab'], source: 'MEE' },
    { sourceId: 'gdelt-energy', title: 'Aggregator', url: 'https://example.com/3', publishedAt: iso(now - 60000), theaters: ['bab'] },
    { sourceId: 'aj', title: 'Future', url: 'https://aj.com/4', publishedAt: iso(now + 3600000), theaters: ['bab'] },
    { sourceId: 'aj', title: 'Unsafe', url: 'http://aj.com/5', publishedAt: iso(now - 60000), theaters: [] },
  ];
  assert.deepEqual(headlineItems(items, { now }).map(i => i.title), ['New', 'Old']);
  assert.deepEqual(headlineItems(items, { now, region: 'hormuz' }).map(i => i.title), ['Old']);
  assert.match(headlinesMarkup([], { now }), /No recent headlines/);
});

test('latest prices prefer the newest dated close and ignore malformed rows', () => {
  const oil = {
    series: [{ id: 'brent', observations: [{ date: '2026-10-13', value: 125.78 }, { date: '2026-10-14', value: 126.55 }] }, { id: 'wti', observations: [{ date: '2026-10-14', value: null }] }],
    latestCloses: [{ id: 'brent', value: 118.82, date: '2026-10-19', basis: 'Wholesale spot close (Refinitiv)' }, { id: 'wti', value: 110.01, date: 'bad' }],
  };
  const latest = latestPrices(oil);
  assert.deepEqual(latest.brent, { value: 118.82, date: '2026-10-19', basis: 'Wholesale spot close (Refinitiv)' });
  assert.equal(latest.wti, undefined, 'no valid WTI observation means no price, never a zero');
  assert.deepEqual(latestPrices(null), {});
});

test('transit rows show the latest dated count against a labelled baseline', () => {
  const rows = [{ date: '2026-10-17', total: 0, tankers: 0 }, { date: '2026-10-18', total: 4, tankers: 2 }];
  const markup = transitRowMarkup({ name: 'Strait of Hormuz', rows, latest: rows.at(-1), baseline: { label: '2025 daily average', total: 85.53, tankers: 48.18 } });
  assert.match(markup, /<strong>4<\/strong>/); assert.match(markup, /<b>2<\/b> tankers/);
  assert.match(markup, /2025 daily average: <b>86<\/b> ships · <b>48<\/b> tankers/);
  assert.match(markup, /18 Oct/);
  assert.match(markup, /data-low="true">5% of average</, 'a collapse below half of normal is stated plainly');
  assert.match(transitRowMarkup({ name: 'Bab el-Mandeb' }), /No transit counts/);
});

test('only a current, attention-free source counts as live in the status summary', () => {
  assert.equal(sourceState({ configured: true, status: 'current', attention: false }), 'live');
  assert.equal(sourceState({ configured: true, status: 'current', attention: true }), 'stale');
  for (const status of ['stale', 'retained', 'empty', 'unknown', 'paused', 'loading']) assert.equal(sourceState({ configured: true, status }), 'stale', status);
  assert.equal(sourceState({ configured: true, status: 'unavailable' }), 'down');
  assert.equal(sourceState({ configured: false, status: 'disabled' }), 'idle');
  assert.deepEqual(statusSummary([{ configured: true, status: 'current' }, { configured: true, status: 'current' }]), { state: 'live', text: 'All sources current' });
  assert.equal(statusSummary([{ configured: true, status: 'current' }, { configured: true, status: 'unavailable' }]).state, 'degraded');
  assert.equal(statusSummary([{ configured: true, status: 'unavailable' }]).state, 'down');
  assert.match(aboutMarkup([{ configured: true, status: 'current', name: 'BBC <Middle East>', latest: '2026-10-20' }]), /BBC &lt;Middle East&gt;/);
  assert.match(aboutMarkup([]), /How to read this/);
});

test('replay positions move only between received points and never past the latest report', () => {
  const t0 = now - 30 * 60000;
  const v = vessel({ positionTime: iso(t0 + 20 * 60000), longitude: 55.3, latitude: 25.2, track: [[55.1, 25.2, iso(t0)], [55.2, 25.2, iso(t0 + 10 * 60000)], ['bad', 25, iso(t0)], [55.5, 25, iso(now + 600000)]] });
  const points = trackPoints(v, now);
  assert.deepEqual(points.map(p => p[0]), [55.1, 55.2, 55.3], 'invalid and future points are dropped; the current position closes the track');
  assert.equal(positionAt(points, t0 - 1), null, 'absent before its first received point');
  const mid = positionAt(points, t0 + 5 * 60000);
  assert.ok(Math.abs(mid.longitude - 55.15) < 1e-9 && mid.latitude === 25.2);
  assert.ok(Math.abs(mid.bearing - 90) < .1, 'bearing comes from the received segment');
  const after = positionAt(points, now);
  assert.equal(after.longitude, 55.3, 'holds at the latest report instead of extrapolating');
  assert.equal(positionAt([], now), null);
  assert.ok(Math.abs(segmentBearing([0, 0], [0, 1]) - 0) < 1e-9);
  assert.ok(Math.abs(segmentBearing([0, 0], [-1, 0]) - 270) < 1e-9);
});

test('the chart gains a newer close as one dated point, leaving missing days missing', () => {
  const oil = { series: [{ id: 'brent', observations: [{ date: '2026-10-14', value: 126.55 }] }, { id: 'wti', observations: [{ date: '2026-10-14', value: 101.91 }] }],
    latestCloses: [{ id: 'brent', value: 118.82, date: '2026-10-19' }, { id: 'wti', value: 99, date: '2026-10-14' }] };
  const [brent, wti] = chartSeries(oil);
  assert.deepEqual(brent.observations.map(o => o.date), ['2026-10-14', '2026-10-19']);
  assert.deepEqual(wti.observations.map(o => o.date), ['2026-10-14'], 'a close that is not newer never replaces history');
  assert.deepEqual(chartSeries(null), []);
});

test('a compass bearing projects to the matching clockwise screen angle', async () => {
  const { projectedVesselAngle } = await import('../dist/ops/hero-map.mjs').catch(() => ({}));
  // hero-map imports browser-only renderers lazily through createHeroMap only; the helper is pure.
  const flat = ([lon, lat]) => ({ x: lon * 100, y: -lat * 100 });
  const at = { longitude: 55, latitude: 25 };
  assert.ok(Math.abs(projectedVesselAngle(at, 0, flat)) < 1e-9, 'north is straight up');
  assert.ok(Math.abs(projectedVesselAngle(at, 90, flat) - 90) < .5, 'east is a quarter turn clockwise');
  assert.equal(projectedVesselAngle(at, null, flat), null);
  assert.equal(projectedVesselAngle(at, 90, () => ({ x: NaN, y: 0 })), null);
});
