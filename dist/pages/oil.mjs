// Oil and odds: the Brent and WTI chart with every war event on its time axis,
// and the Polymarket questions on the war. A tick opens that event's page.
import '../site/shell.mjs';
import { $, load, every, stamp, fetchEvents, eventHref, brentObservations, DAY } from '../site/data.mjs';
import { createOilChart } from '../oil-chart-view.mjs';
import { shownPrices, latestPrices, chartSeries, oddsMarkup, ageLabel, dayLabel, money, esc } from '../ops/panels.mjs';
import { WAR_START } from '../ops/events.mjs';

const state = { oil: null, expectations: null, events: null, period: 'war', inspected: null };
let chart = null;
const warDays = () => Math.ceil((Date.now() - Date.parse(WAR_START + 'T00:00:00Z')) / DAY) + 1;

function renderProof() {
  const latest = latestPrices(state.oil), item = (label, value, note) => `<li><span class="label">${label}</span><span class="value">${value}</span><span class="note">${note}</span></li>`;
  const close = id => latest[id] ? item(id === 'brent' ? 'Brent' : 'WTI', esc(money(latest[id].value)), `${esc(dayLabel(latest[id].date))} · ${esc(latest[id].basis)}`) : item(id === 'brent' ? 'Brent' : 'WTI', '—', 'no observation');
  // Brent's move since the last close before the war began, both ends dated.
  const rows = brentObservations(state.oil).filter(o => Number.isFinite(o.value)), before = rows.filter(o => o.date < WAR_START).at(-1), now = rows.at(-1);
  const since = before && now && now.date > before.date ? item('Brent since the war', `${now.value >= before.value ? '+' : '−'}${esc(money(Math.abs(now.value - before.value)))}`, `${esc(dayLabel(before.date))} to ${esc(dayLabel(now.date))}`) : '';
  $('#oil-proof').innerHTML = close('brent') + close('wti') + since;
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
  $('#odds-list').innerHTML = oddsMarkup(state.expectations.markets, { limit: 10 });
  const checked = state.expectations.checkedAt || state.expectations.retrievedAt;
  stamp($('#odds-stamp'), checked ? `Polymarket · ${ageLabel(Date.now() - Date.parse(checked))}` : 'Polymarket');
}
async function loadEvents() { state.events = await fetchEvents(state.events); renderChart(); }

function start() {
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
