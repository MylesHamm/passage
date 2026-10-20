// Pure markup for the operations-center panels. Every string is escaped here,
// every number carries its own date, and missing data stays visibly missing.
import { isCurrentVesselPosition, normalizeVesselTypeCode, vesselTypeLabel, POSITION_STALE_MS } from '../vessel-data.mjs';

export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const time = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const dayFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const clockFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function ageLabel(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
export const dayLabel = value => {
  const ms = /^\d{4}-\d\d-\d\d$/.test(value || '') ? Date.parse(value + 'T00:00:00Z') : time(value);
  return ms === null || !Number.isFinite(ms) ? '' : dayFormat.format(ms);
};
export const clockLabel = value => { const ms = time(value); return ms === null ? '' : clockFormat.format(ms) + ' UTC'; };
export const money = value => Number.isFinite(value) ? usd.format(value) : '—';

export const isTanker = vessel => { const code = normalizeVesselTypeCode(vessel?.shipTypeCode); return code !== null && code >= 80 && code <= 89; };

/** Counts only positions that are current under the shared expiry rule. */
export function vesselCounts(vessels, now = Date.now(), theater = 'hormuz') {
  const current = (Array.isArray(vessels) ? vessels : []).filter(v => v?.theater === theater && isCurrentVesselPosition(v, now));
  const newest = current.map(v => time(v.positionTime)).filter(Number.isFinite).sort((a, b) => b - a)[0] ?? null;
  return { total: current.length, tankers: current.filter(isTanker).length, newestAgeMs: newest === null ? null : Math.max(0, now - newest), current };
}

export function heroCountsMarkup(counts, { connected = true } = {}) {
  if (!connected) return '<span>Vessel feed unavailable · retrying</span>';
  if (!counts.total) return '<span>No current positions received</span>';
  return `<span class="tankers"><strong>${counts.tankers}</strong> ${counts.tankers === 1 ? 'tanker' : 'tankers'}</span><span><strong>${counts.total}</strong> vessels received</span>`;
}

export function vesselCardMarkup(vessel, now = Date.now()) {
  if (!vessel) return '';
  const age = now - (time(vessel.positionTime) ?? now);
  const heading = Number.isFinite(vessel.headingDegrees) ? `${Math.round(vessel.headingDegrees)}°` : Number.isFinite(vessel.courseDegrees) ? `${Math.round(vessel.courseDegrees)}° course` : 'Not reported';
  const rows = [
    ['Speed', Number.isFinite(vessel.speedKnots) ? `${vessel.speedKnots.toFixed(1)} kn` : 'Not reported'],
    ['Heading', heading],
    ['Position', `${Math.abs(vessel.latitude).toFixed(3)}° ${vessel.latitude >= 0 ? 'N' : 'S'}, ${Math.abs(vessel.longitude).toFixed(3)}° ${vessel.longitude >= 0 ? 'E' : 'W'}`],
    ['Received', `${clockLabel(vessel.positionTime)} · ${ageLabel(age)}`],
    ['MMSI', vessel.mmsi],
  ];
  return `<button type="button" class="vc-close" data-close-vessel aria-label="Close vessel details">×</button>
    <h3>${esc(vessel.name || 'Name not reported')}</h3>
    <p class="vc-type">${esc(isTanker(vessel) ? 'TANKER' : (vesselTypeLabel(vessel.shipType) || 'Type not reported').toUpperCase())}${age >= POSITION_STALE_MS ? ' · OLDER POSITION' : ''}</p>
    <dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
}

export function oddsMarkup(markets = [], { limit = 5 } = {}) {
  const list = (Array.isArray(markets) ? markets : []).filter(m => Number.isFinite(m?.probability) && m.probability >= 0 && m.probability <= 1 && m.question).slice(0, limit);
  if (!list.length) return '<li class="empty-note">No related markets right now.</li>';
  return list.map(m => {
    const pct = Math.round(m.probability * 1000) / 10;
    const label = pct < 1 ? '<1%' : pct > 99 ? '>99%' : `${pct.toFixed(pct < 10 ? 1 : 0)}%`;
    const href = /^https:\/\/polymarket\.com\//.test(m.url || '') ? m.url : 'https://polymarket.com/';
    const resolves = dayLabel(m.endDate);
    return `<li class="odds-item"><a href="${esc(href)}" target="_blank" rel="noopener noreferrer" title="${esc(resolves ? `Resolves ${resolves} · Polymarket` : 'Polymarket')}">
      <span class="odds-q">${esc(m.question)}</span><span class="odds-p">${esc(label)}</span>
      <span class="odds-bar" aria-hidden="true"><i style="width:${Math.max(1, Math.min(100, pct))}%"></i></span></a></li>`;
  }).join('');
}

// Core publishers only: the retained archive also holds aggregator domains from
// retired discovery, which would dilute a headline list.
export const CORE_PUBLISHERS = new Set(['bbc', 'aj', 'mee', 'memo', 'france24', 'un']);
export function headlineItems(items = [], { region = 'all', limit = 6, now = Date.now() } = {}) {
  return (Array.isArray(items) ? items : [])
    .filter(item => CORE_PUBLISHERS.has(item?.sourceId) && item.title && /^https:\/\//.test(item.url || '') && time(item.publishedAt) !== null && time(item.publishedAt) <= now + 300000)
    .filter(item => region === 'all' || (Array.isArray(item.theaters) && item.theaters.includes(region)))
    .sort((a, b) => time(b.publishedAt) - time(a.publishedAt))
    .slice(0, limit);
}
export function headlinesMarkup(items, options) {
  const list = headlineItems(items, options);
  if (!list.length) return '<li class="empty-note">No recent headlines from these publishers.</li>';
  return list.map(item => `<li class="headline-item"><a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.title)}</a><span class="headline-meta">${esc(item.source)} · ${esc(dayLabel(item.publishedAt))} ${esc(clockLabel(item.publishedAt))}</span></li>`).join('');
}

/** Latest close per series; the newest of daily history and next-day closes wins. */
export function latestPrices(oil) {
  const out = {};
  for (const series of Array.isArray(oil?.series) ? oil.series : []) {
    const last = (series.observations || []).filter(o => Number.isFinite(o?.value) && /^\d{4}-\d\d-\d\d$/.test(o.date || '')).at(-1);
    if (last) out[series.id] = { value: last.value, date: last.date, basis: 'EIA daily spot' };
  }
  for (const close of Array.isArray(oil?.latestCloses) ? oil.latestCloses : []) {
    if (!Number.isFinite(close?.value) || !/^\d{4}-\d\d-\d\d$/.test(close.date || '')) continue;
    if (!out[close.id] || close.date > out[close.id].date) out[close.id] = { value: close.value, date: close.date, basis: close.basis || 'EIA spot close' };
  }
  return out;
}

/**
 * Daily history plus any newer dated close as its own observation. Missing days
 * in between stay missing, so the chart shows a gap rather than a filled line.
 */
export function chartSeries(oil) {
  const closes = Array.isArray(oil?.latestCloses) ? oil.latestCloses : [];
  return (Array.isArray(oil?.series) ? oil.series : []).map(series => {
    const observations = Array.isArray(series.observations) ? series.observations : [];
    const last = observations.filter(o => /^\d{4}-\d\d-\d\d$/.test(o?.date || '')).at(-1)?.date || '';
    const close = closes.find(c => c?.id === series.id && Number.isFinite(c.value) && /^\d{4}-\d\d-\d\d$/.test(c.date || '') && c.date > last);
    return close ? { ...series, observations: [...observations, { date: close.date, value: close.value }] } : series;
  });
}

export function transitRowMarkup({ name, rows = [], baseline = null, latest = null }) {
  if (!latest) return `<div class="transit-row"><div class="transit-name"><span>${esc(name)}</span></div><p class="empty-note">No transit counts available.</p></div>`;
  const share = baseline && Number.isFinite(baseline.total) && baseline.total > 0 ? Math.round(latest.total / baseline.total * 100) : null;
  const recent = rows.slice(-42), max = Math.max(1, baseline?.total || 0, ...recent.map(r => r.total || 0));
  const w = 300, h = 44, step = w / Math.max(1, recent.length), bar = Math.max(1, step - 1.5);
  const bars = recent.map((r, i) => {
    const total = (r.total || 0) / max * (h - 2), tanker = (r.tankers || 0) / max * (h - 2), x = (i * step).toFixed(1);
    return `<rect class="total" x="${x}" y="${(h - total).toFixed(1)}" width="${bar.toFixed(1)}" height="${total.toFixed(1)}"/><rect class="tanker" x="${x}" y="${(h - tanker).toFixed(1)}" width="${bar.toFixed(1)}" height="${tanker.toFixed(1)}"/>`;
  }).join('');
  const base = baseline && Number.isFinite(baseline.total) ? `<line class="baseline" x1="0" x2="${w}" y1="${(h - baseline.total / max * (h - 2)).toFixed(1)}" y2="${(h - baseline.total / max * (h - 2)).toFixed(1)}"/>` : '';
  return `<div class="transit-row">
    <div class="transit-name"><span>${esc(name)}</span><span class="stamp">${esc(dayLabel(latest.date))}</span></div>
    <div class="transit-figures"><strong>${latest.total}</strong><span>ships</span><span class="tankers"><b>${latest.tankers}</b> tankers</span>${share === null ? '' : `<span class="transit-share" data-low="${share < 50}">${share}% of average</span>`}</div>
    ${baseline && Number.isFinite(baseline.total) ? `<p class="transit-baseline">${esc(baseline.label)}: <b>${Math.round(baseline.total)}</b> ships · <b>${Math.round(baseline.tankers)}</b> tankers</p>` : ''}
    <svg class="transit-bars" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${esc(name)} daily transits over the last ${recent.length} days, tankers highlighted">${bars}${base}</svg>
  </div>`;
}

const STATE_LABEL = { live: 'Current', stale: 'Delayed or partial', down: 'Unavailable', idle: 'Not connected' };
// Maps sourceHealth statuses to three visible states. Anything other than a
// current, attention-free source is shown as delayed or down, never as live.
export function sourceState(source) {
  if (!source?.configured || source.status === 'disabled') return 'idle';
  if (source.status === 'unavailable') return 'down';
  if (source.status === 'current' && !source.attention) return 'live';
  return 'stale';
}
/** One line for the top bar: how many of the dashboard's sources are current. */
export function statusSummary(sources = []) {
  const used = sources.filter(s => s && sourceState(s) !== 'idle');
  if (!used.length) return { state: 'checking', text: 'Checking sources' };
  const live = used.filter(s => sourceState(s) === 'live').length, down = used.filter(s => sourceState(s) === 'down').length;
  return { state: down ? (live ? 'degraded' : 'down') : live === used.length ? 'live' : 'degraded', text: live === used.length ? 'All sources current' : `${live} of ${used.length} sources current` };
}

export const ABOUT_NOTES = [
  ['Vessels', 'Positions come from AISStream, a free feed relayed by coastal receivers. It covers part of Hormuz and none of Bab el-Mandeb. Tankers often switch AIS off near attacks, so an empty map does not mean an empty strait. Positions older than 10 minutes fade, and are dropped after 30.'],
  ['Ship models', 'Tankers are drawn as detailed models enlarged far beyond true scale so they can be seen, turned to their reported heading. A vessel without a reported heading is shown as a ring, never with a guessed direction.'],
  ['Tracks and replay', 'Trails and the replay show positions actually received over the last hour, joined in the order received. Nothing is extrapolated between reports.'],
  ['Transits', 'IMF PortWatch daily counts are derived from satellite AIS. They are released weekly, so the latest day is often several days old.'],
  ['Oil prices', 'Daily Brent and WTI spot prices from the U.S. Energy Information Administration. EIA publishes history weekly and next-day closes on Today in Energy. These are not live trading quotes.'],
  ['Market odds', 'Polymarket prices show what traders expect, not what has happened. Each question resolves on its own published rules.'],
  ['Headlines', 'Original reporting from BBC, Al Jazeera, Middle East Eye, Middle East Monitor, France 24 and UN News, linked to the publisher.'],
];
export function aboutMarkup(sources = []) {
  const rows = sources.filter(s => s && sourceState(s) !== 'idle').map(s => {
    const state = sourceState(s);
    return `<tr><td><span class="dot" data-state="${state}"></span>${esc(s.name)}</td><td>${esc(STATE_LABEL[state])}</td><td class="num">${esc(s.latest ? dayLabel(s.latest) : s.retrievedAt ? 'Checked ' + clockLabel(s.retrievedAt) : '—')}</td></tr>`;
  }).join('');
  return `<h3>Sources</h3><table class="source-table"><thead><tr><th>Source</th><th>Status</th><th>Latest</th></tr></thead><tbody>${rows || '<tr><td colspan="3">Checking…</td></tr>'}</tbody></table>
    <h3>How to read this</h3><ul>${ABOUT_NOTES.map(([k, v]) => `<li><strong>${esc(k)}.</strong> ${esc(v)}</li>`).join('')}</ul>
    <h3>Credits</h3><p>Sources: UN Global Platform; IMF PortWatch (portwatch.imf.org). Oil prices: U.S. Energy Information Administration. Vessel positions: AISStream. Market odds: Polymarket. Terrain: Mapzen Terrain Tiles (USGS SRTM, GMTED2010; NOAA ETOPO1). Ship model drawn with the Anatomy kit (MIT).</p>`;
}
