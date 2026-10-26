import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOilChartModel, oilReadout, nearestOilDate, createOilChart } from '../dist/oil-chart-view.mjs';

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

function chartHarness(t) {
  const nodes = new Map();
  class Node extends EventTarget {
    innerHTML = ''; textContent = ''; hidden = false; clientWidth = 620;
    attributes = new Map();
    classList = { add() {}, remove() {} };
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    querySelector(selector) {
      if (selector === '[data-chart-focus]') return this.innerHTML.includes('<svg') ? nodes.get(selector) : null;
      return nodes.get(selector) ?? null;
    }
    replaceChildren() { this.innerHTML = ''; }
  }
  for (const selector of ['[data-chart-plot]', '[data-chart-readout]', 'input', '[data-chart-controls]', '[data-chart-note]', '[data-chart-window]', '[data-chart-focus]']) nodes.set(selector, new Node());
  const mount = new Node(), readouts = [];
  const view = createOilChart(mount, { onReadout: detail => readouts.push(detail) });
  t.after(() => view.destroy());
  return { view, mount, readouts, q: selector => nodes.get(selector) };
}

test('the oil chart distinguishes initial loading, a successful empty response and a failed request', t => {
  const h = chartHarness(t), plot = h.q('[data-chart-plot]'), window = h.q('[data-chart-window]');
  assert.match(plot.innerHTML, /Checking daily EIA observations/);
  assert.doesNotMatch(plot.innerHTML, /No daily oil observations|could not be loaded/);
  assert.equal(h.mount.getAttribute('aria-busy'), 'true');
  assert.equal(h.q('[data-chart-controls]').hidden, true);

  h.view.update([], { loading: false, failed: false });
  assert.match(plot.innerHTML, /No daily oil observations.*current response/);
  assert.equal(window.textContent, 'No observations');
  assert.equal(h.mount.getAttribute('aria-busy'), 'false');

  h.view.update([], { failed: true });
  assert.match(plot.innerHTML, /could not be loaded/);
  assert.match(plot.innerHTML, /Inspect Sources/);
  assert.equal(window.textContent, 'Observations unavailable');
  assert.equal(h.q('[data-chart-controls]').hidden, true);
  assert.equal(h.q('[data-chart-readout]').innerHTML, '');
  assert.match(h.q('[data-chart-note]').textContent, /Missing prices are not zero/);

  h.view.update([], { loading: true });
  assert.match(plot.innerHTML, /Checking daily EIA observations/);
  assert.equal(h.mount.getAttribute('aria-busy'), 'true');
});

test('failed or pending updates retain supplied observations, their selected date and keyboard control', t => {
  const h = chartHarness(t), input = h.q('input');
  const observations = [series('brent', [{ date: '2026-09-28', value: 76 }, { date: '2026-09-29', value: 77 }])];
  h.view.update(observations);
  input.value = '0'; input.dispatchEvent(new Event('input'));
  assert.match(input.getAttribute('aria-valuetext'), /28 Sept? 2026.*76\.00/);

  for (const state of [{ failed: true }, { loading: true }]) {
    h.view.update(observations, state);
    assert.match(h.q('[data-chart-plot]').innerHTML, /<svg/);
    assert.equal(h.q('[data-chart-controls]').hidden, false);
    assert.equal(h.q('input'), input, 'the same native date control must survive the update');
    assert.equal(input.value, '0');
    assert.match(input.getAttribute('aria-valuetext'), /28 Sept? 2026.*76\.00/);
    assert.match(h.q('[data-chart-note]').textContent, state.failed ? /Update failed.*retained observations/ : /Checking for updates.*retained observations/);
  }
  input.value = '1'; input.dispatchEvent(new Event('input'));
  assert.equal(h.readouts.at(-1).date, '2026-09-29');
  assert.match(h.q('[data-chart-readout]').innerHTML, /77\.00/);
  h.view.update(observations);
  assert.doesNotMatch(h.q('[data-chart-note]').textContent, /Update failed|Checking for updates|retained observations/);
  assert.equal(h.mount.getAttribute('aria-busy'), 'false');
});

test('four-day omitted intervals connect, five-day gaps and a last duplicate null break across every price surface',()=>{
  const model=buildOilChartModel([series('brent',[
    {date:'2026-09-17',value:70},{date:'2026-09-21',value:71},
    {date:'2026-09-22',value:72},{date:'2026-09-22',value:null},
    {date:'2026-09-23',value:73},{date:'2026-09-28',value:74},
  ])]);
  assert.deepEqual(model.series[0].segments.map(segment=>segment.map(point=>point.date)),[
    ['2026-09-17','2026-09-21'],['2026-09-23'],['2026-09-28'],
  ]);
  assert.equal(model.breakCount,2);
  assert.equal(oilReadout(model,'2026-09-22'),null);
});

test('isolated oil observations render as visible circles without an invalid path',t=>{
  const h=chartHarness(t);
  h.view.update([series('brent',[{date:'2026-09-28',value:null},{date:'2026-09-29',value:80}])]);
  const html=h.q('[data-chart-plot]').innerHTML;
  assert.match(html,/<circle[^>]+class="oil-chart-observation oil-series-brent"/);
  assert.doesNotMatch(html,/<path[^>]+class="oil-chart-line|d="L|NaN|undefined/);
});

test('event ticks sit only on plotted dates and a focus window reads out its event date', t => {
  const h = chartHarness(t), plot = h.q('[data-chart-plot]');
  const series = [{ id: 'brent', name: 'Brent', observations: [{ date: '2026-09-01', value: 80 }, { date: '2026-09-02', value: 81 }, { date: '2026-09-03', value: 82 }, { date: '2026-09-04', value: 83 }] }];
  h.view.update(series, { period: 90, now: Date.parse('2026-09-05T00:00:00Z') });
  h.view.setMarkers([{ id: 'in', date: '2026-09-02', layer: 'shipping', label: 'Inside' }, { id: 'out', date: '2026-10-01', layer: 'shipping' }, { id: 'bad', date: 'x' }]);
  assert.match(plot.innerHTML, /data-marker-id="in"/);
  assert.doesNotMatch(plot.innerHTML, /data-marker-id="out"/, 'events after the last observation are not placed on the axis');
  h.view.focus({ id: 'in', date: '2026-09-02', endDate: '2026-09-04' });
  assert.match(plot.innerHTML, /oil-chart-focus-band/);
  assert.match(plot.innerHTML, /data-marker-id="in" data-selected="true"/);
  assert.equal(h.q('input').getAttribute('aria-valuetext').startsWith('2 Sep'), true);
  h.view.focus(null);
  assert.doesNotMatch(plot.innerHTML, /oil-chart-focus-band/);
});

test('a mouse leaving the plot returns the reading to its resting date, a lifted finger keeps it', t => {
  const h = chartHarness(t), plot = h.q('[data-chart-plot]');
  const series = [{ id: 'brent', name: 'Brent', observations: [{ date: '2026-09-01', value: 80 }, { date: '2026-09-02', value: 81 }, { date: '2026-09-03', value: 82 }] }];
  h.view.update(series, { period: 90, now: Date.parse('2026-09-05T00:00:00Z') });
  const input = h.q('input');
  input.value = '0'; input.dispatchEvent(new Event('input'));
  assert.equal(h.readouts.at(-1).date, '2026-09-01');
  const leave = type => { const event = new Event('pointerleave'); event.pointerType = type; plot.dispatchEvent(event); };
  leave('touch');
  assert.equal(h.readouts.at(-1).date, '2026-09-01', 'a lifted finger keeps its reading');
  leave('mouse');
  assert.equal(h.readouts.at(-1), null, 'the page is told the reading is back at rest');
  assert.equal(input.value, '2', 'the chart is back on the latest date');
  h.view.focus({ id: 'e', date: '2026-09-02', endDate: null });
  input.value = '0'; input.dispatchEvent(new Event('input')); leave('mouse');
  assert.equal(input.value, '1', 'with an event in focus, the reading rests on the event date');
});
