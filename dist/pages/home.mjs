// Overview: the live Hormuz map as the hero visual, three live figures beside
// the main action, and one card per view with its own real, dated figure.
import '../site/shell.mjs';
import { $, load, every, stamp, fetchEvents, brentObservations } from '../site/data.mjs';
import { mountHormuzMap } from '../site/hormuz-live.mjs';
import { sparkLine, sparkBars } from '../site/spark.mjs';
import { recentHormuzEvents, RECENT_EVENT_DAYS } from '../ops/hero-map.mjs';
import { vesselCounts, heroCountsMarkup, latestPrices, money, dayLabel, ageLabel, esc } from '../ops/panels.mjs';
import { WAR_START, located } from '../ops/events.mjs';

const state = { vessels: null, vesselError: false, transits: null, oil: null, events: null };
let live = null;
const set = (id, html, note) => { $(`#${id}`).innerHTML = html; if (note !== undefined) $(`#${id}-note`).textContent = note; };
const unavailable = '<span class="error-note">Unavailable</span>';

function renderVessels() {
  const counts = vesselCounts(state.vessels?.vessels), events = recentHormuzEvents(located(state.events?.events || [])).length;
  $('#hero-counts').innerHTML = heroCountsMarkup(counts, { connected: !state.vesselError || Boolean(state.vessels), events, days: RECENT_EVENT_DAYS });
  const newest = counts.newestAgeMs;
  stamp($('#ais-stamp'), state.vesselError && !state.vessels ? 'AIS unavailable' : newest === null ? 'AIS · no current positions' : `AIS · latest ${ageLabel(newest)}`, state.vesselError ? 'down' : newest !== null && newest > 600000 ? 'stale' : 'live');
  $('#hero-eyebrow').dataset.state = state.vesselError ? 'down' : newest === null || newest > 600000 ? 'stale' : 'live';
  if (!state.vessels) { if (state.vesselError) { set('bento-vessels', unavailable); set('proof-dark', unavailable); } return; }
  set('bento-vessels', String(counts.total), newest === null ? 'vessels received, none current' : `vessels received · latest ${ageLabel(newest)}`);
  // Ships dark now: counted only once coverage is learned and while the feed is healthy.
  const gaps = state.vessels.gaps, s = gaps?.summary || {};
  if (!gaps) { set('proof-dark', '—', 'No gap record yet'); set('bento-gaps', '—', 'no gap record yet'); }
  else if (!gaps.ready) { set('proof-dark', '—', 'Learning coverage'); set('bento-gaps', '—', 'learning where reception is reliable'); }
  else if (!gaps.feedHealthy) { set('proof-dark', '—', 'Paused, feed low'); set('bento-gaps', '—', 'paused while the feed is low'); }
  else {
    set('proof-dark', String(s.darkNow ?? 0), 'Silent 3 h or more');
    set('bento-gaps', String(s.darkNow ?? 0), `dark now · ${s.completed7d ?? 0} gaps closed in 7 days`);
  }
  live?.setVessels(state.vessels);
}
async function loadVessels() {
  try { state.vessels = await load('/api/vessels'); state.vesselError = false; } catch { state.vesselError = true; }
  renderVessels();
}

async function loadTransits() {
  try { state.transits = await load('/api/transits'); }
  catch { if (!state.transits) { set('proof-transits', unavailable); set('bento-transits', unavailable); } return; }
  const rows = (state.transits.daily || []).filter(r => r.chokepoint === 'hormuz'), latest = rows.at(-1), baseline = state.transits.baselines?.hormuz;
  if (!latest) { set('proof-transits', '—', 'No counts yet'); set('bento-transits', '—', 'no counts yet'); return; }
  const share = baseline?.total > 0 ? Math.round(latest.total / baseline.total * 100) : null;
  const tone = share !== null && share < 50 ? 'low' : '';
  set('proof-transits', share === null ? String(latest.total) : `${share}%`, share === null ? `${latest.total} ships on ${dayLabel(latest.date)}` : `${latest.total} ships on ${dayLabel(latest.date)}, of the 2025 average`);
  $('#proof-transits').dataset.tone = tone;
  set('bento-transits', share === null ? String(latest.total) : `${share}%`, share === null ? `ships on ${dayLabel(latest.date)}` : `of the daily average · ${latest.total} ships on ${dayLabel(latest.date)}`);
  const recent = rows.slice(-42);
  $('#bento-transits-bars').innerHTML = sparkBars(recent.map(r => ({ value: r.total })), { baseline: baseline?.total ?? null, label: `Hormuz daily transits, last ${recent.length} days, against the 2025 daily average` });
}

async function loadOil() {
  try { state.oil = await load('/api/oil'); }
  catch { if (!state.oil) { set('proof-brent', unavailable); set('bento-oil', unavailable); } return; }
  const brent = latestPrices(state.oil).brent;
  if (!brent) { set('proof-brent', '—', 'No observation'); set('bento-oil', '—', 'no observation'); return; }
  set('proof-brent', esc(money(brent.value)), `${dayLabel(brent.date)} · ${brent.basis}`);
  set('bento-oil', esc(money(brent.value)), `Brent close, ${dayLabel(brent.date)}`);
  const days = brentObservations(state.oil).slice(-90);
  $('#bento-oil-line').innerHTML = sparkLine(days.map(o => Number.isFinite(o.value) ? o.value : null), { label: `Brent daily spot, ${dayLabel(days[0]?.date)} to ${dayLabel(days.at(-1)?.date)}` });
}

async function loadEvents() {
  state.events = await fetchEvents(state.events);
  const events = state.events.events;
  if (!events.length) { set('bento-events', state.events.reviewedAt ? '0' : unavailable); return; }
  set('bento-events', String(events.length), `events since ${dayLabel(WAR_START)} · latest ${dayLabel(events[0].date)}`);
  // One bar per month since the war began.
  const months = new Map();
  for (const e of events) months.set(e.date.slice(0, 7), (months.get(e.date.slice(0, 7)) || 0) + 1);
  const keys = [...months.keys()].sort();
  $('#bento-events-bars').innerHTML = sparkBars(keys.map(k => ({ value: months.get(k), kind: 'shipping' })), { label: `War events per month, ${keys.length} months` });
  live?.setEvents(events);
  renderVessels();
}

async function start() {
  mountHormuzMap($('#hero-map'), $('#vessel-card')).then(controller => {
    live = controller;
    if (!live) return;
    $('#zoom-in').addEventListener('click', () => live.map.zoom(1.25));
    $('#zoom-out').addEventListener('click', () => live.map.zoom(1 / 1.25));
    if (state.vessels) live.setVessels(state.vessels);
    if (state.events) live.setEvents(state.events.events);
  });
  every(10_000, loadVessels);
  every(1_800_000, loadTransits);
  every(600_000, loadOil);
  every(300_000, loadEvents);
  setInterval(() => { if (!document.hidden) renderVessels(); }, 5000);
}
start();
