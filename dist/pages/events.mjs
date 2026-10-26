// Events: the whole curated list and the IMO register by month, newest first.
// Every entry links to its own page.
import '../site/shell.mjs';
import { $, every, stamp, fetchEvents, eventsStamp, eventHref, DAY } from '../site/data.mjs';
import { eventTimelineMarkup, dayLabel, esc } from '../ops/panels.mjs';
import { WAR_START } from '../ops/events.mjs';

const state = { events: null, layer: 'all' };

function render() {
  const events = state.events?.events || [];
  const { text, state: status } = eventsStamp(state.events);
  stamp($('#events-stamp'), text, status);
  $('#hero-eyebrow').dataset.state = status;
  if (!events.length) {
    $('#event-counts').innerHTML = '<li><span class="error-note">Events are unavailable right now. The page retries every five minutes.</span></li>';
    $('#timeline-body').innerHTML = '<p class="empty-note">No events to show yet.</p>';
    return;
  }
  const week = events.filter(e => Date.now() - Date.parse(e.date + 'T12:00:00Z') <= 7 * DAY).length;
  const item = (label, value, note) => `<li><span class="label">${label}</span><span class="value">${value}</span><span class="note">${note}</span></li>`;
  $('#event-counts').innerHTML = item('Events', events.length, `since ${esc(dayLabel(WAR_START))}`) + item('Last 7 days', week, 'events') + item('Latest', esc(dayLabel(events[0].date)), 'newest entry');
  $('#latest-event').href = eventHref(events[0]);
  // Each filter shows how many events it holds.
  for (const chip of document.querySelectorAll('[data-timeline-layer]')) {
    const layer = chip.dataset.timelineLayer, n = layer === 'all' ? events.length : events.filter(e => e.layer === layer).length;
    let badge = chip.querySelector('.chip-count');
    if (!badge) badge = chip.appendChild(Object.assign(document.createElement('span'), { className: 'chip-count' }));
    badge.textContent = String(n);
  }
  const list = state.layer === 'all' ? events : events.filter(e => e.layer === state.layer);
  const unplaced = list.filter(e => e.precision === 'unplaced').length;
  $('#timeline-note').textContent = `${list.length} events since ${dayLabel(WAR_START)}${unplaced ? ` · ${unplaced} listed without a map position, because their reports give none` : ''}`;
  $('#timeline-body').innerHTML = eventTimelineMarkup(list, { href: eventHref });
}

async function loadEvents() { state.events = await fetchEvents(state.events); render(); }

document.querySelectorAll('[data-timeline-layer]').forEach(button => button.addEventListener('click', () => {
  state.layer = button.dataset.timelineLayer;
  document.querySelectorAll('[data-timeline-layer]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
  render();
}));
every(300_000, loadEvents);
