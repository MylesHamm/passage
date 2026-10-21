import test from 'node:test';
import assert from 'node:assert/strict';
import { curatedEvents, curatedMissions, registerEvents, mergeEvents, visibleEvents, countsByLayer, priceMove, oddsMove, relatedMarkets, WAR_START } from '../dist/ops/events.mjs';

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
