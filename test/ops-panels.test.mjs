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

test('the event card states what happened next without claiming cause, and escapes its text', async () => {
  const { eventCardMarkup, eventListMarkup } = await import('../dist/ops/panels.mjs');
  const event = { id: 'war:x', layer: 'shipping', date: '2026-03-02', time: '04:10Z', title: 'Tanker <b>hit</b>', actor: 'Houthis', target: 'Commercial tanker', place: 'Red Sea off Mocha', precision: 'sea-area', radiusNm: null, confidence: 'claimed', summary: 'Claimed attack.', sources: [{ publisher: 'Reuters', title: 'Report', url: 'https://www.reuters.com/x' }] };
  const t = d => Date.parse(d + 'T12:00:00Z') / 1000;
  const card = eventCardMarkup(event, { brent: { before: { date: '2026-03-02', value: 80 }, after: { date: '2026-03-05', value: 83 }, change: 3, percent: 3.75, days: 3 }, odds: [{ question: 'Will shipping attacks continue?', move: { before: { p: .4, t: t('2026-03-02') }, after: { p: .55, t: t('2026-03-04') } } }] });
  assert.doesNotMatch(card, /<b>hit<\/b>/);
  assert.match(card, /Claimed/); assert.match(card, /04:10 UTC/); assert.match(card, /sea area/);
  assert.match(card, /\$80\.00 on 2 Mar → \$83\.00 on 5 Mar <span class="up">\+3\.00 \(\+3\.8%\)<\/span>/);
  assert.match(card, /Will shipping attacks continue\?: 40% \(2 Mar\) → 55% \(4 Mar\)/, 'each odds value names its own date');
  assert.match(card, /not what caused it/);
  assert.match(eventCardMarkup(event, { brent: { before: { date: '2026-03-02', value: 80 }, after: null, days: 3 } }), /Later prices are not yet published/);
  assert.match(eventCardMarkup(event, {}), /No Brent observation/);
  const list = eventListMarkup([event, { ...event, id: 'war:y', confidence: 'confirmed', layer: 'missile-drone' }]);
  assert.match(list, /data-event-id="war:x"/); assert.match(list, /· claimed/); assert.match(list, /k-missile/);
  assert.match(eventListMarkup([]), /No events/);
});

test('the timeline groups events by month and lists unplaced incidents without a position', async () => {
  const { eventTimelineMarkup, eventGroupMarkup, eventCardMarkup } = await import('../dist/ops/panels.mjs');
  const base = { layer: 'shipping', confidence: 'confirmed', title: 'Incident', place: 'Strait of Hormuz', precision: 'area', sources: [] };
  const events = [
    { ...base, id: 'imo:a', date: '2026-10-13', precision: 'unplaced', place: '6NM from the coast of Oman' },
    { ...base, id: 'war:b', date: '2026-10-02' },
    { ...base, id: 'war:c', date: '2026-09-29' },
  ];
  const html = eventTimelineMarkup(events);
  assert.match(html, /October 2026 <span>2<\/span>[\s\S]*September 2026 <span>1<\/span>/);
  assert.match(html, /6NM from the coast of Oman · not on the map/);
  assert.match(eventTimelineMarkup([]), /No events/);
  assert.match(eventCardMarkup(events[0], {}), /not placed on the map/);
  const group = eventGroupMarkup([{ ...base, id: 'war:d', date: '2026-10-13', place: 'Sanaa' }, { ...base, id: 'war:e', date: '2026-10-01', place: 'Sanaa' }]);
  assert.match(group, /2 events · Sanaa/); assert.match(group, /data-event-id="war:d"[\s\S]*data-event-id="war:e"/); assert.match(group, /data-close-event/);
});

test('the left-hand prices follow an inspected date and never carry a price over a gap', async () => {
  const { shownPrices } = await import('../dist/ops/panels.mjs');
  const oil = { series: [
    { id: 'brent', observations: [{ date: '2026-10-13', value: 120 }, { date: '2026-10-14', value: 126.55 }] },
    { id: 'wti', observations: [{ date: '2026-10-14', value: 112 }] },
  ], latestCloses: [{ id: 'brent', value: 115.22, date: '2026-10-20', basis: 'Wholesale spot close (Refinitiv)' }, { id: 'wti', value: 107.89, date: '2026-10-20', basis: 'Wholesale spot close (Refinitiv)' }] };
  const latest = shownPrices(oil);
  assert.equal(latest.inspecting, false);
  assert.equal(latest.brent.value, '$115.22'); assert.match(latest.brent.date, /20 Oct · Wholesale spot close/);
  const past = shownPrices(oil, { date: '2026-10-13', values: [{ id: 'brent', value: 120 }, { id: 'wti', value: null }] });
  assert.equal(past.inspecting, true);
  assert.equal(past.brent.value, '$120.00'); assert.equal(past.brent.date, '13 Oct · EIA daily spot');
  assert.equal(past.wti.value, '—'); assert.equal(past.wti.date, 'No observation on 13 Oct');
  assert.equal(shownPrices(oil, { date: '2026-10-20', values: [] }).inspecting, false, 'the newest date is the latest view');
  assert.deepEqual(shownPrices(null).brent, { value: '—', date: '' }, 'still loading says nothing yet');
});
