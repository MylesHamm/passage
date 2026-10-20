// PASSAGE operations center. Each panel loads on its own clock and shows one
// data-age stamp; a failed source leaves its last good data with a clear stamp.
import { apiFetch, runtime } from './runtime-config.mjs';
import { createOilChart } from './oil-chart-view.mjs';
import { createHeroMap } from './ops/hero-map.mjs';
import {
  vesselCounts, heroCountsMarkup, vesselCardMarkup, oddsMarkup, headlinesMarkup, latestPrices, money, dayLabel,
  clockLabel, ageLabel, transitRowMarkup, statusSummary, aboutMarkup, chartSeries,
} from './ops/panels.mjs';

const $ = selector => document.querySelector(selector);
const state = { vessels: null, vesselsAt: 0, vesselError: false, news: null, expectations: null, oil: null, transits: null, diagnostics: null, period: 90, region: 'all' };
let hero = null, oilChart = null;

async function load(path) {
  const response = await apiFetch(path, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`${path} ${response.status}`);
  return response.json();
}
function every(ms, task) {
  let timer = 0;
  const run = async () => { clearTimeout(timer); if (!document.hidden) await task().catch(() => {}); timer = setTimeout(run, ms); };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) run(); });
  return run();
}
function stamp(node, text, status = 'live') { if (!node) return; node.textContent = text; node.dataset.state = status; }

/* Vessels */
function renderVessels() {
  const now = Date.now(), counts = vesselCounts(state.vessels?.vessels, now);
  $('#hero-counts').innerHTML = heroCountsMarkup(counts, { connected: !state.vesselError || Boolean(state.vessels) });
  const newest = counts.newestAgeMs;
  stamp($('#ais-stamp'), state.vesselError && !state.vessels ? 'AIS unavailable' : newest === null ? 'AIS · no current positions' : `AIS · latest ${ageLabel(newest)}`, state.vesselError ? 'down' : newest !== null && newest > 600000 ? 'stale' : 'live');
  hero?.setVessels(state.vessels?.vessels || []);
}
async function loadVessels() {
  try { state.vessels = await load('/api/vessels'); state.vesselError = false; }
  catch { state.vesselError = true; }
  renderVessels();
}

/* Context panels */
async function loadOdds() {
  try { state.expectations = await load('/api/expectations'); }
  catch { stamp($('#odds-stamp'), 'Unavailable', 'down'); if (!state.expectations) $('#odds-list').innerHTML = '<li class="empty-note">Market odds are unavailable right now.</li>'; return; }
  $('#odds-list').innerHTML = oddsMarkup(state.expectations.markets);
  const checked = state.expectations.checkedAt || state.expectations.retrievedAt;
  stamp($('#odds-stamp'), checked ? `Polymarket · ${ageLabel(Date.now() - Date.parse(checked))}` : 'Polymarket');
}
async function loadNews() {
  try { state.news = await load('/api/news'); }
  catch { stamp($('#headlines-stamp'), 'Unavailable', 'down'); return; }
  $('#headline-list').innerHTML = headlinesMarkup(state.news.items, { limit: 5 });
  renderDrawer();
  stamp($('#headlines-stamp'), state.news.generatedAt ? `Checked ${clockLabel(state.news.generatedAt)}` : '');
}
function renderDrawer() {
  $('#headline-drawer-list').innerHTML = headlinesMarkup(state.news?.items, { limit: 60, region: state.region });
}
async function loadOil() {
  try { state.oil = await load('/api/oil'); }
  catch { oilChart?.update(state.oil?.series || [], { period: state.period, failed: true }); return; }
  renderOil();
}
function renderOil() {
  const latest = latestPrices(state.oil);
  for (const id of ['brent', 'wti']) {
    $(`#${id}-latest`).textContent = latest[id] ? money(latest[id].value) : '—';
    $(`#${id}-date`).textContent = latest[id] ? `${dayLabel(latest[id].date)} · ${latest[id].basis}` : 'No observation';
  }
  oilChart?.update(chartSeries(state.oil), { period: state.period, loading: !state.oil });
}
async function loadTransits() {
  try { state.transits = await load('/api/transits'); }
  catch { stamp($('#transits-stamp'), 'Unavailable', 'down'); if (!state.transits) $('#transits-body').innerHTML = '<p class="empty-note">Transit counts are unavailable right now.</p>'; return; }
  const t = state.transits, row = id => {
    const rows = (t.daily || []).filter(r => r.chokepoint === id);
    return { rows, latest: rows.at(-1) || null, baseline: t.baselines?.[id] || null };
  };
  $('#transits-body').innerHTML = transitRowMarkup({ name: 'Strait of Hormuz', ...row('hormuz') }) + transitRowMarkup({ name: 'Bab el-Mandeb', ...row('bab') });
  const latest = [row('hormuz').latest?.date, row('bab').latest?.date].filter(Boolean).sort().at(-1);
  stamp($('#transits-stamp'), latest ? `PortWatch · to ${dayLabel(latest)}` : 'PortWatch');
}
async function loadDiagnostics() {
  try { state.diagnostics = await load('/api/diagnostics'); } catch { state.diagnostics = null; }
  const summary = state.diagnostics ? statusSummary(state.diagnostics.sources || []) : { state: 'down', text: 'Sources unavailable' };
  $('#status-open').dataset.state = summary.state; $('#status-text').textContent = summary.text;
  $('#status-open').setAttribute('aria-label', `${summary.text}. Open About the data.`);
  if ($('#about-dialog').open) $('#about-body').innerHTML = aboutMarkup(state.diagnostics?.sources);
}

/* Interaction */
function bindControls() {
  const pressed = (button, value) => { button.setAttribute('aria-pressed', String(value)); return value; };
  $('#show-all').addEventListener('click', event => hero?.setShowAll(pressed(event.currentTarget, event.currentTarget.getAttribute('aria-pressed') !== 'true')));
  $('#camera-motion').addEventListener('click', event => {
    const paused = pressed(event.currentTarget, event.currentTarget.getAttribute('aria-pressed') !== 'true');
    event.currentTarget.textContent = paused ? 'Resume camera' : 'Pause camera'; hero?.setPaused(paused);
  });
  $('#view-mode').addEventListener('click', event => { const top = hero?.toggleTopDown(); pressed(event.currentTarget, Boolean(top)); event.currentTarget.textContent = top ? '3D terrain' : 'Top-down'; });
  $('#zoom-in').addEventListener('click', () => hero?.zoom(1.25));
  $('#zoom-out').addEventListener('click', () => hero?.zoom(1 / 1.25));
  $('#reset-view').addEventListener('click', () => hero?.reset());
  const replayButton = $('#replay'), clock = $('#replay-clock'), kicker = $('#hero-kicker');
  const endReplay = () => { pressed(replayButton, false); replayButton.textContent = 'Replay last hour'; clock.hidden = true; kicker.dataset.state = ''; kicker.querySelector('span').textContent = 'STRAIT OF HORMUZ · RECEIVED AIS'; };
  replayButton.addEventListener('click', () => {
    if (hero?.replaying) { hero.stopReplay(); return; }
    const started = hero?.replay({ onClock: t => { clock.textContent = `Replay · ${clockLabel(new Date(t).toISOString())}`; }, onEnd: endReplay });
    if (!started) { clock.hidden = false; clock.textContent = 'No tanker tracks received in the last hour yet'; setTimeout(() => { if (!hero?.replaying) clock.hidden = true; }, 3500); return; }
    pressed(replayButton, true); replayButton.textContent = 'Stop replay'; clock.hidden = false;
    kicker.dataset.state = 'replay'; kicker.querySelector('span').textContent = 'STRAIT OF HORMUZ · REPLAY OF RECEIVED POSITIONS';
  });
  document.querySelectorAll('[data-period]').forEach(button => button.addEventListener('click', () => {
    state.period = Number(button.dataset.period);
    document.querySelectorAll('[data-period]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    renderOil();
  }));
  const about = $('#about-dialog'), drawer = $('#headlines-dialog');
  $('#status-open').addEventListener('click', () => { $('#about-body').innerHTML = aboutMarkup(state.diagnostics?.sources); about.showModal(); });
  const openDrawer = () => { renderDrawer(); drawer.showModal(); };
  $('#headlines-open').addEventListener('click', openDrawer); $('#headlines-more').addEventListener('click', openDrawer);
  document.querySelectorAll('[data-region]').forEach(button => button.addEventListener('click', () => {
    state.region = button.dataset.region;
    document.querySelectorAll('[data-region]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    renderDrawer();
  }));
  document.querySelectorAll('dialog').forEach(dialog => {
    dialog.addEventListener('click', event => { if (event.target === dialog || event.target.closest('[data-close]')) dialog.close(); });
  });
  $('#vessel-card').addEventListener('click', event => { if (event.target.closest('[data-close-vessel]')) { hero?.select(null); showVessel(null); } });
}
function showVessel(vessel) {
  const card = $('#vessel-card');
  card.hidden = !vessel;
  card.innerHTML = vessel ? vesselCardMarkup(vessel) : '';
}
function tickClock() { $('#utc-clock').textContent = new Date().toLocaleTimeString('en-GB', { hour12: false, timeZone: 'UTC' }) + ' UTC'; }

async function start() {
  tickClock(); setInterval(tickClock, 1000);
  bindControls();
  oilChart = createOilChart($('#oil-chart'), { height: 170 });
  if (runtime.configurationError) { $('#status-text').textContent = 'Live data not configured'; $('#status-open').dataset.state = 'down'; }
  createHeroMap($('#hero-map'), { onSelect: showVessel }).then(map => { hero = map; renderVessels(); })
    .catch(() => { $('#hero-map').insertAdjacentHTML('beforeend', '<p class="map-fallback">The 3D map could not load on this device. Vessel counts and other panels still update.</p>'); });
  every(10_000, loadVessels);
  every(60_000, loadOdds);
  every(60_000, loadNews);
  every(600_000, loadOil);
  every(1_800_000, loadTransits);
  every(60_000, loadDiagnostics);
  setInterval(() => { if (!document.hidden) renderVessels(); }, 5000);
}
start();
