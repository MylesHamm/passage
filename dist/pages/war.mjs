// Regional war: the theatre map with its layers, fronts and naval missions,
// the missions under way today and the latest reporting. An event opens a
// card on the map that links to the event's own page.
import '../site/shell.mjs';
import { $, load, every, stamp, fetchEvents, eventsStamp, eventHref } from '../site/data.mjs';
import { createTheatreMap } from '../ops/theatre-map.mjs';
import { eventCardMarkup, eventGroupMarkup, headlinesMarkup, sourceItemsMarkup, clockLabel, dayLabel, esc } from '../ops/panels.mjs';
import { LAYERS, WAR_START, activeMissions, located, visibleEvents, countsByLayer } from '../ops/events.mjs';

const state = { events: null, news: null, region: 'all', layers: new Set([...Object.keys(LAYERS), 'missions']), selected: null };
// A link from an event page opens that event once the map and the list are both ready.
let wanted = new URLSearchParams(location.search).get('event');
let theatre = null;
const today = () => new Date().toISOString().slice(0, 10);
const shown = () => located(visibleEvents(state.events?.events || [], { layers: [...state.layers].filter(id => LAYERS[id]) }));

function renderCounts() {
  const all = located(state.events?.events || []), counts = countsByLayer(all);
  const item = (label, value, note) => `<li><span class="label">${label}</span><span class="value">${value}</span><span class="note">${note}</span></li>`;
  $('#theatre-counts').innerHTML = state.events?.events.length
    ? item('Events', all.length, `on the map since ${esc(dayLabel(WAR_START))}`) + item('On shipping', counts.shipping, 'attacks') + item('Missiles and drones', counts['missile-drone'], 'strikes') + item('On Iran and Yemen', counts['strikes-on-iran-yemen'], 'strikes')
    : '<li><span class="error-note">Events are unavailable right now.</span></li>';
}
/** Missions under way on the open event's day, or today. */
function renderMissions() {
  const day = state.events?.events.find(e => e.id === state.selected)?.date || today();
  theatre?.setMissions(activeMissions(state.events?.missions || [], day), state.layers.has('missions'));
  const active = activeMissions(state.events?.missions || [], today());
  $('#missions-body').innerHTML = active.length ? active.map(m => `<article class="card">
      <div class="card-head"><h3>${esc(m.name)}</h3><span class="stamp">since ${esc(dayLabel(m.start))} ${esc(m.start.slice(0, 4))}</span></div>
      <p class="empty-note">${esc(m.operator)}${m.area ? ` · ${esc(m.area)}` : ''}</p>
      <ul class="ec-sources">${sourceItemsMarkup(m.sources)}</ul></article>`).join('')
    : '<p class="empty-note">No naval mission in the list is under way today.</p>';
}
function renderEvents() {
  renderCounts();
  const { text, state: status } = eventsStamp(state.events);
  stamp($('#events-stamp'), text, status);
  $('#hero-eyebrow').dataset.state = status;
  theatre?.setEvents(shown());
  renderMissions();
}
async function loadEvents() {
  state.events = await fetchEvents(state.events);
  renderEvents();
  if (wanted && theatre) { openEvent(wanted); wanted = null; }
}

const card = () => $('#event-card');
function openEvent(id) {
  const event = state.events?.events.find(e => e.id === id);
  if (!event) return;
  state.selected = event.id;
  theatre?.select(event.id);
  card().innerHTML = eventCardMarkup(event, { href: eventHref(event), moves: false }); card().hidden = false;
  renderMissions();
}
function closeEvent() {
  state.selected = null; theatre?.select(null, { fly: false });
  card().hidden = true; card().innerHTML = '';
  renderMissions();
}

async function loadNews() {
  try { state.news = await load('/api/news'); }
  catch { stamp($('#headlines-stamp'), 'Unavailable', 'down'); if (!state.news) $('#headline-list').innerHTML = '<li class="error-note">Headlines are unavailable right now.</li>'; return; }
  renderNews();
  stamp($('#headlines-stamp'), state.news.generatedAt ? `Checked ${clockLabel(state.news.generatedAt)}` : '');
}
const renderNews = () => { $('#headline-list').innerHTML = headlinesMarkup(state.news?.items, { limit: 10, region: state.region }); };

function bindControls() {
  const pressed = (button, value) => { button.setAttribute('aria-pressed', String(value)); return value; };
  document.querySelectorAll('[data-layer-toggle]').forEach(button => button.addEventListener('click', () => {
    const id = button.dataset.layerToggle, on = !state.layers.has(id);
    if (on) state.layers.add(id); else state.layers.delete(id);
    pressed(button, on); renderEvents();
  }));
  document.querySelectorAll('[data-front]').forEach(button => button.addEventListener('click', () => theatre?.front(button.dataset.front)));
  $('#theatre-zoom-in').addEventListener('click', () => theatre?.zoom(1.25));
  $('#theatre-zoom-out').addEventListener('click', () => theatre?.zoom(1 / 1.25));
  $('#theatre-reset').addEventListener('click', () => theatre?.reset());
  card().addEventListener('click', event => { if (event.target.closest('[data-close-event]')) closeEvent(); });
  document.querySelectorAll('[data-region]').forEach(button => button.addEventListener('click', () => {
    state.region = button.dataset.region;
    document.querySelectorAll('[data-region]').forEach(b => pressed(b, b === button));
    renderNews();
  }));
}

async function start() {
  bindControls();
  createTheatreMap($('#theatre-map'), {
    onSelect: event => event ? openEvent(event.id) : closeEvent(),
    onGroup: list => { card().innerHTML = eventGroupMarkup(list, { href: eventHref }); card().hidden = false; },
  }).then(map => {
    theatre = map;
    renderEvents();
    if (wanted && state.events) { openEvent(wanted); wanted = null; }
  }).catch(() => { $('#theatre-map').insertAdjacentHTML('beforeend', '<p class="map-fallback">The regional map could not load on this device. The timeline lists every event.</p>'); });
  every(300_000, loadEvents);
  every(60_000, loadNews);
}
start();
