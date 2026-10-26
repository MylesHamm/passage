// Oil and odds: the Brent and WTI chart with every war event on its time axis,
// and the Polymarket questions on the war. A tick opens that event's page.
import '../site/shell.mjs';
import { $, load, every, stamp, fetchEvents, eventHref, DAY } from '../site/data.mjs';
import { createOilChart } from '../oil-chart-view.mjs';
import { shownPrices, chartSeries, oddsMarkup, ageLabel, dayLabel, money, esc } from '../ops/panels.mjs';
import { WAR_START } from '../ops/events.mjs';
import { fill, stepRows } from '../site/stories.mjs';

const state = { oil: null, expectations: null, events: null, period: 'war', inspected: null };
let chart = null;
const warDays = () => Math.ceil((Date.now() - Date.parse(WAR_START + 'T00:00:00Z')) / DAY) + 1;

/** The header's figures: each price's move since its last close before the war, both ends dated, and the events marked on the chart. */
function renderProof() {
  const item = (label, value, note) => `<li><span class="label">${label}</span><span class="value">${value}</span><span class="note">${note}</span></li>`;
  const since = (id, name) => {
    const rows = (chartSeries(state.oil).find(series => series.id === id)?.observations || []).filter(o => Number.isFinite(o.value));
    const before = rows.filter(o => o.date < WAR_START).at(-1), now = rows.at(-1);
    if (!before || !now || now.date <= before.date) return item(`${name} since the war`, '—', 'no observation before 28 Feb');
    const change = now.value - before.value;
    return item(`${name} since the war`, `${change >= 0 ? '+' : '−'}${esc(money(Math.abs(change)))}`, `${esc(money(before.value))} on ${esc(dayLabel(before.date))} to ${esc(money(now.value))} on ${esc(dayLabel(now.date))}`);
  };
  const marked = (state.events?.events || []).length;
  $('#oil-proof').innerHTML = since('brent', 'Brent') + since('wti', 'WTI') + item('Events marked', marked || '—', marked ? 'ticks on the time axis' : 'loading the event list');
}
/** The left-hand prices follow the date inspected on the chart, and show the latest close otherwise. */
function renderPrices(detail = state.inspected) {
  state.inspected = detail;
  const shown = shownPrices(state.oil, detail);
  for (const id of ['brent', 'wti']) { $(`#${id}-latest`).textContent = shown[id].value; $(`#${id}-date`).textContent = shown[id].date; }
  $('.price-panel').dataset.inspecting = String(shown.inspecting);
}
function renderChart() {
  renderPrices();
  chart.update(chartSeries(state.oil), { period: state.period === 'war' ? warDays() : state.period, loading: !state.oil });
  chart.setMarkers((state.events?.events || []).map(e => ({ id: e.id, date: e.date, layer: e.layer, label: `${dayLabel(e.date)} · ${e.title}` })));
}
async function loadOil() {
  try { state.oil = await load('/api/oil'); }
  catch { chart.update(chartSeries(state.oil), { period: state.period === 'war' ? warDays() : state.period, failed: true }); if (!state.oil) $('#oil-proof').innerHTML = '<li><span class="error-note">Oil prices are unavailable right now.</span></li>'; return; }
  renderProof(); renderChart();
}
async function loadOdds() {
  try { state.expectations = await load('/api/expectations'); }
  catch { stamp($('#odds-stamp'), 'Unavailable', 'down'); if (!state.expectations) $('#odds-list').innerHTML = '<li class="error-note">Market odds are unavailable right now.</li>'; return; }
  const first = !state.oddsShown;
  $('#odds-list').innerHTML = oddsMarkup(state.expectations.markets, { limit: 10 });
  // The probability bars fill like progress the first time they appear.
  if (first) { state.oddsShown = true; fill($('#odds-list').querySelectorAll('.odds-bar i')); }
  const checked = state.expectations.checkedAt || state.expectations.retrievedAt;
  stamp($('#odds-stamp'), checked ? `Polymarket · ${ageLabel(Date.now() - Date.parse(checked))}` : 'Polymarket');
}
async function loadEvents() { state.events = await fetchEvents(state.events); renderChart(); if (state.oil) renderProof(); }

function start() {
  stepRows($('#odds-list'), { offset: .4 });
  chart = createOilChart($('#oil-chart'), { height: 300, onMarker: id => { const event = state.events?.events.find(e => e.id === id); if (event) location.href = eventHref(event); }, onReadout: detail => renderPrices(detail) });
  document.querySelectorAll('[data-period]').forEach(button => button.addEventListener('click', () => {
    state.period = button.dataset.period === 'war' ? 'war' : Number(button.dataset.period);
    document.querySelectorAll('[data-period]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    renderChart();
  }));
  $('#inspect').addEventListener('click', () => {
    const input = $('#oil-chart input[type=range]');
    $('#prices').scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    input?.focus({ preventScroll: true });
  });
  every(600_000, loadOil);
  every(60_000, loadOdds);
  every(300_000, loadEvents);
}
start();
