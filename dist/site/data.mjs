// Data loading shared by every page. Each panel loads on its own clock and shows
// one data-age stamp; a failed source leaves its last good data with a clear stamp.
import { apiFetch, siteUrl } from '../runtime-config.mjs';
import { chartSeries, ageLabel, dayLabel } from '../ops/panels.mjs';
import { curatedEvents, curatedMissions, registerEvents, unplacedRegisterEvents, mergeEvents } from '../ops/events.mjs';

export const $ = selector => document.querySelector(selector);
export const DAY = 86_400_000;

export async function load(path) {
  const response = await apiFetch(path, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`${path} ${response.status}`);
  return response.json();
}
/** Runs `task` now and every `ms` while the page is visible, and again on return to it. */
export function every(ms, task) {
  let timer = 0;
  const run = async () => { clearTimeout(timer); if (!document.hidden) await task().catch(() => {}); timer = setTimeout(run, ms); };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) run(); });
  return run();
}
export function stamp(node, text, status = 'live') { if (!node) return; node.textContent = text; node.dataset.state = status; }

/** A link to another page of the site, wherever the site is hosted. */
export function pageUrl(path, params = {}) {
  const url = new URL(siteUrl(path));
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  return url.href;
}
export const eventHref = event => pageUrl('event/', { id: event.id });

export const brentObservations = oil => chartSeries(oil).find(s => s.id === 'brent')?.observations || [];

/* War events */
// The collector serves the live curated list. The copy bundled with the site is
// used only until a live copy arrives, never in place of a newer one.
const bundledEvents = () => fetch(siteUrl('data/war-events.json'), { headers: { accept: 'application/json' } }).then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); });
async function liveEvents() {
  const data = await load('/api/events');
  if (!Array.isArray(data?.events) || !data.events.length) throw new Error('No curated events');
  return { ...data, live: true };
}
/**
 * Curated events plus IMO register incidents, merged into one list, newest first.
 * Pass the previous result so a failed refresh keeps the last good data.
 */
export async function fetchEvents(previous = null) {
  const [curated, maritime] = await Promise.allSettled([
    liveEvents().catch(error => previous?.curated?.live ? Promise.reject(error) : bundledEvents().then(data => ({ ...data, live: false }))),
    load('/api/maritime'),
  ]);
  const next = {
    curated: curated.status === 'fulfilled' ? curated.value : previous?.curated ?? null,
    maritime: maritime.status === 'fulfilled' ? maritime.value : previous?.maritime ?? null,
  };
  next.live = Boolean(next.curated?.live && curated.status === 'fulfilled');
  next.reviewedAt = next.curated?.reviewedAt || null;
  next.events = mergeEvents(curatedEvents(next.curated), [...registerEvents(next.maritime), ...unplacedRegisterEvents(next.maritime)]);
  next.missions = curatedMissions(next.curated);
  return next;
}
const reviewedLabel = value => /T/.test(value || '') ? ageLabel(Date.now() - Date.parse(value)) : dayLabel(value);
/** The events stamp: when the curated list was last reviewed, and whether this is the saved copy. */
export function eventsStamp(data) {
  const reviewed = data?.reviewedAt;
  return {
    text: reviewed ? `Curated · reviewed ${reviewedLabel(reviewed)}${data.live ? '' : ' · saved copy'}` : 'Curated events unavailable',
    state: data?.live ? 'live' : reviewed ? 'stale' : 'down',
  };
}
