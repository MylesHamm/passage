// One event: where it happened, the reports behind it, and what Brent and the
// related odds did over the next few days. The page is filled from the live
// list, so a new or corrected event needs no site publish.
import '../site/shell.mjs';
import { $, load, every, fetchEvents, eventHref, pageUrl, brentObservations, DAY } from '../site/data.mjs';
import { createTheatreMap } from '../ops/theatre-map.mjs';
import { createOilChart } from '../oil-chart-view.mjs';
import { chartSeries, sourceItemsMarkup, eventListMarkup, eventGroupMarkup, money, dayLabel, esc } from '../ops/panels.mjs';
import { activeMissions, located, priceMove, oddsMove, relatedMarkets } from '../ops/events.mjs';

const id = new URLSearchParams(location.search).get('id') || '';
const state = { events: null, oil: null, expectations: null, event: null };
let theatre = null, chart = null;
const LAYER_NAMES = { shipping: 'Attack on shipping', 'missile-drone': 'Missile and drone strike', 'strikes-on-iran-yemen': 'Strike on Iran or Yemen' };
const PRECISION = { facility: 'Facility location', city: 'City location', area: 'Approximate area', 'sea-area': 'Sea area', unplaced: 'Not placed on the map' };
const signed = (value, digits = 2) => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(digits)}`;

function notFound() {
  document.title = 'Event not found | Passage';
  $('#event-meta').innerHTML = '<span>Not in the list</span>';
  $('#event-title').textContent = 'This event is not in the list';
  $('#event-summary').textContent = id ? 'It may have been corrected or merged into another entry. The timeline has every current event.' : 'No event was named in the link. The timeline has every current event.';
  const action = $('#event-map');
  action.href = pageUrl('events/'); action.firstChild.textContent = 'Open the timeline ';
  $('#event-proof').innerHTML = '';
  document.querySelectorAll('[data-needs-event]').forEach(node => { node.hidden = true; });
}

function renderEvent() {
  const event = state.event, item = (label, value, note) => `<li><span class="label">${label}</span><span class="value">${value}</span><span class="note">${note}</span></li>`;
  document.title = `${event.title} | Passage`;
  document.querySelector('meta[name="description"]')?.setAttribute('content', event.summary || event.title);
  $('#event-meta').innerHTML = `<b data-layer="${esc(event.layer)}">${esc(LAYER_NAMES[event.layer] || 'Event')}</b><span>${esc(dayLabel(event.date))} ${esc(event.date.slice(0, 4))}${event.time ? ' · ' + esc(event.time.replace('Z', ' UTC')) : ''}</span>${event.confidence === 'claimed' ? '<span class="ec-claimed">Claimed</span>' : ''}`;
  $('#event-title').textContent = event.title;
  $('#event-summary').textContent = event.summary || 'The report gives no summary.';
  const action = $('#event-map');
  if (event.precision === 'unplaced') { action.href = pageUrl('events/'); action.firstChild.textContent = 'Open the timeline '; }
  else action.href = pageUrl('war/', { event: event.id });
  $('#event-proof').innerHTML = item('Place', esc(event.place || '—'), esc(PRECISION[event.precision] || 'Approximate area')) + item('Sources', event.sources.length, event.sources.length === 1 ? 'linked report' : 'linked reports');
  const rows = [['Kind', LAYER_NAMES[event.layer] || 'Event'], ['Date', `${dayLabel(event.date)} ${event.date.slice(0, 4)}${event.time ? ', ' + event.time.replace('Z', ' UTC') : ''}`], ['Place', event.place || 'Not given'], ['Location', `${PRECISION[event.precision] || 'Approximate area'}${Number.isFinite(event.radiusNm) ? `, within ${Math.round(event.radiusNm)} NM` : ''}`]];
  if (event.actor) rows.push(['By', event.actor]);
  if (event.target) rows.push(['Target', event.target]);
  rows.push(['Status', event.confidence === 'claimed' ? 'Claimed by one side, not confirmed' : 'Reported']);
  $('#event-details').innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
  $('#event-sources').innerHTML = sourceItemsMarkup(event.sources);
  $('#sources-count').textContent = `${event.sources.length} ${event.sources.length === 1 ? 'report' : 'reports'}`;
  $('#map-note').textContent = event.precision === 'unplaced' ? 'This event has no position, so it is not on the map' : `${event.place}, with the other events nearby`;
  renderAround();
  renderMoves();
}

/** The events either side in time, and others at the same place. */
function renderAround() {
  const events = state.events.events, at = events.findIndex(e => e.id === state.event.id);
  const older = events[at + 1], newer = events[at - 1];
  const link = (event, dir) => event ? `<a href="${esc(eventHref(event))}" data-dir="${dir}"><small>${dir === 'prev' ? 'Earlier' : 'Later'} · ${esc(dayLabel(event.date))}</small><span>${esc(event.title)}</span></a>` : '<span></span>';
  $('#event-pager').innerHTML = link(older, 'prev') + link(newer, 'next');
  const same = events.filter(e => e.id !== state.event.id && e.place && e.place === state.event.place).slice(0, 5);
  $('#same-place-card').hidden = !same.length;
  $('#same-place-title').textContent = `Also at ${state.event.place}`;
  $('#same-place').innerHTML = eventListMarkup(same, { limit: 5, href: eventHref });
}

function renderMoves() {
  const event = state.event;
  if (!event || !state.oil) return;
  const brent = priceMove(brentObservations(state.oil), event.date);
  let html;
  if (brent?.before && brent.after) {
    const dir = brent.change > 0 ? 'up' : brent.change < 0 ? 'down' : '';
    html = `<div class="px"><span><i aria-hidden="true"></i>Brent on ${esc(dayLabel(brent.before.date))}</span><strong>${money(brent.before.value)}</strong><small>last close on or before the event</small></div>
      <div class="px"><span><i aria-hidden="true"></i>${brent.days} trading days later</span><strong>${money(brent.after.value)}</strong><small class="ec-move-${dir}">${esc(dayLabel(brent.after.date))} · ${esc(signed(brent.change))} (${esc(signed(brent.percent, 1))}%)</small></div>`;
  } else if (brent?.before) html = `<div class="px"><span><i aria-hidden="true"></i>Brent on ${esc(dayLabel(brent.before.date))}</span><strong>${money(brent.before.value)}</strong><small>Later closes are not yet published</small></div>`;
  else html = '<p class="empty-note">No Brent observation on or before this date.</p>';
  const pct = p => `${Math.round(p * 1000) / 10}%`, on = t => esc(dayLabel(new Date(t * 1000).toISOString()));
  const odds = relatedMarkets(state.expectations?.markets, event).map(m => ({ question: m.question, move: oddsMove(m.history, event.date) })).filter(o => o.move?.before);
  if (odds.length) html += `<div class="ec-move"><h4>Market odds over the next 3 days</h4>${odds.map(o => `<p>${esc(o.question)}: ${pct(o.move.before.p)} (${on(o.move.before.t)})${o.move.after ? ` → ${pct(o.move.after.p)} (${on(o.move.after.t)})` : ''}</p>`).join('')}</div>`;
  $('#event-moves').innerHTML = html;
  // The chart opens on a window that holds the event and the days after it.
  const series = chartSeries(state.oil), last = brentObservations(state.oil).filter(o => Number.isFinite(o.value)).at(-1)?.date;
  const period = last ? Math.max(30, Math.ceil((Date.parse(last) - Date.parse(event.date)) / DAY) + 21) : 90;
  chart.update(series, { period });
  chart.setMarkers([{ id: event.id, date: event.date, layer: event.layer, label: `${dayLabel(event.date)} · ${event.title}` }]);
  chart.focus({ id: event.id, date: event.date, endDate: brent?.after?.date || null });
}

function showOnMap() {
  if (!theatre || !state.event) return;
  theatre.setEvents(located(state.events.events));
  theatre.setMissions(activeMissions(state.events.missions, state.event.date), true);
  // Wide enough to show the event among its neighbors, not just the pin.
  if (state.event.precision !== 'unplaced') theatre.select(state.event.id, { zoom: 1.8 });
}

async function loadEvents() {
  state.events = await fetchEvents(state.events);
  const event = state.events.events.find(e => e.id === id) || null;
  if (!event) { if (state.events.events.length || state.events.reviewedAt) notFound(); return; }
  const changed = !state.event || JSON.stringify(state.event) !== JSON.stringify(event);
  state.event = event;
  if (changed) { renderEvent(); showOnMap(); }
}
async function loadMarkets() {
  const [oil, expectations] = await Promise.allSettled([load('/api/oil'), load('/api/expectations')]);
  if (oil.status === 'fulfilled') state.oil = oil.value;
  if (expectations.status === 'fulfilled') state.expectations = expectations.value;
  if (!state.oil && oil.status === 'rejected') { $('#event-moves').innerHTML = '<p class="error-note">Oil prices are unavailable right now.</p>'; chart.update([], { failed: true }); return; }
  renderMoves();
}

async function start() {
  if (!id) { notFound(); return; }
  chart = createOilChart($('#oil-chart'), { height: 300 });
  $('#theatre-zoom-in').addEventListener('click', () => theatre?.zoom(1.25));
  $('#theatre-zoom-out').addEventListener('click', () => theatre?.zoom(1 / 1.25));
  $('#event-card').addEventListener('click', event => { if (event.target.closest('[data-close-event]')) { $('#event-card').hidden = true; $('#event-card').innerHTML = ''; } });
  $('#theatre-reset').addEventListener('click', () => { if (state.event && state.event.precision !== 'unplaced') theatre?.select(state.event.id, { zoom: 1.8 }); else theatre?.reset(); });
  createTheatreMap($('#theatre-map'), {
    onSelect: picked => { if (picked && picked.id !== state.event?.id) location.href = eventHref(picked); },
    // A group of nearby events lists them on the map; each opens its own page.
    onGroup: list => { const card = $('#event-card'); card.innerHTML = eventGroupMarkup(list, { href: eventHref }); card.hidden = false; },
  }).then(map => { theatre = map; showOnMap(); })
    .catch(() => { $('#theatre-map').insertAdjacentHTML('beforeend', '<p class="map-fallback">The regional map could not load on this device. The details below still show.</p>'); });
  every(300_000, loadEvents);
  every(600_000, loadMarkets);
}
start();
