import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOilChartModel, oilReadout, nearestOilDate } from '../dist/oil-chart-view.mjs';

const series = (id, observations) => ({ id, name: id === 'brent' ? 'Brent' : 'WTI', observations });

test('oil chart uses exact observed dates and never substitutes a nearby price', () => {
  const model = buildOilChartModel([
    series('brent', [{ date: '2026-09-28', value: 78.4 }, { date: '2026-09-30', value: 80 }]),
    series('wti', [{ date: '2026-09-29', value: 75 }]),
  ]);
  assert.deepEqual(model.dates, ['2026-09-28', '2026-09-29', '2026-09-30']);
  assert.deepEqual(oilReadout(model, '2026-09-29').values.map(x => x.value), [null, 75]);
  assert.equal(oilReadout(model, '2026-09-27'), null);
  assert.match(oilReadout(model, '2026-09-29').text, /Brent: no observation/);
});

test('oil chart preserves real zero and negative prices but rejects coercible missing values', () => {
  const model = buildOilChartModel([series('wti', [
    { date: '2026-09-21', value: -37.63 }, { date: '2026-09-22', value: 0 },
    { date: '2026-09-23', value: null }, { date: '2026-09-24', value: '' },
    { date: '2026-09-25', value: NaN }, { date: '2026-09-26', value: Infinity },
    { date: '2026-09-27', value: '74.2' }, { date: '2026-09-31', value: 75 },
  ])]);
  assert.deepEqual(model.dates, ['2026-09-21', '2026-09-22']);
  assert.deepEqual(model.series[0].points.map(p => p.value), [-37.63, 0]);
  assert.equal(oilReadout(model, '2026-09-22').values[0].value, 0);
  assert.ok(model.yMin < -37.63);
  assert.ok(model.yMax > 0);
});

test('line segments break across more than four calendar days and explicit missing values', () => {
  const model = buildOilChartModel([series('brent', [
    { date: '2026-09-18', value: 70 }, { date: '2026-09-21', value: 71 },
    { date: '2026-09-22', value: null }, { date: '2026-09-23', value: 72 },
    { date: '2026-09-28', value: 74 }, { date: '2026-09-29', value: 75 },
  ])]);
  assert.deepEqual(model.series[0].segments.map(s => s.map(p => p.date)), [
    ['2026-09-18', '2026-09-21'], ['2026-09-23'], ['2026-09-28', '2026-09-29'],
  ]);
  assert.equal(model.breakCount, 2);
});

test('calendar-day period excludes older points without inventing daily observations', () => {
  const model = buildOilChartModel([series('brent', [
    { date: '2026-08-31', value: 69 }, { date: '2026-09-01', value: 70 },
    { date: '2026-09-30', value: 78 },
  ])], { period: 30 });
  assert.deepEqual(model.dates, ['2026-09-01', '2026-09-30']);
  assert.equal(new Date(model.begin).toISOString().slice(0, 10), '2026-09-01');
  assert.equal(model.series[0].segments.length, 2);
});

test('points are sorted and duplicate dates take the last provided value', () => {
  const model = buildOilChartModel([series('brent', [
    { date: '2026-09-30', value: 78 }, { date: '2026-09-29', value: 77 },
    { date: '2026-09-30', value: 79 },
  ])]);
  assert.deepEqual(model.series[0].points.map(p => p.value), [77, 79]);
});

test('nearest date lookup chooses an actual observation and clamps beyond the chart', () => {
  const model = buildOilChartModel([series('brent', [
    { date: '2026-09-25', value: 70 }, { date: '2026-09-28', value: 71 },
  ])]);
  assert.equal(nearestOilDate(model, Date.parse('2026-09-27T00:00:00Z')), '2026-09-28');
  assert.equal(nearestOilDate(model, 0), '2026-09-25');
  assert.equal(nearestOilDate(model, Date.now() + 864000000000), '2026-09-28');
  assert.equal(nearestOilDate(model, NaN), null);
});

test('empty and constant series have safe finite chart domains', () => {
  const empty = buildOilChartModel([series('brent', [{ date: '2026-09-30', value: null }])]);
  assert.equal(empty.hasData, false);
  assert.equal(empty.latest, null);
  assert.equal(nearestOilDate(empty, 0), null);
  const constant = buildOilChartModel([series('brent', [{ date: '2026-09-30', value: 80 }])]);
  assert.ok(constant.yMin < 80 && constant.yMax > 80);
  assert.ok(Number.isFinite(constant.yMin) && Number.isFinite(constant.yMax));
  assert.equal(constant.breakCount, 0);
});

test('future observations cannot change the latest date, price domain or history window', () => {
  const now = Date.parse('2026-09-30T00:00:00Z');
  const model = buildOilChartModel([series('brent', [
    { date: '2026-09-29', value: 78 }, { date: '2026-09-30', value: 79 },
    { date: '2026-10-01', value: 1000 },
  ])], { now });
  assert.deepEqual(model.dates, ['2026-09-29', '2026-09-30']);
  assert.equal(model.latest, now);
  assert.ok(model.yMax < 100);
  assert.equal(oilReadout(model, '2026-10-01'), null);
  assert.equal(buildOilChartModel([series('brent', [{ date: '2026-10-01', value: 1000 }])], { now }).hasData, false);
});
