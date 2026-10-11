import test from 'node:test';
import assert from 'node:assert/strict';
import { SYSTEM_STAGES, normalizeStage, buildOilSystemState } from '../dist/oil-system-model.mjs';

const now = Date.parse('2026-10-11T16:00:00Z');
const point = (date, value) => ({ date, value });
const series = (observations, extra = {}) => ({ id: 'brent', connection: 'connected', retrievedAt: '2026-10-11T15:30:00Z', observations, ...extra });
const model = (input = {}) => buildOilSystemState({ now, ...input });

test('invalid selections normalize to one real assembly without inventing a report or observed disruption', () => {
  const state = model({ selected: '<script>', theater: 'elsewhere' });
  assert.equal(normalizeStage('transport'), 'transport');
  assert.equal(normalizeStage(null), 'supply');
  assert.equal(state.selected, 'supply');
  assert.equal(state.activeStage.id, state.selected);
  assert.equal(state.stages.filter(stage => stage.selected).length, 1);
  assert.equal(state.context.theater, 'both');
  assert.equal(state.context.report, null);
  assert.deepEqual(state.context.matchedStageIds, []);
  assert.match(state.context.label, /No report selected/);
  assert.match(state.schematicNote, /not observed flows/);
  assert.ok(SYSTEM_STAGES.every(stage => stage.sourceUrl.startsWith('https://www.eia.gov/')));
});

test('selection, explanation and expansion use one state while price observations remain unchanged', () => {
  const oil = { series: [series([point('2026-10-09', 99.25)])] };
  const joined = model({ oil, selected: 'transport', expanded: false });
  const expanded = model({ oil, selected: 'transport', expanded: true });
  assert.equal(joined.caption, joined.activeStage.explanation);
  assert.equal(expanded.activeStage.id, 'transport');
  assert.deepEqual(expanded.prices, joined.prices);
  assert.notDeepEqual(expanded.stages.map(stage => stage.position), joined.stages.map(stage => stage.position));
  for (const stage of expanded.stages) {
    assert.equal(stage.position.x, stage.origin.x + stage.offset.x);
    assert.equal(stage.position.y, stage.origin.y + stage.offset.y);
    assert.ok(Number.isFinite(stage.position.x) && Number.isFinite(stage.position.y));
  }
});

test('a report suggests channels but never asserts a measured price effect', () => {
  const report = { title: 'Tanker attack interrupts terminal exports', summary: 'A vessel was damaged.', publishedAt: '2026-10-10T15:00:00Z' };
  const before = structuredClone(report);
  const state = model({ report, theater: 'hormuz' });
  assert.deepEqual(state.context.matchedStageIds, ['supply', 'transport', 'risk']);
  assert.ok(state.context.mechanisms.every(item => item.basis === 'Potential channel; effect not measured'));
  assert.match(state.context.label, /suggests/);
  assert.match(state.priceNote, /does not establish/);
  assert.deepEqual(report, before);
  assert.equal(state.context.title, 'Strait of Hormuz');
});

test('a report without matching terms is distinct from no selected report', () => {
  const state = model({ report: { title: 'Delegates meet for talks' }, selected: 'benchmarks', theater: 'bab' });
  assert.equal(state.context.report.title, 'Delegates meet for talks');
  assert.deepEqual(state.context.matchedStageIds, []);
  assert.match(state.context.label, /No oil channel identified/);
  assert.equal(state.activeStage.id, 'benchmarks');
  assert.equal(state.context.title, 'Bab el-Mandeb');
});

test('latest finite actual calendar observation wins despite order, malformed dates and future values', () => {
  const observations = [point('2026-10-09', 99), point('2026-10-08', 98), point('2026-10-12', 500), point('2026-09-31', 400), point('2026-10-11', null), point('2026-10-10', '101'), point('2026-10-11', Infinity), point('2026-10-09', 100)];
  const before = structuredClone(observations);
  const state = model({ oil: { series: [series(observations)] } });
  assert.equal(state.prices[0].value, 100);
  assert.equal(state.prices[0].date, '2026-10-09');
  assert.equal(state.prices[0].ageDays, 2);
  assert.equal(state.prices[0].status, 'available');
  assert.equal(state.prices[0].unit, 'USD/barrel');
  assert.equal(state.prices[1].value, null);
  assert.deepEqual(observations, before);
});

test('zero and negative observed values survive and duplicate series cannot add another benchmark', () => {
  const state = model({ oil: { series: [series([point('2026-10-09', 0)]), series([point('2026-10-09', 200)]), series([point('2026-10-09', -37)], { id: 'wti' })] } });
  assert.deepEqual(state.prices.map(price => price.value), [0, -37]);
  assert.deepEqual(state.prices.map(price => price.id), ['brent', 'wti']);
});

test('loading, empty and unavailable price states remain distinct with no synthetic zero', () => {
  assert.equal(model().prices[0].status, 'loading');
  assert.equal(model({ oil: { series: [] } }).prices[0].status, 'empty');
  const failed = model({ oilFailed: true });
  assert.equal(failed.prices[0].status, 'unavailable');
  assert.equal(failed.prices[0].value, null);
  assert.equal(failed.prices[0].date, null);
});

test('failed refresh retains dated values and error metadata without calling them current', () => {
  const oil = { series: [series([point('2026-10-09', 100)], { error: 'Provider unavailable', connection: 'cached' })] };
  const price = model({ oil }).prices[0];
  assert.equal(price.status, 'retained');
  assert.equal(price.value, 100);
  assert.equal(price.date, '2026-10-09');
  assert.equal(price.failed, true);
  assert.equal(price.error, 'Provider unavailable');
  assert.equal(price.retrievedAt, '2026-10-11T15:30:00Z');
  assert.equal(model({ oil: { series: [series([point('2026-10-09', 100)])] }, oilFailed: true }).prices[0].status, 'retained');
});

test('stale observations and unknown retrieval timestamps stay visible separately from the observation date', () => {
  const state = model({ oil: { series: [series([point('2026-09-30', 100)]), series([point('2026-10-09', 90)], { id: 'wti', retrievedAt: '2026-10-12T00:00:00Z' })] } });
  assert.equal(state.prices[0].status, 'stale');
  assert.equal(state.prices[0].stale, true);
  assert.equal(state.prices[1].status, 'unknown');
  assert.equal(state.prices[1].retrievedAt, null);
  assert.equal(state.prices[1].date, '2026-10-09');
});

test('malformed containers and loading responses cannot throw or claim a price observation', () => {
  assert.equal(model({ oil: { series: 'wrong' }, report: 'wrong' }).context.report, null);
  const state = model({ oil: { series: [null, series({}, { connection: 'loading' })] } });
  assert.equal(state.prices[0].status, 'loading');
  assert.equal(state.prices[0].value, null);
});


test('report publication preserves day-only dates and never substitutes discovery time', () => {
  assert.deepEqual(model({report:{publishedAt:null,publishedDate:'2026-09-21'}}).context.publication,{value:'2026-09-21',precision:'day'});
  assert.deepEqual(model({report:{publicationDate:'2026-09-22'}}).context.publication,{value:'2026-09-22',precision:'day'});
  assert.equal(model({report:{publishedAt:'bad',publishedDate:'2026-09-31',discoveredAt:'2026-10-11T12:00:00Z'}}).context.publication,null);
  assert.deepEqual(model({report:{publishedAt:'2026-10-10T12:00:00Z'}}).context.publication,{value:'2026-10-10T12:00:00Z',precision:'time'});
});
