// War events for the theatre map and timeline. Curated, source-linked events and
// official register incidents share one shape; "show me" figures are computed
// only from dated observations and never claim the event caused them.
export const WAR_START = '2026-02-28';
export const LAYERS = Object.freeze({
  shipping: Object.freeze({ id: 'shipping', label: 'Attacks on shipping' }),
  'missile-drone': Object.freeze({ id: 'missile-drone', label: 'Missile & drone strikes' }),
  'strikes-on-iran-yemen': Object.freeze({ id: 'strikes-on-iran-yemen', label: 'Strikes on Iran & Yemen' }),
});
const DAY = 86_400_000;
const isDay = value => typeof value === 'string' && /^\d{4}-\d\d-\d\d$/.test(value) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
const inRange = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
const text = (value, max) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
const safeSources = sources => (Array.isArray(sources) ? sources : [])
  .filter(s => s && /^https:\/\//.test(s.url || '') && text(s.publisher, 80))
  .map(s => ({ publisher: text(s.publisher, 80), title: text(s.title, 200), url: s.url, date: isDay(s.date) ? s.date : null }));

/** Curated events: kept only when dated, located, layered and sourced. */
export function curatedEvents(json, { today = new Date().toISOString().slice(0, 10) } = {}) {
  return (Array.isArray(json?.events) ? json.events : []).flatMap(e => {
    const sources = safeSources(e?.sources);
    if (!e || !isDay(e.date) || e.date > today || !LAYERS[e.layer] || !inRange(e.lat, e.lon) || !sources.length || !text(e.title, 120)) return [];
    return [{
      id: 'war:' + text(e.id, 140), origin: 'curated', date: e.date, time: /^\d\d:\d\dZ$/.test(e.time || '') ? e.time : null,
      layer: e.layer, type: text(e.type, 40), actor: text(e.actor, 80), target: text(e.target, 120), place: text(e.place, 120), country: text(e.country, 80),
      lat: e.lat, lon: e.lon, precision: ['facility', 'city', 'area', 'sea-area'].includes(e.precision) ? e.precision : 'area', radiusNm: null,
      confidence: e.confidence === 'claimed' ? 'claimed' : 'confirmed', title: text(e.title, 120), summary: text(e.summary, 280), sources,
    }];
  });
}

/** Missions shown as dated, approximate areas. */
export function curatedMissions(json) {
  return (Array.isArray(json?.missions) ? json.missions : []).flatMap(m => {
    const polygon = (Array.isArray(m?.polygon) ? m.polygon : []).filter(p => Array.isArray(p) && inRange(p[1], p[0]));
    const sources = safeSources(m?.sources);
    if (!m || !isDay(m.start) || polygon.length < 3 || !sources.length) return [];
    return [{ id: 'mission:' + text(m.id, 120), name: text(m.name, 120), operator: text(m.operator, 120), start: m.start, end: isDay(m.end) ? m.end : null, area: text(m.area, 240), polygon, sources }];
  });
}

/** IMO register incidents that the collector could place, flagged approximate. */
export function registerEvents(maritime, { from = WAR_START } = {}) {
  return (Array.isArray(maritime?.events) ? maritime.events : []).flatMap(e => {
    const loc = e?.location, date = e?.eventDate || e?.publishedDate;
    if (!loc || !inRange(loc.lat, loc.lon) || !isDay(date) || date < from) return [];
    const url = /^https:\/\//.test(e.url || '') ? e.url : null;
    return [{
      id: 'imo:' + text(e.id || `${date}-${e.title}`, 160), origin: 'imo', date, time: null, layer: 'shipping', type: 'shipping-attack',
      actor: '', target: text(e.vessel || e.ship || '', 120) || 'Merchant vessel', place: text(e.locationText || loc.reference || '', 120), country: '',
      lat: loc.lat, lon: loc.lon, precision: 'area', radiusNm: Number.isFinite(loc.radiusNm) ? loc.radiusNm : null, confidence: 'confirmed',
      title: text(e.title, 120) || 'Incident in the IMO register', summary: text(e.summary || e.description, 280),
      sources: url ? [{ publisher: 'IMO', title: 'Middle East highlighted incidents', url, date }] : [],
    }];
  });
}

const nm = ([lon1, lat1], [lon2, lat2]) => {
  const r = Math.PI / 180, a = Math.sin((lat2 - lat1) * r / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon1) * r / 2) ** 2;
  return 3440.065 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
};
/**
 * One list, newest first. A register incident within a day and 80 NM of a
 * curated shipping event is treated as the same event: the curated record
 * keeps its detail and gains the register as a source.
 */
export function mergeEvents(curated = [], register = []) {
  const out = curated.map(e => ({ ...e, sources: [...e.sources] }));
  for (const r of register) {
    const twin = out.find(e => e.layer === 'shipping' && Math.abs(Date.parse(e.date) - Date.parse(r.date)) <= DAY && nm([e.lon, e.lat], [r.lon, r.lat]) <= 80);
    if (twin) { if (!twin.sources.some(s => s.publisher === 'IMO')) twin.sources.push(...r.sources); }
    else out.push(r);
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || (b.time || '').localeCompare(a.time || '') || a.id.localeCompare(b.id));
}

export function visibleEvents(events, { layers = Object.keys(LAYERS), from = WAR_START, to = '9999-12-31' } = {}) {
  const wanted = new Set(layers);
  return events.filter(e => wanted.has(e.layer) && e.date >= from && e.date <= to);
}
export const countsByLayer = events => Object.fromEntries(Object.keys(LAYERS).map(id => [id, events.filter(e => e.layer === id).length]));

/**
 * Brent (or WTI) around an event: the last observation on or before the event
 * date, and the observation `days` trading days later. Missing data stays null.
 */
export function priceMove(observations, date, { days = 3 } = {}) {
  const rows = (Array.isArray(observations) ? observations : []).filter(o => isDay(o?.date) && Number.isFinite(o.value)).sort((a, b) => a.date.localeCompare(b.date));
  if (!isDay(date)) return null;
  const beforeIndex = rows.findLastIndex(o => o.date <= date);
  if (beforeIndex < 0) return null;
  const before = rows[beforeIndex], after = rows[beforeIndex + days] || null;
  if (!after) return { before, after: null, change: null, percent: null, days };
  const change = after.value - before.value;
  return { before, after, change, percent: change / before.value * 100, days };
}

/** Market probability on the event day and `days` calendar days later, from daily history. */
export function oddsMove(history, date, { days = 3 } = {}) {
  const points = (Array.isArray(history) ? history : []).filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[1] >= 0 && p[1] <= 1).sort((a, b) => a[0] - b[0]);
  if (!isDay(date) || !points.length) return null;
  const start = Date.parse(date + 'T23:59:59Z') / 1000, end = start + days * 86400;
  const at = t => points.findLast(p => p[0] <= t) || null;
  const before = at(start), after = at(end);
  if (!before) return null;
  return { before: { t: before[0], p: before[1] }, after: after && after[0] > before[0] ? { t: after[0], p: after[1] } : null, days };
}

/** Markets whose topic relates to the event's layer, most relevant first. */
export function relatedMarkets(markets, event) {
  const order = event?.layer === 'shipping' ? [/shipping|attack|seiz|hormuz|transit/i] : event?.layer === 'missile-drone' ? [/attack|strike|military|missile|ceasefire/i] : [/ceasefire|diplomacy|strike|military|war/i];
  return (Array.isArray(markets) ? markets : []).filter(m => Array.isArray(m?.history) && m.history.length && order.some(re => re.test(`${m.topic} ${m.question}`))).slice(0, 2);
}
