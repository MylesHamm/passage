// Overview: the live Hormuz map as the hero visual, three live figures beside
// the main action, and one card per view with its own real, dated figure.
import '../site/shell.mjs';
import { $, load, every, stamp, fetchEvents, brentObservations } from '../site/data.mjs';
import { mountHormuzMap } from '../site/hormuz-live.mjs';
import { createReadAlong } from '../site/stories.mjs';
import { recentHormuzEvents, RECENT_EVENT_DAYS } from '../ops/hero-map.mjs';
import { vesselCounts, vesselFeedNote, heroCountsMarkup, latestPrices, money, dayLabel, ageLabel, durationLabel, gapState, isTanker, aisCreditMarkup, trafficCounts, esc } from '../ops/panels.mjs';
import { WAR_START, located } from '../ops/events.mjs';

const state = { vessels: null, vesselError: false, transits: null, oil: null, events: null };
let live = null;
// Each card's chart, read point by point; the stories start in reading order around the grid.
const charts = {
  vessels: createReadAlong($('#bento-vessels-chart'), { label: 'Vessels received, by minutes since their latest position', offset: 0, empty: 'No positions received in the last 30 minutes.' }),
  transits: createReadAlong($('#bento-transits-bars'), { label: 'Hormuz daily transits against the 2025 daily average', offset: .6, empty: 'No transit counts yet.' }),
  events: createReadAlong($('#bento-events-bars'), { label: 'War events per month since 28 February', offset: 1.2, empty: 'No events loaded yet.' }),
  oil: createReadAlong($('#bento-oil-line'), { kind: 'line', label: 'Brent daily spot, last 90 observed days', offset: 1.8, empty: 'No Brent observations yet.' }),
  gaps: createReadAlong($('#bento-gaps-chart'), { label: 'AIS gaps closed in the last 7 days, by how long each ship was dark', offset: 2.4, empty: 'No gaps closed in the last 7 days.' }),
};
const monthLabel = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
/** Current vessels by minutes since their latest position, in 3 minute steps, oldest on the left. */
function freshness(current, now = Date.now()) {
  return Array.from({ length: 10 }, (_, i) => 9 - i).map(step => {
    const ships = current.filter(v => { const age = (now - Date.parse(v.positionTime)) / 60_000; return age >= step * 3 && age < step * 3 + 3; });
    const tankers = ships.filter(isTanker).length;
    return { value: ships.length, part: tankers, tip: `<b>${ships.length} ${ships.length === 1 ? 'ship' : 'ships'}</b>${tankers ? ` ${tankers} ${tankers === 1 ? 'tanker' : 'tankers'} ·` : ''} last heard ${step * 3} to ${step * 3 + 3} min ago` };
  });
}
const set = (id, html, note) => { $(`#${id}`).innerHTML = html; if (note !== undefined) $(`#${id}-note`).textContent = note; };
const unavailable = '<span class="error-note">Unavailable</span>';

function renderVessels() {
  const counts = vesselCounts(state.vessels?.vessels), events = recentHormuzEvents(located(state.events?.events || [])).length;
  const note = vesselFeedNote(state.vessels, counts);
  $('#hero-counts').innerHTML = heroCountsMarkup(counts, { connected: !state.vesselError || Boolean(state.vessels), events, days: RECENT_EVENT_DAYS, note });
  const newest = counts.newestAgeMs;
  stamp($('#ais-stamp'), state.vesselError && !state.vessels ? 'AIS unavailable' : newest === null ? 'AIS · no positions arriving' : `AIS · latest ${ageLabel(newest)}`, state.vesselError ? 'down' : newest !== null && newest > 600000 ? 'stale' : 'live');
  // Relayed positions carry their credit on the map.
  const credit = aisCreditMarkup(counts.current);
  $('#ais-credit').hidden = !credit; $('#ais-credit').innerHTML = credit;
  $('#hero-eyebrow').dataset.state = state.vesselError ? 'down' : newest === null || newest > 600000 ? 'stale' : 'live';
  if (!state.vessels) { if (state.vesselError) { set('bento-vessels', unavailable); set('proof-ships', unavailable); } return; }
  // The area can be crowded while the strait is nearly still: stopped ships, and ships moving through the lanes.
  const t = trafficCounts(counts.current), moving = `${t.straitMoving} moving in the strait${t.straitMoving && !t.straitTankers ? ', no tankers' : ''}`;
  set('proof-ships', String(counts.total), counts.total ? `${t.stopped} stopped · ${moving}` : note);
  set('bento-vessels', String(counts.total), newest === null ? note : `vessels received · ${t.stopped} stopped · ${moving} · latest ${ageLabel(newest)}`);
  charts.vessels.set(counts.total ? freshness(counts.current) : []);
  // Ships dark now: counted only once coverage is learned and while reception is steady.
  const gaps = state.vessels.gaps, s = gaps?.summary || {}, gapMode = gapState(gaps);
  if (gapMode === 'none') set('bento-gaps', '—', 'no gap record yet');
  else if (gapMode === 'learning') set('bento-gaps', '—', 'learning where reception is reliable');
  else if (gapMode === 'paused') set('bento-gaps', '—', 'paused until reception has been steady for a day');
  else set('bento-gaps', String(s.darkNow ?? 0), `dark now · ${s.completed7d ?? 0} gaps closed in 7 days`);
  const closed = gapMode === 'counting' ? [...(gaps.completed || [])].reverse() : [];
  charts.gaps.set(closed.map(g => ({ value: g.hours, tip: `<b>${esc(durationLabel(g.hours))}</b> ${esc(g.name || `MMSI ${g.mmsi}`)} · ${esc(dayLabel(g.to.t))}` })));
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
  charts.transits.set(rows.slice(-42).map(r => ({ value: r.total, part: r.tankers, tip: `<b>${r.total} ${r.total === 1 ? 'ship' : 'ships'}</b> ${r.tankers} ${r.tankers === 1 ? 'tanker' : 'tankers'} · ${esc(dayLabel(r.date))}` })), { baseline: baseline?.total ?? null });
}

async function loadOil() {
  try { state.oil = await load('/api/oil'); }
  catch { if (!state.oil) { set('proof-brent', unavailable); set('bento-oil', unavailable); } return; }
  const brent = latestPrices(state.oil).brent;
  if (!brent) { set('proof-brent', '—', 'No observation'); set('bento-oil', '—', 'no observation'); return; }
  set('proof-brent', esc(money(brent.value)), `${dayLabel(brent.date)} · ${brent.basis}`);
  set('bento-oil', esc(money(brent.value)), `Brent close, ${dayLabel(brent.date)}`);
  charts.oil.set(brentObservations(state.oil).slice(-90).map(o => Number.isFinite(o.value) ? { value: o.value, tip: `<b>${esc(money(o.value))}</b> ${esc(dayLabel(o.date))}` } : { value: null }));
}

async function loadEvents() {
  state.events = await fetchEvents(state.events);
  const events = state.events.events;
  if (!events.length) { set('bento-events', state.events.reviewedAt ? '0' : unavailable); return; }
  set('bento-events', String(events.length), `events since ${dayLabel(WAR_START)} · latest ${dayLabel(events[0].date)}`);
  // One bar per month since the war began.
  const months = new Map();
  for (const e of events) months.set(e.date.slice(0, 7), (months.get(e.date.slice(0, 7)) || 0) + 1);
  charts.events.set([...months.keys()].sort().map(k => ({ value: months.get(k), tip: `<b>${months.get(k)} events</b> ${esc(monthLabel.format(Date.parse(k + '-01T00:00:00Z')))}` })));
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
