import test from 'node:test';
import assert from 'node:assert/strict';
import { curatedEvents, curatedMissions, activeMissions, registerEvents, unplacedRegisterEvents, located, mergeEvents, visibleEvents, countsByLayer, priceMove, oddsMove, relatedMarkets, WAR_START } from '../dist/ops/events.mjs';

const source = { publisher: 'Reuters', title: 'Report', url: 'https://www.reuters.com/x', date: '2026-03-02' };
const event = (fields = {}) => ({ id: '2026-03-02-test', date: '2026-03-02', layer: 'strikes-on-iran-yemen', type: 'air-strike', actor: 'United States', target: 'Air base', place: 'Bandar Abbas', country: 'Iran', lat: 27.18, lon: 56.28, precision: 'city', confidence: 'confirmed', title: 'Strike near Bandar Abbas', summary: 'A strike was reported.', sources: [source], ...fields });

test('curated events are kept only when dated, located, layered and sourced', () => {
  const kept = curatedEvents({ events: [
    event(),
    event({ id: 'future', date: '2026-12-01' }),
    event({ id: 'no-source', sources: [] }),
    event({ id: 'http-source', sources: [{ ...source, url: 'http://example.com' }] }),
    event({ id: 'bad-layer', layer: 'rumour' }),
    event({ id: 'no-coords', lat: NaN }),
    event({ id: 'claimed', confidence: 'claimed', precision: 'nowhere' }),
  ] }, { today: '2026-10-21' });
  assert.deepEqual(kept.map(e => e.id), ['war:2026-03-02-test', 'war:claimed']);
  assert.equal(kept[1].confidence, 'claimed');
  assert.equal(kept[1].precision, 'area', 'unknown precision falls back to the least precise class');
  assert.deepEqual(curatedEvents(null), []);
});

test('missions need a dated start, a real polygon and a source', () => {
  const missions = curatedMissions({ missions: [
    { id: 'aspides', name: 'EU Aspides', operator: 'EU', start: '2024-02-19', end: null, area: 'Red Sea', polygon: [[40, 12], [44, 12], [44, 16], [40, 16]], sources: [source] },
    { id: 'thin', start: '2026-05-04', polygon: [[56, 26], [57, 26]], sources: [source] },
  ] });
  assert.deepEqual(missions.map(m => m.id), ['mission:aspides']);
  assert.equal(missions[0].end, null);
  assert.deepEqual(missions[0].labelAt, [42, 14], 'without a label point the label sits at the vertex average');
  const placed = curatedMissions({ missions: [{ id: 'p', start: '2026-05-04', polygon: [[40, 12], [44, 12], [44, 16]], labelAt: [43, 13], sources: [source] }] });
  assert.deepEqual(placed[0].labelAt, [43, 13]);
});

test('only missions under way on the day are drawn', () => {
  const polygon = [[56, 24], [58, 24], [58, 26]];
  const missions = curatedMissions({ missions: [
    { id: 'escort', start: '2026-05-04', end: '2026-05-05', polygon, sources: [source] },
    { id: 'blockade', start: '2026-07-14', end: null, polygon, sources: [source] },
  ] });
  assert.deepEqual(activeMissions(missions, '2026-05-05').map(m => m.id), ['mission:escort'], 'the end day is still active');
  assert.deepEqual(activeMissions(missions, '2026-06-01'), []);
  assert.deepEqual(activeMissions(missions, '2026-10-21').map(m => m.id), ['mission:blockade']);
  assert.deepEqual(activeMissions(missions, 'today'), []);
});

test('register incidents appear only when the collector could place them, and stay approximate', () => {
  const maritime = { events: [
    { id: 'imo-1', title: 'TEST SHIP · maritime incident', shipName: 'TEST SHIP', eventDate: '2026-03-02', url: 'https://www.imo.org/x', locationText: '20 NM west of Fujairah', location: { lat: 25.1, lon: 56, radiusNm: 5, reference: 'Fujairah' } },
    { id: 'imo-2', title: 'Unplaced', eventDate: '2026-03-03', location: null },
    { id: 'imo-3', title: 'Before the war', eventDate: '2026-01-10', location: { lat: 25, lon: 56 } },
  ] };
  const located = registerEvents(maritime);
  assert.deepEqual(located.map(e => e.id), ['imo:imo-1']);
  assert.equal(located[0].precision, 'area'); assert.equal(located[0].radiusNm, 5);
  assert.equal(located[0].sources[0].publisher, 'IMO');
  assert.equal(located[0].title, 'Incident involving TEST SHIP'); assert.equal(located[0].target, 'TEST SHIP');
});

test('a register incident matching a curated shipping event merges into it instead of duplicating', () => {
  const curated = curatedEvents({ events: [event({ id: 'ship', layer: 'shipping', type: 'shipping-attack', lat: 25.2, lon: 56.4 })] }, { today: '2026-10-21' });
  const register = registerEvents({ events: [
    { id: 'same', title: 'Tanker hit', eventDate: '2026-03-03', url: 'https://www.imo.org/x', location: { lat: 25.3, lon: 56.6 } },
    { id: 'elsewhere', title: 'Bulk carrier hit', eventDate: '2026-03-03', url: 'https://www.imo.org/y', location: { lat: 13.5, lon: 42.8 } },
  ] });
  const merged = mergeEvents(curated, register);
  assert.deepEqual(merged.map(e => e.id).sort(), ['imo:elsewhere', 'war:ship']);
  assert.deepEqual(merged.find(e => e.id === 'war:ship').sources.map(s => s.publisher), ['Reuters', 'IMO']);
  assert.equal(curated[0].sources.length, 1, 'inputs are not mutated');
});

test('layer and window filters, and counts per layer', () => {
  const events = curatedEvents({ events: [event({ id: 'a' }), event({ id: 'b', layer: 'shipping', date: '2026-10-01' }), event({ id: 'c', layer: 'missile-drone', date: '2026-02-28' })] }, { today: '2026-10-21' });
  assert.equal(visibleEvents(events).length, 3);
  assert.deepEqual(visibleEvents(events, { layers: ['shipping'] }).map(e => e.id), ['war:b']);
  assert.deepEqual(visibleEvents(events, { from: '2026-09-21' }).map(e => e.id), ['war:b']);
  assert.deepEqual(countsByLayer(events), { shipping: 1, 'missile-drone': 1, 'strikes-on-iran-yemen': 1 });
  assert.equal(WAR_START, '2026-02-28');
});

test('price moves use the last observation on or before the event and stay null when later prices are missing', () => {
  const obs = [{ date: '2026-03-02', value: 80 }, { date: '2026-03-03', value: 82 }, { date: '2026-03-04', value: null }, { date: '2026-03-05', value: 84 }, { date: '2026-03-06', value: 86 }];
  const weekend = priceMove(obs, '2026-03-01');
  assert.equal(weekend, null, 'no observation on or before the event date');
  const move = priceMove(obs, '2026-03-02');
  assert.equal(move.before.date, '2026-03-02'); assert.equal(move.after.date, '2026-03-06', 'three trading days, skipping a missing value');
  assert.equal(move.change, 6); assert.ok(Math.abs(move.percent - 7.5) < 1e-9);
  const late = priceMove(obs, '2026-03-05');
  assert.equal(late.after, null); assert.equal(late.change, null);
  assert.equal(priceMove(obs, 'not-a-date'), null);
});

test('odds moves read daily history at the event day and three days later', () => {
  const day = d => Date.parse(d + 'T12:00:00Z') / 1000;
  const history = [[day('2026-03-01'), .2], [day('2026-03-02'), .25], [day('2026-03-04'), .4], [day('2026-03-05'), 2]];
  const move = oddsMove(history, '2026-03-02');
  assert.equal(move.before.p, .25); assert.equal(move.after.p, .4);
  assert.equal(oddsMove(history, '2026-02-01'), null, 'no history before the event');
  assert.equal(oddsMove([[day('2026-03-02'), .3]], '2026-03-02').after, null, 'no later point means no move');
});

test('related markets follow the event layer and require history', () => {
  const markets = [
    { question: 'Will the Houthis attack shipping?', topic: 'Shipping attacks', history: [[1, .1]] },
    { question: 'US-Iran ceasefire?', topic: 'Diplomacy', history: [[1, .5]] },
    { question: 'Tanker seized?', topic: 'Tanker seizure' },
  ];
  assert.deepEqual(relatedMarkets(markets, { layer: 'shipping' }).map(m => m.topic), ['Shipping attacks']);
  assert.deepEqual(relatedMarkets(markets, { layer: 'strikes-on-iran-yemen' }).map(m => m.topic), ['Diplomacy']);
  assert.deepEqual(relatedMarkets(null, { layer: 'shipping' }), []);
});

test('two register incidents never merge with each other, even on the same day and close together', () => {
  const register = registerEvents({ events: [
    { id: 'one', title: 'A', shipName: 'ALPHA', eventDate: '2026-09-29', url: 'https://www.imo.org/x', location: { lat: 26.5, lon: 56.4 } },
    { id: 'two', title: 'B', shipName: 'BRAVO', eventDate: '2026-09-29', url: 'https://www.imo.org/x', location: { lat: 26.6, lon: 56.5 } },
  ] });
  assert.deepEqual(mergeEvents([], register).map(e => e.id).sort(), ['imo:one', 'imo:two']);
});

test('an unplaced register incident is listed without a position, or joins the curated event that names its ship', () => {
  const maritime = { events: [
    { id: 'giselle', title: 'GFS GISELLE', shipName: 'GFS GISELLE', eventDate: '2026-10-13', url: 'https://www.imo.org/x', locationText: '6NM from the coast of Oman', location: null },
    { id: 'saadiyat', title: 'AL SAADIYAT', shipName: 'AL SAADIYAT', eventDate: '2026-10-13', url: 'https://www.imo.org/x', locationText: '1 NM from the coast of Oman', location: null },
    { id: 'placed', title: 'P', eventDate: '2026-10-13', location: { lat: 25, lon: 56 } },
    { id: 'old', title: 'O', eventDate: '2026-01-01', location: null },
  ] };
  const unplaced = unplacedRegisterEvents(maritime);
  assert.deepEqual(unplaced.map(e => e.id), ['imo:giselle', 'imo:saadiyat']);
  assert.equal(unplaced[0].lat, null); assert.equal(unplaced[0].precision, 'unplaced'); assert.equal(unplaced[0].place, '6NM from the coast of Oman');
  const curated = curatedEvents({ events: [event({ id: 'pride', layer: 'shipping', type: 'shipping-attack', date: '2026-10-13', lat: 26.3, lon: 56.6, title: 'GFS Pride sinks', summary: 'Sister ship GFS Giselle was damaged.' })] }, { today: '2026-10-21' });
  const merged = mergeEvents(curated, [...registerEvents(maritime), ...unplaced]);
  assert.deepEqual(merged.map(e => e.id).sort(), ['imo:placed', 'imo:saadiyat', 'war:pride']);
  assert.ok(merged.find(e => e.id === 'war:pride').sources.some(s => s.publisher === 'IMO'));
  assert.deepEqual(located(merged).map(e => e.id).sort(), ['imo:placed', 'war:pride'], 'only events with a position are drawn');
});
