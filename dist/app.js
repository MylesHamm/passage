// PASSAGE operations center. Each panel loads on its own clock and shows one
// data-age stamp; a failed source leaves its last good data with a clear stamp.
import { apiFetch, siteUrl, runtime } from './runtime-config.mjs';
import { createOilChart } from './oil-chart-view.mjs';
import { createHeroMap } from './ops/hero-map.mjs';
import {
  vesselCounts, heroCountsMarkup, vesselCardMarkup, oddsMarkup, headlinesMarkup, shownPrices, dayLabel,
  clockLabel, ageLabel, transitRowMarkup, statusSummary, aboutMarkup, chartSeries, eventCardMarkup, eventListMarkup, eventTimelineMarkup, eventGroupMarkup, esc,
} from './ops/panels.mjs';
import { WAR_START, LAYERS, curatedEvents, curatedMissions, activeMissions, registerEvents, unplacedRegisterEvents, located, mergeEvents, visibleEvents, countsByLayer, priceMove, oddsMove, relatedMarkets } from './ops/events.mjs';

const $ = selector => document.querySelector(selector);
const state = {
  vessels: null, vesselsAt: 0, vesselError: false, news: null, expectations: null, oil: null, transits: null, diagnostics: null, period: 90, region: 'all',
  view: 'hormuz', curated: null, maritime: null, events: [], missions: [], layers: new Set([...Object.keys(LAYERS), 'missions']), selectedEvent: null, timelineLayer: 'all', inspected: null,
};
let hero = null, theatre = null, theatreLoading = null, oilChart = null;
const DAY = 86_400_000;
const warDays = () => Math.ceil((Date.now() - Date.parse(WAR_START + 'T00:00:00Z')) / DAY) + 1;

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
/** The left-hand prices follow the date inspected on the chart, and show the latest close otherwise. */
function renderPrices(detail = state.inspected) {
  state.inspected = detail;
  const shown = shownPrices(state.oil, detail);
  for (const id of ['brent', 'wti']) { $(`#${id}-latest`).textContent = shown[id].value; $(`#${id}-date`).textContent = shown[id].date; }
  $('#prices').dataset.inspecting = String(shown.inspecting);
}
function renderOil() {
  renderPrices();
  oilChart?.update(chartSeries(state.oil), { period: state.period === 'war' ? warDays() : state.period, loading: !state.oil });
  renderChartMarkers();
}

/* War events */
// The collector serves the live curated list. The copy bundled with the site is
// used only until a live copy arrives, never in place of a newer one.
const bundledEvents = () => fetch(siteUrl('data/war-events.json'), { headers: { accept: 'application/json' } }).then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); });
async function liveEvents() {
  const data = await load('/api/events');
  if (!Array.isArray(data?.events) || !data.events.length) throw new Error('No curated events');
  return { ...data, live: true };
}
const reviewedLabel = value => /T/.test(value || '') ? ageLabel(Date.now() - Date.parse(value)) : dayLabel(value);
async function loadEvents() {
  const [curated, maritime] = await Promise.allSettled([
    liveEvents().catch(error => state.curated?.live ? Promise.reject(error) : bundledEvents().then(data => ({ ...data, live: false }))),
    load('/api/maritime'),
  ]);
  if (curated.status === 'fulfilled') state.curated = curated.value;
  if (maritime.status === 'fulfilled') state.maritime = maritime.value;
  state.events = mergeEvents(curatedEvents(state.curated), [...registerEvents(state.maritime), ...unplacedRegisterEvents(state.maritime)]);
  state.missions = curatedMissions(state.curated);
  const reviewed = state.curated?.reviewedAt, live = state.curated?.live && curated.status === 'fulfilled';
  stamp($('#events-stamp'), reviewed ? `Curated · reviewed ${reviewedLabel(reviewed)}${live ? '' : ' · saved copy'}` : 'Curated events unavailable', live ? 'live' : reviewed ? 'stale' : 'down');
  renderEvents();
}
const shownEvents = () => visibleEvents(state.events, { layers: [...state.layers].filter(id => LAYERS[id]) });
function renderEvents() {
  const shown = located(shownEvents()), counts = countsByLayer(shown);
  $('#theatre-counts').innerHTML = state.events.length
    ? `<span><strong>${shown.length}</strong> events since ${esc(dayLabel(WAR_START))}</span>` + Object.entries(LAYERS).filter(([id]) => state.layers.has(id)).map(([id]) => `<span><strong>${counts[id]}</strong> ${esc(LAYERS[id].label[0].toLowerCase() + LAYERS[id].label.slice(1))}</span>`).join('')
    : '<span>No events loaded</span>';
  $('#event-list').innerHTML = eventListMarkup(state.events, { limit: 6 });
  const newest = state.events[0]?.date;
  stamp($('#latest-events-stamp'), newest ? `Latest ${dayLabel(newest)}` : '');
  theatre?.setEvents(shown);
  if ($('#events-dialog').open) renderTimeline();
  renderMissions();
  renderChartMarkers();
}
/** Mission areas under way on the selected event's day, or today when nothing is selected. */
function renderMissions() {
  const day = state.events.find(e => e.id === state.selectedEvent)?.date || new Date().toISOString().slice(0, 10);
  theatre?.setMissions(activeMissions(state.missions, day), state.layers.has('missions'));
}
/** The full timeline, including incidents listed without a map position. */
function renderTimeline() {
  const all = state.timelineLayer === 'all' ? state.events : state.events.filter(e => e.layer === state.timelineLayer);
  const unplaced = all.filter(e => e.precision === 'unplaced').length;
  $('#timeline-note').textContent = `${all.length} events since ${dayLabel(WAR_START)}${unplaced ? ` · ${unplaced} listed without a map position, because their reports give none` : ''}`;
  $('#timeline-body').innerHTML = eventTimelineMarkup(all);
}
/** Several events at one spot: the card lists them, and each opens as usual. */
function showGroup(events) {
  const card = $('#event-card');
  card.innerHTML = eventGroupMarkup(events); card.hidden = false;
}
function renderChartMarkers() {
  oilChart?.setMarkers(shownEvents().map(e => ({ id: e.id, date: e.date, layer: e.layer, label: `${dayLabel(e.date)} · ${e.title}` })));
}

function brentObservations() { return chartSeries(state.oil).find(s => s.id === 'brent')?.observations || []; }
/** Widen the chart to "Since war" when an event falls before the window on screen, so its band is visible. */
function widenChartFor(date) {
  const last = brentObservations().filter(o => Number.isFinite(o.value)).at(-1)?.date;
  if (state.period === 'war' || !last) return;
  if (Date.parse(date) < Date.parse(last) - (state.period - 1) * DAY) $('[data-period="war"]').click();
}
/** "Show me": the theatre flies to the event, the chart marks the window, the card shows what happened next. */
async function showMe(id) {
  const event = state.events.find(e => e.id === id);
  if (!event) return;
  state.selectedEvent = event.id;
  // On a phone the list and chart sit below the map: bring the map back into view first.
  const top = $('#hero').getBoundingClientRect().top;
  if (top < 0 || top > innerHeight / 2) $('#hero').scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  await setView('theatre');
  theatre?.select(event.id); renderMissions();
  const brent = priceMove(brentObservations(), event.date);
  const odds = relatedMarkets(state.expectations?.markets, event).map(m => ({ question: m.question, move: oddsMove(m.history, event.date) }));
  widenChartFor(event.date);
  oilChart?.focus({ id: event.id, date: event.date, endDate: brent?.after?.date || null });
  const card = $('#event-card');
  card.innerHTML = eventCardMarkup(event, { brent, odds }); card.hidden = false;
}
function closeEvent() {
  state.selectedEvent = null; theatre?.select(null, { fly: false }); renderMissions(); oilChart?.focus(null);
  $('#event-card').hidden = true; $('#event-card').innerHTML = '';
}

/* Views */
async function setView(view) {
  state.view = view === 'theatre' ? 'theatre' : 'hormuz';
  $('#hero').dataset.view = state.view;
  for (const tab of document.querySelectorAll('.view-switch [data-view]')) {
    const on = tab.dataset.view === state.view;
    tab.setAttribute('aria-selected', String(on)); tab.tabIndex = on ? 0 : -1;
  }
  for (const node of document.querySelectorAll('[data-map]')) node.hidden = node.dataset.map !== state.view;
  for (const node of document.querySelectorAll('.hud-set')) node.hidden = node.dataset.for !== state.view;
  if (state.view === 'theatre' && !theatre) {
    theatreLoading ||= import('./ops/theatre-map.mjs').then(({ createTheatreMap }) => createTheatreMap($('#theatre-map'), { onSelect: event => event ? showMe(event.id) : closeEvent(), onGroup: showGroup }))
      .then(map => { theatre = map; renderEvents(); return map; })
      .catch(() => { $('#theatre-map').insertAdjacentHTML('beforeend', '<p class="map-fallback">The regional map could not load on this device. The event list and chart still work.</p>'); });
    await theatreLoading;
  }
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
    state.period = button.dataset.period === 'war' ? 'war' : Number(button.dataset.period);
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
  // Views: WAI-ARIA tabs with arrow-key movement.
  const tabs = [...document.querySelectorAll('.view-switch [data-view]')];
  for (const tab of tabs) {
    tab.addEventListener('click', () => setView(tab.dataset.view));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault(); const next = tabs[(tabs.indexOf(tab) + 1) % tabs.length]; next.focus(); setView(next.dataset.view);
    });
  }
  document.querySelectorAll('[data-layer-toggle]').forEach(button => button.addEventListener('click', () => {
    const id = button.dataset.layerToggle, on = !state.layers.has(id);
    if (on) state.layers.add(id); else state.layers.delete(id);
    pressed(button, on); renderEvents();
  }));
  $('#theatre-zoom-in').addEventListener('click', () => theatre?.zoom(1.25));
  $('#theatre-zoom-out').addEventListener('click', () => theatre?.zoom(1 / 1.25));
  $('#theatre-reset').addEventListener('click', () => theatre?.reset());
  $('#event-list').addEventListener('click', event => { const button = event.target.closest('[data-event-id]'); if (button) showMe(button.dataset.eventId); });
  $('#event-card').addEventListener('click', event => {
    if (event.target.closest('[data-close-event]')) { closeEvent(); return; }
    const item = event.target.closest('[data-event-id]'); if (item) showMe(item.dataset.eventId);
  });
  const timeline = $('#events-dialog');
  $('#events-more').addEventListener('click', () => { renderTimeline(); timeline.showModal(); });
  document.querySelectorAll('[data-timeline-layer]').forEach(button => button.addEventListener('click', () => {
    state.timelineLayer = button.dataset.timelineLayer;
    document.querySelectorAll('[data-timeline-layer]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    renderTimeline();
  }));
  $('#timeline-body').addEventListener('click', event => { const item = event.target.closest('[data-event-id]'); if (item) { timeline.close(); showMe(item.dataset.eventId); } });
  document.querySelectorAll('[data-front]').forEach(button => button.addEventListener('click', async () => { await setView('theatre'); theatre?.front(button.dataset.front); }));
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
  oilChart = createOilChart($('#oil-chart'), { height: 170, onMarker: id => showMe(id), onReadout: detail => renderPrices(detail) });
  if (runtime.configurationError) { $('#status-text').textContent = 'Live data not configured'; $('#status-open').dataset.state = 'down'; }
  createHeroMap($('#hero-map'), { onSelect: showVessel }).then(map => { hero = map; renderVessels(); })
    .catch(() => { $('#hero-map').insertAdjacentHTML('beforeend', '<p class="map-fallback">The 3D map could not load on this device. Vessel counts and other panels still update.</p>'); });
  every(10_000, loadVessels);
  every(60_000, loadOdds);
  every(60_000, loadNews);
  every(600_000, loadOil);
  every(1_800_000, loadTransits);
  every(60_000, loadDiagnostics);
  every(300_000, loadEvents);
  setInterval(() => { if (!document.hidden) renderVessels(); }, 5000);
}
start();
