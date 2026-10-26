// Section motion (design-to-motion, website mode). A section marked
// data-intro="wait" loads in once, when it scrolls into view: cards rise from
// below and resolve from blur, text and values rise, bars fill like progress and
// lines draw, staggered in reading order. Then each visual acts out its story on
// one clock that runs only while a story is on screen and pauses off screen.
//
// Stories read real, dated values: a highlight steps along observed points and
// the tip shows each one's own figure and date. Nothing between observations is
// ever shown as data, and nothing counts up. Reduced motion lands on the final
// state with no stories.
import { esc } from '../ops/panels.mjs';

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
// Reading order: text 80 ms apart, cards 85 ms apart, a card's contents 150 ms after it and 60 ms apart.
const TEXT_STEP = 80, CARD_STEP = 85, CARD_LEAD = 150, ITEM_STEP = 60, LONGEST = 1100, LOAD_LANDS = 2000;

/** Sets each moving part's delay in reading order and returns the last one. */
export function introDelays(units) {
  let cursor = 0, last = 0;
  const cards = new Map();
  for (const el of units) {
    const kind = el.dataset.motion, host = kind === 'card' ? null : el.parentElement?.closest('[data-motion=card]');
    let delay;
    if (kind === 'card') { delay = cursor; cursor += CARD_STEP; cards.set(el, { delay, items: 0 }); }
    else if (host && cards.has(host)) { const card = cards.get(host); delay = card.delay + CARD_LEAD + ITEM_STEP * card.items++; }
    else { delay = cursor; cursor += TEXT_STEP; }
    el.style.setProperty('--d', `${delay}ms`);
    last = Math.max(last, delay);
  }
  return last;
}

function finish(section) {
  section.dataset.intro = 'done';
  for (const el of section.querySelectorAll('[data-motion]')) el.style.removeProperty('--d');
  section.dispatchEvent(new Event('intro:done'));
}
function play(section) {
  const last = introDelays(section.querySelectorAll('[data-motion]'));
  section.dataset.intro = 'in';
  setTimeout(() => finish(section), last + LONGEST);
}
/** Plays each waiting section's intro once, when its top passes 70% of the viewport. */
export function bindIntros(root = document) {
  const sections = [...root.querySelectorAll('[data-intro=wait]')];
  document.documentElement.dataset.motion = 'on';
  if (reduced() || typeof IntersectionObserver !== 'function') { sections.forEach(finish); return; }
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) { observer.unobserve(entry.target); play(entry.target); }
  }, { rootMargin: '0px 0px -30% 0px' });
  for (const section of sections) observer.observe(section);
}
/** Resolves once the section holding `el` has finished its intro (at once if it has none). */
export function afterIntro(el) {
  const section = el.closest('[data-intro]');
  if (!section || section.dataset.intro === 'done') return Promise.resolve();
  // A section that enters at first paint has landed by the time its longest entrance ends.
  if (section.dataset.intro === 'load') return new Promise(resolve => setTimeout(resolve, LOAD_LANDS));
  return new Promise(resolve => section.addEventListener('intro:done', resolve, { once: true }));
}
/** A part that arrives after its section loaded in (data comes later) plays its own entrance. */
function arrive(el, keyframes, duration, delay = 0) {
  const state = el.closest('[data-intro]')?.dataset.intro;
  if (reduced() || state === 'wait' || typeof el.animate !== 'function') return;
  el.animate(keyframes, { duration, delay, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', fill: 'backwards', iterations: 1 });
}
/**
 * Bars and meters fill like progress, left to right, 60 ms apart. Before the
 * section has loaded in they join its intro; arriving later, they fill on their own.
 */
export function fill(nodes) {
  const section = nodes[0]?.closest('[data-intro]');
  [...nodes].forEach((node, index) => {
    if (section?.dataset.intro === 'wait') node.dataset.motion = 'wipe';
    else arrive(node, [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], 900, index * 60);
  });
}

/* One clock for every story. Each story keeps its own time, so it pauses when it
   leaves the viewport and resumes where it was; nothing runs on a hidden page. */
const stories = new Map();
let frame = 0, last = 0;
const seen = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
  for (const entry of entries) { const story = stories.get(entry.target); if (story) story.visible = entry.isIntersecting; }
  wake();
}) : null;
function wake() {
  if (frame || document.hidden) return;
  for (const story of stories.values()) if (story.visible && story.ready) { last = 0; frame = requestAnimationFrame(tick); return; }
}
function tick(now) {
  frame = 0;
  // Capped so a slow or throttled frame never skips a whole beat.
  const dt = last ? Math.min(250, now - last) / 1000 : 0;
  last = now;
  let running = false;
  for (const story of stories.values()) {
    if (!story.visible || !story.ready) continue;
    running = true;
    story.t += dt;
    story.draw(story.t < 0 ? null : story.t % story.length);
  }
  if (running && !document.hidden) frame = requestAnimationFrame(tick);
}
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { last = 0; wake(); });

/**
 * Runs `draw(t)` on the clock once the element's section has loaded in. `t` is
 * seconds into the story, or null at rest (the design). Returns a stop function.
 */
export function addStory(el, { length, offset = 0, draw }) {
  draw(null);
  if (reduced() || !seen) return () => {};
  const story = { length, t: -offset, draw, visible: false, ready: false };
  stories.set(el, story); seen.observe(el);
  afterIntro(el).then(() => { story.ready = true; wake(); });
  return () => { stories.delete(el); seen.unobserve(el); draw(null); };
}

/* Read along: a small chart whose story is being read, point by point. */
const W = 300, H = 56, BEAT = .7, HOLD = 1.4, REST = 1.8, MAX_STOPS = 7;
const fmt = n => n.toFixed(1);

/** The points a story stops on: evenly spread, always ending on the latest. */
export function storyStops(count, max = MAX_STOPS) {
  if (count < 1) return [];
  const n = Math.min(count, max);
  return n === 1 ? [count - 1] : Array.from({ length: n }, (_, i) => Math.round(i * (count - 1) / (n - 1)));
}
/** Which stop the story is on at `t` seconds, or -1 when it is at rest. */
export function storyStep(t, stops) {
  if (t === null || !stops) return -1;
  const reading = stops * BEAT;
  if (t < reading) return Math.floor(t / BEAT);
  return t < reading + HOLD ? stops - 1 : -1;
}
export const storyLength = stops => stops * BEAT + HOLD + REST;

function barsSvg(points, baseline, label) {
  const max = Math.max(1, Number.isFinite(baseline) ? baseline : 0, ...points.map(p => p.value || 0)), step = W / points.length, bar = Math.max(1, step - 2);
  const bars = points.map((p, i) => {
    const h = (p.value || 0) / max * (H - 2), part = Number.isFinite(p.part) ? p.part / max * (H - 2) : null, x = fmt(i * step);
    return `<rect class="spark-bar" data-i="${i}" x="${x}" y="${fmt(H - h)}" width="${fmt(bar)}" height="${fmt(h)}"/>${part === null ? '' : `<rect class="spark-bar" data-kind="tanker" data-i="${i}" x="${x}" y="${fmt(H - part)}" width="${fmt(bar)}" height="${fmt(part)}"/>`}`;
  }).join('');
  const base = Number.isFinite(baseline) ? `<line class="spark-base" x1="0" x2="${W}" y1="${fmt(H - baseline / max * (H - 2))}" y2="${fmt(H - baseline / max * (H - 2))}"/>` : '';
  return { svg: `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}">${bars}${base}</svg>`, x: i => (i + .5) * step, y: i => H - (points[i].value || 0) / max * (H - 2) };
}
function lineSvg(points, label) {
  const values = points.map(p => p.value), finite = values.filter(Number.isFinite);
  const min = Math.min(...finite), span = Math.max(...finite) - min || 1, step = W / Math.max(1, points.length - 1);
  const y = i => H - 4 - (values[i] - min) / span * (H - 8);
  let d = '', open = false;
  values.forEach((v, i) => { if (!Number.isFinite(v)) { open = false; return; } d += `${open ? 'L' : 'M'}${fmt(i * step)},${fmt(y(i))}`; open = true; });
  return { svg: `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}"><path class="spark-line" d="${d}" pathLength="1"/></svg>`, x: i => i * step, y };
}

/**
 * A small chart in a card, read point by point: bars (with an optional dashed
 * average) or a line. Each point is { value, tip, part? }, where `tip` is the
 * point's own figure and date. `set` redraws it with new data and keeps the story.
 */
export function createReadAlong(mount, { kind = 'bars', label = '', offset = 0, empty = 'No observations yet.' } = {}) {
  mount.classList.add('readalong'); mount.dataset.kind = kind;
  let points = [], geometry = null, stops = [], shown = -2, drawn = false, stop = null;
  const tip = Object.assign(document.createElement('span'), { className: 'ra-tip' });
  const dot = Object.assign(document.createElement('span'), { className: 'ra-dot' });
  tip.setAttribute('aria-hidden', 'true'); dot.setAttribute('aria-hidden', 'true');

  function show(index) {
    if (index === shown) return;
    shown = index;
    const svg = mount.querySelector('svg');
    mount.dataset.reading = String(index >= 0);
    svg?.querySelectorAll('[data-active]').forEach(el => el.removeAttribute('data-active'));
    if (index < 0) { tip.dataset.shown = 'false'; dot.dataset.shown = 'false'; return; }
    svg?.querySelectorAll(`[data-i="${index}"]`).forEach(el => el.setAttribute('data-active', 'true'));
    // Positions in the mount's own pixels; the chart sits below the strip kept for the tip.
    const box = mount.getBoundingClientRect(), plot = svg.getBoundingClientRect();
    const x = plot.left - box.left + geometry.x(index) / W * plot.width, y = plot.top - box.top + geometry.y(index) / H * plot.height;
    tip.innerHTML = points[index].tip;
    const width = tip.offsetWidth || 120, left = Math.min(Math.max(0, x - width / 2), Math.max(0, box.width - width));
    tip.style.transform = `translate(${left.toFixed(0)}px, 0)`;
    dot.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    tip.dataset.shown = 'true'; dot.dataset.shown = 'true';
  }
  const draw = t => { if (geometry) show(storyStep(t, stops.length) < 0 ? -1 : stops[storyStep(t, stops.length)]); };

  return {
    set(next, { baseline = null } = {}) {
      points = (Array.isArray(next) ? next : []).filter(p => p && (kind === 'bars' ? Number.isFinite(p.value) : true));
      const usable = kind === 'line' ? points.filter(p => Number.isFinite(p.value)).length >= 2 : points.length > 0;
      shown = -2;
      if (!usable) { geometry = null; stop?.(); stop = null; mount.innerHTML = `<p class="empty-note">${esc(empty)}</p>`; return; }
      const built = kind === 'line' ? lineSvg(points, label) : barsSvg(points, baseline, label);
      geometry = built;
      // Line stories stop only on observed points.
      stops = storyStops(points.length).map(i => kind === 'line' && !Number.isFinite(points[i].value) ? points.findLastIndex((p, j) => j <= i && Number.isFinite(p.value)) : i).filter(i => i >= 0);
      mount.innerHTML = built.svg; mount.append(dot, tip);
      const svg = mount.querySelector('svg');
      svg.dataset.motion = kind === 'line' ? 'draw' : 'wipe';
      if (!drawn) {
        drawn = true;
        if (kind === 'line') arrive(svg.querySelector('path'), [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], 1100);
        else arrive(svg, [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], 900);
      }
      if (!stop) stop = addStory(mount, { length: storyLength(stops.length), offset, draw });
      else draw(null);
    },
  };
}

/* Accent: a live status dot sends out a ring every two seconds while its feed is current. */
export function pulse(dot, { offset = 0 } = {}) {
  const ring = Object.assign(document.createElement('span'), { className: 'pulse-ring' });
  ring.setAttribute('aria-hidden', 'true'); dot.append(ring);
  return addStory(dot, {
    length: 2, offset,
    draw: t => {
      const live = dot.closest('[data-state]')?.dataset.state === 'live' || dot.dataset.state === 'live';
      const k = t === null || !live ? 1 : t / 2;
      ring.style.transform = `scale(${(1 + 1.6 * k).toFixed(3)})`;
      ring.style.opacity = t === null || !live ? '0' : (.55 * (1 - k)).toFixed(3);
    },
  });
}

/** A list's story: a soft highlight steps down its rows in reading order, then rests. */
export function stepRows(list, { offset = 0, beat = 1.2 } = {}) {
  list.dataset.storyRows = '';
  let lastRow = null;
  const rows = () => [...list.children].filter(li => !li.classList.contains('empty-note'));
  return addStory(list, {
    length: beat * 6 + REST, offset,
    draw: t => {
      const all = rows(), count = Math.min(5, all.length), index = t === null ? -1 : Math.floor(t / beat);
      const row = index >= 0 && index < count ? all[index] : null;
      if (row === lastRow) return;
      lastRow?.removeAttribute('data-active'); row?.setAttribute('data-active', 'true'); lastRow = row;
    },
  });
}
