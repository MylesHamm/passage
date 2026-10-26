// Hormuz live: the full map with its controls, daily transits, the AIS gap
// record and the war events inside the map's view.
import '../site/shell.mjs';
import { $, load, every, stamp, fetchEvents, eventsStamp, eventHref, pageUrl } from '../site/data.mjs';
import { mountHormuzMap } from '../site/hormuz-live.mjs';
import { recentHormuzEvents } from '../ops/hero-map.mjs';
import { vesselCounts, ageLabel, clockLabel, dayLabel, transitRowMarkup, gapsCardMarkup, eventListMarkup } from '../ops/panels.mjs';
import { located } from '../ops/events.mjs';

const state = { vessels: null, vesselError: false, transits: null, events: null };
let live = null;
const KICKER = 'Strait of Hormuz · received AIS';

function proofMarkup(counts, gaps) {
  const s = gaps?.summary || {}, darkReady = gaps?.ready && gaps.feedHealthy;
  const item = (label, value, note, tone = '') => `<li><span class="label">${label}</span><span class="value"${tone ? ` data-tone="${tone}"` : ''}>${value}</span><span class="note">${note}</span></li>`;
  return item('Tankers', String(counts.tankers), 'received now', 'tanker')
    + item('Vessels', String(counts.total), counts.newestAgeMs === null ? 'none current' : `latest ${ageLabel(counts.newestAgeMs)}`)
    + item('Dark now', darkReady ? String(s.darkNow ?? 0) : '—', !gaps ? 'no gap record yet' : !gaps.ready ? 'learning coverage' : !gaps.feedHealthy ? 'paused, feed low' : 'silent 3 h or more');
}

function renderVessels() {
  const counts = vesselCounts(state.vessels?.vessels), newest = counts.newestAgeMs, gaps = state.vessels?.gaps || null;
  if (state.vessels) $('#hero-counts').innerHTML = proofMarkup(counts, gaps);
  else if (state.vesselError) $('#hero-counts').innerHTML = '<li><span class="error-note">The vessel feed is unavailable. Retrying every 10 seconds.</span></li>';
  stamp($('#ais-stamp'), state.vesselError && !state.vessels ? 'AIS unavailable' : newest === null ? 'AIS · no current positions' : `AIS · latest ${ageLabel(newest)}`, state.vesselError ? 'down' : newest !== null && newest > 600000 ? 'stale' : 'live');
  $('#hero-eyebrow').dataset.state = state.vesselError ? 'down' : newest === null || newest > 600000 ? 'stale' : 'live';
  $('#ais-gaps-body').innerHTML = gapsCardMarkup(gaps);
  stamp($('#ais-gaps-stamp'), !gaps ? '' : !gaps.ready ? 'Learning coverage' : !gaps.feedHealthy ? 'Paused · feed low' : `Updated ${clockLabel(state.vessels.generatedAt)}`, !gaps || gaps.ready && gaps.feedHealthy ? 'live' : 'stale');
  if (state.vessels) live?.setVessels(state.vessels);
}
async function loadVessels() {
  try { state.vessels = await load('/api/vessels'); state.vesselError = false; } catch { state.vesselError = true; }
  renderVessels();
}

async function loadTransits() {
  try { state.transits = await load('/api/transits'); }
  catch { stamp($('#transits-stamp'), 'Unavailable', 'down'); if (!state.transits) $('#transits-body').innerHTML = '<p class="error-note">Transit counts are unavailable right now. The page retries every 30 minutes.</p>'; return; }
  const t = state.transits, row = id => {
    const rows = (t.daily || []).filter(r => r.chokepoint === id);
    return { rows, latest: rows.at(-1) || null, baseline: t.baselines?.[id] || null };
  };
  $('#transits-body').innerHTML = `<div>${transitRowMarkup({ name: 'Strait of Hormuz', ...row('hormuz') })}</div><div>${transitRowMarkup({ name: 'Bab el-Mandeb', ...row('bab') })}</div>`;
  const latest = [row('hormuz').latest?.date, row('bab').latest?.date].filter(Boolean).sort().at(-1);
  stamp($('#transits-stamp'), latest ? `PortWatch · to ${dayLabel(latest)}` : 'PortWatch');
}

async function loadEvents() {
  state.events = await fetchEvents(state.events);
  const recent = recentHormuzEvents(located(state.events.events));
  $('#recent-list').innerHTML = recent.length ? eventListMarkup(recent, { limit: Infinity, href: eventHref })
    : `<li class="empty-note">No war events inside this map's view in the last seven days. <a href="${pageUrl('events/')}">See every event</a>.</li>`;
  const { text, state: status } = eventsStamp(state.events);
  stamp($('#events-stamp'), text, status);
  live?.setEvents(state.events.events);
}

function bindControls() {
  const pressed = (button, value) => { button.setAttribute('aria-pressed', String(value)); return value; };
  $('#show-all').addEventListener('click', event => live?.map.setShowAll(pressed(event.currentTarget, event.currentTarget.getAttribute('aria-pressed') !== 'true')));
  $('#camera-motion').addEventListener('click', event => {
    const paused = pressed(event.currentTarget, event.currentTarget.getAttribute('aria-pressed') !== 'true');
    event.currentTarget.textContent = paused ? 'Resume camera' : 'Pause camera'; live?.map.setPaused(paused);
  });
  $('#view-mode').addEventListener('click', event => { const top = live?.map.toggleTopDown(); pressed(event.currentTarget, Boolean(top)); event.currentTarget.textContent = top ? '3D terrain' : 'Top down'; });
  $('#zoom-in').addEventListener('click', () => live?.map.zoom(1.25));
  $('#zoom-out').addEventListener('click', () => live?.map.zoom(1 / 1.25));
  $('#reset-view').addEventListener('click', () => live?.map.reset());
  const replayButton = $('#replay'), heroButton = $('#replay-hero'), clock = $('#replay-clock'), eyebrow = $('#hero-kicker');
  const endReplay = () => { pressed(replayButton, false); replayButton.textContent = 'Replay last hour'; clock.hidden = true; eyebrow.textContent = KICKER; };
  const replay = () => {
    const map = live?.map;
    if (!map) return;
    if (map.replaying) { map.stopReplay(); return; }
    const started = map.replay({ onClock: t => { clock.textContent = `Replay · ${clockLabel(new Date(t).toISOString())}`; }, onEnd: endReplay });
    if (!started) { clock.hidden = false; clock.textContent = 'No tanker tracks received in the last hour yet'; setTimeout(() => { if (!map.replaying) clock.hidden = true; }, 3500); return; }
    pressed(replayButton, true); replayButton.textContent = 'Stop replay'; clock.hidden = false;
    eyebrow.textContent = 'Strait of Hormuz · replay of received positions';
  };
  replayButton.addEventListener('click', replay);
  heroButton.addEventListener('click', () => {
    // The main action brings the map into view first, then plays.
    const top = $('.map-frame').getBoundingClientRect().top;
    if (top < 0 || top > innerHeight * .6) $('.map-frame').scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    replay();
  });
  $('#ais-gaps-body').addEventListener('click', event => {
    const button = event.target.closest('[data-gap-mmsi]');
    if (!button) return;
    const item = (state.vessels?.gaps?.darkNow || []).find(d => d.mmsi === button.dataset.gapMmsi);
    if (!item) return;
    $('.map-frame').scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    live?.showGap(item);
  });
}

async function start() {
  bindControls();
  mountHormuzMap($('#hero-map'), $('#vessel-card')).then(controller => {
    live = controller;
    if (!live) return;
    if (state.vessels) live.setVessels(state.vessels);
    if (state.events) live.setEvents(state.events.events);
  });
  every(10_000, loadVessels);
  every(1_800_000, loadTransits);
  every(300_000, loadEvents);
  setInterval(() => { if (!document.hidden) renderVessels(); }, 5000);
}
start();
