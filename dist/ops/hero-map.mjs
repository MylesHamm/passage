// Hormuz hero map: WebGL terrain with received vessels, last-hour tracks and a
// replay of received positions. Nothing is extrapolated between reports.
import { SCENES, geographicPoint, clamp } from '../terrain/geometry.mjs';
import { createWebGLRenderer, createPlanRenderer, loadSceneAssets } from '../terrain/renderer.mjs';
import { projectedVesselAngle } from '../terrain/vessel-symbol.mjs';
import { isCurrentVesselPosition, POSITION_STALE_MS } from '../vessel-data.mjs';
import { isTanker, esc } from './panels.mjs';

const SCENE = SCENES.hormuz;
// The free feed's receivers sit along the Dubai and Sharjah coast, so the
// default frame runs from those anchorages to the strait and Iran beyond.
const FRAME_CENTER = [55.72, 25.68];
// Reference places only; their coordinates are static, not vessel data.
const HERO_LABELS = [
  { name: 'UAE', point: [55.6, 24.85], kind: 'country' },
  { name: 'Dubai', point: [55.27, 25.2], kind: 'place' },
  { name: 'Jebel Ali', point: [55.06, 25.01], kind: 'place' },
  { name: 'Sharjah', point: [55.39, 25.35], kind: 'place' },
  { name: 'Fujairah', point: [56.33, 25.12], kind: 'place' },
  { name: 'STRAIT OF HORMUZ', point: [56.55, 26.45], kind: 'water' },
];
export const REPLAY_WINDOW_MS = 60 * 60_000;
export const REPLAY_DURATION_MS = 12_000;
// Camera sway: a slow look around the strait, pausable, off under reduced
// motion, and paused for a while after any direct interaction.
const SWAY_AMPLITUDE = .3, SWAY_PERIOD_MS = 80_000, SWAY_RESUME_MS = 20_000, SWAY_RAMP_MS = 1200;

const ms = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
export function heroPose() {
  const [x, , z] = geographicPoint(FRAME_CENTER, SCENE);
  return { zoom: 1.05, tilt: .92, yaw: -.72, panX: x, panZ: z, topDown: false };
}

/** Initial bearing from one received position to the next, in degrees. */
export function segmentBearing([lon1, lat1], [lon2, lat2]) {
  const r = Math.PI / 180, y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}

/** A received track plus the current position, oldest first, inside the window. */
export function trackPoints(vessel, now = Date.now(), windowMs = REPLAY_WINDOW_MS) {
  const points = (Array.isArray(vessel?.track) ? vessel.track : [])
    .filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && ms(p[2]) !== null && now - ms(p[2]) <= windowMs && ms(p[2]) <= now)
    .map(p => [p[0], p[1], ms(p[2])]);
  const current = ms(vessel?.positionTime);
  if (current !== null && Number.isFinite(vessel.longitude) && Number.isFinite(vessel.latitude) && (!points.length || current > points.at(-1)[2])) points.push([vessel.longitude, vessel.latitude, current]);
  return points.sort((a, b) => a[2] - b[2]);
}

/**
 * Where a vessel was at time t, between two received positions. Before its
 * first received point it is absent; it never moves past its latest report.
 */
export function positionAt(points, t) {
  if (!points.length || t < points[0][2]) return null;
  if (t >= points.at(-1)[2]) {
    const last = points.at(-1), prev = points.at(-2);
    return { longitude: last[0], latitude: last[1], bearing: prev ? segmentBearing(prev, last) : null };
  }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (t <= b[2]) {
      const k = b[2] === a[2] ? 1 : (t - a[2]) / (b[2] - a[2]);
      return { longitude: a[0] + (b[0] - a[0]) * k, latitude: a[1] + (b[1] - a[1]) * k, bearing: segmentBearing(a, b) };
    }
  }
  return null;
}

// Interim symbol until the detailed model is available: a top-down hull with
// its bow up, rotated to the projected heading. Never shown for unknown headings.
function silhouette(length) {
  const w = Math.round(length * .26), h = Math.round(length);
  return `<svg width="${w}" height="${h}" viewBox="0 0 26 100" aria-hidden="true"><path d="M13 1 L21 14 L23 30 L23 92 Q23 99 13 99 Q3 99 3 92 L3 30 L5 14 Z" fill="#1d2b36" stroke="#ffc069" stroke-width="2"/><rect x="6" y="74" width="14" height="16" rx="1.5" fill="#e9eef2"/><rect x="7.5" y="76" width="11" height="2.5" fill="#ffc069"/><line x1="13" y1="20" x2="13" y2="70" stroke="#ffc06988" stroke-width="1.4"/></svg>`;
}

export async function createHeroMap(root, { onSelect } = {}) {
  let canvas = root.querySelector('canvas');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const overlay = Object.assign(document.createElement('div'), { className: 'map-overlay' });
  const tracksSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  tracksSvg.setAttribute('class', 'map-tracks'); tracksSvg.setAttribute('aria-hidden', 'true');
  overlay.append(tracksSvg); root.append(overlay);
  const labels = [...SCENE.labels.filter(l => l.name !== 'UAE'), ...HERO_LABELS].map(label => {
    const node = Object.assign(document.createElement('span'), { className: 'map-label', textContent: label.name });
    node.dataset.kind = label.kind; node.setAttribute('aria-hidden', 'true'); overlay.append(node);
    return { label, node };
  });
  let sprites = null;
  import('../terrain/ship-sprites.mjs').then(module => { sprites = module; dirty = true; schedule(); }).catch(() => {});

  let renderer = null, pose = heroPose(), width = 1, height = 1, frame = 0, dirty = true, destroyed = false;
  let vessels = [], showAll = true, selected = null, paused = false, inView = true, lastInteraction = -Infinity;
  let drag = null, swayClock = 0, swayRamp = 0, last = 0, replay = null;
  const nodes = new Map();

  try { renderer = createWebGLRenderer(canvas); }
  catch { canvas.replaceWith(canvas = Object.assign(document.createElement('canvas'), { className: canvas.className })); renderer = createPlanRenderer(canvas); }
  const assets = await loadSceneAssets(SCENE, { planOnly: renderer.mode === 'plan' });
  renderer.setScene(SCENE, assets);

  function resize() {
    const box = root.getBoundingClientRect();
    width = Math.max(1, Math.round(box.width)); height = Math.max(1, Math.round(box.height));
    renderer.resize(width, height); tracksSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    dirty = true; schedule();
  }
  const swaying = () => !reduced.matches && !paused && inView && !document.hidden && !drag && renderer.mode === 'webgl' && !pose.topDown && performance.now() - lastInteraction > SWAY_RESUME_MS;
  const animating = () => replay || drag || swaying() || dirty;
  function schedule() { if (!frame && !destroyed && animating()) frame = requestAnimationFrame(tick); }

  function tick(now) {
    frame = 0;
    const dt = last ? Math.min(64, now - last) : 0; last = now;
    if (swaying()) {
      swayRamp = Math.min(1, swayRamp + dt / SWAY_RAMP_MS);
      const w = 2 * Math.PI / SWAY_PERIOD_MS;
      pose.yaw += SWAY_AMPLITUDE * w * Math.cos(w * swayClock) * dt * swayRamp * swayRamp;
      swayClock += dt * swayRamp;
    } else swayRamp = 0;
    if (replay) {
      replay.elapsed = Math.min(REPLAY_DURATION_MS, replay.elapsed + (reduced.matches ? REPLAY_DURATION_MS : dt));
      if (replay.elapsed >= REPLAY_DURATION_MS) { stopReplay(); }
    }
    renderer.draw(pose); place(); dirty = false;
    if (animating()) schedule(); else last = 0;
  }

  function project(point, offset) { return renderer.point(point, offset); }
  const sizeFor = () => clamp(40 * Math.sqrt(pose.zoom), 34, 92);

  function vesselNode(vessel) {
    let node = nodes.get(vessel.mmsi);
    if (!node) {
      node = Object.assign(document.createElement('button'), { type: 'button', className: 'vessel' });
      node.dataset.mmsi = vessel.mmsi;
      node.addEventListener('click', () => { selected = selected === vessel.mmsi ? null : vessel.mmsi; dirty = true; schedule(); onSelect?.(selected ? vessels.find(v => v.mmsi === selected) || null : null); });
      overlay.append(node); nodes.set(vessel.mmsi, node);
    }
    return node;
  }

  function paintVessel(node, vessel, at, bearing, now) {
    const tanker = isTanker(vessel), length = sizeFor();
    const p = project([at.longitude, at.latitude], .25);
    node.hidden = !p.visible;
    if (!p.visible) return;
    const angle = projectedVesselAngle({ longitude: at.longitude, latitude: at.latitude }, bearing, point => project(point, .25));
    const kind = !tanker ? 'other' : angle === null ? 'tanker-marker' : 'tanker';
    if (node.dataset.kind !== kind) { node.dataset.kind = kind; node.innerHTML = ''; node.dataset.sprite = ''; }
    let transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0)`;
    if (kind === 'tanker') {
      const sprite = sprites?.shipSprite?.({ headingDegrees: bearing, cameraYawDegrees: pose.yaw * 180 / Math.PI, cameraTiltDegrees: (pose.topDown ? 89 : pose.tilt * 180 / Math.PI), lengthPx: length, screenAngleDegrees: angle });
      if (sprite) {
        const key = `${sprite.key || sprite.dataUrl?.length}:${Math.round(length)}`;
        if (node.dataset.sprite !== key) { node.innerHTML = sprite.svg || `<img alt="" draggable="false" src="${sprite.dataUrl}" width="${sprite.width}" height="${sprite.height}">`; node.dataset.sprite = key; }
        const ax = sprite.anchor?.[0] ?? sprite.width / 2, ay = sprite.anchor?.[1] ?? sprite.height / 2;
        transform += ` translate(${-ax}px, ${-ay}px)` + (sprite.rotationDeg ? ` rotate(${sprite.rotationDeg}deg)` : '');
        node.style.transformOrigin = `${ax}px ${ay}px`;
      } else {
        const key = `fallback:${Math.round(length)}`;
        if (node.dataset.sprite !== key) { node.innerHTML = silhouette(length); node.dataset.sprite = key; }
        const w = Math.round(length * .26), h = Math.round(length);
        transform += ` translate(${-w / 2}px, ${-h / 2}px) rotate(${angle.toFixed(1)}deg)`;
        node.style.transformOrigin = `${w / 2}px ${h / 2}px`;
      }
    }
    node.style.transform = transform;
    node.dataset.stale = String(!replay && now - (ms(vessel.positionTime) ?? now) >= POSITION_STALE_MS);
    node.setAttribute('aria-pressed', String(selected === vessel.mmsi));
    const speed = Number.isFinite(vessel.speedKnots) ? `, ${vessel.speedKnots.toFixed(0)} knots` : '';
    const label = `${tanker ? 'Tanker' : 'Vessel'} ${vessel.name || vessel.mmsi}${speed}${bearing === null ? ', heading not reported' : `, heading ${Math.round(bearing)} degrees`}`;
    if (node.getAttribute('aria-label') !== label) node.setAttribute('aria-label', label);
  }

  function place() {
    const now = Date.now();
    for (const { label, node } of labels) {
      const p = project(label.point, label.kind === 'water' ? .05 : .6);
      node.hidden = !p.visible;
      if (p.visible) node.style.transform = `translate3d(${p.x.toFixed(0)}px, ${p.y.toFixed(0)}px, 0) translate(-50%, -50%)`;
    }
    const t = replay ? replay.from + replay.elapsed / REPLAY_DURATION_MS * (replay.to - replay.from) : now;
    const lines = [];
    const seen = new Set();
    for (const vessel of vessels) {
      const tanker = isTanker(vessel);
      if (!replay && !tanker && !showAll) continue;
      const points = tanker ? trackPoints(vessel, now) : [];
      let at, bearing;
      if (replay) {
        if (!tanker || points.length < 2) continue;
        const where = positionAt(points, t); if (!where) continue;
        at = where; bearing = where.bearing;
      } else {
        at = vessel; bearing = Number.isFinite(vessel.headingDegrees) && vessel.headingDegrees < 360 ? vessel.headingDegrees : Number.isFinite(vessel.courseDegrees) && vessel.courseDegrees < 360 ? vessel.courseDegrees : null;
      }
      seen.add(vessel.mmsi);
      paintVessel(vesselNode(vessel), vessel, at, bearing, now);
      if (tanker && points.length > 1) {
        const visible = points.filter(p => p[2] <= t);
        for (let i = 1; i < visible.length; i++) {
          const a = project(visible[i - 1], .2), b = project(visible[i], .2);
          if (!a.visible && !b.visible) continue;
          const age = (t - visible[i][2]) / REPLAY_WINDOW_MS;
          lines.push(`<line class="map-track" x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke-opacity="${(.85 - .7 * clamp(age, 0, 1)).toFixed(2)}"/>`);
        }
        if (replay && visible.length) {
          const a = project(visible.at(-1), .2), b = project([at.longitude, at.latitude], .2);
          lines.push(`<line class="map-track" x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke-opacity=".85"/>`);
        }
      }
    }
    for (const [mmsi, node] of nodes) if (!seen.has(mmsi)) node.hidden = true;
    tracksSvg.innerHTML = lines.join('');
    if (replay) replay.onClock?.(t);
  }

  function interact() { lastInteraction = performance.now(); swayRamp = 0; }
  function animateTo(target) { Object.assign(pose, target); dirty = true; schedule(); }
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 && event.button !== 2) return;
    interact(); canvas.setPointerCapture(event.pointerId);
    drag = { x: event.clientX, y: event.clientY, pan: event.shiftKey || event.button === 2 || pose.topDown || renderer.mode === 'plan', pose: { ...pose } };
    schedule();
  });
  canvas.addEventListener('pointermove', event => {
    if (!drag) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (drag.pan) {
      const scale = (renderer.span || SCENE.extent) / Math.max(1, width), c = Math.cos(pose.yaw), s = Math.sin(pose.yaw);
      pose.panX = clamp(drag.pose.panX - (dx * c + dy * s) * scale, -SCENE.extent / 2, SCENE.extent / 2);
      pose.panZ = clamp(drag.pose.panZ - (-dx * s + dy * c) * scale, -SCENE.extent / 2, SCENE.extent / 2);
    } else {
      pose.yaw = drag.pose.yaw - dx * .006;
      pose.tilt = clamp(drag.pose.tilt + dy * .004, .2, 1.18);
    }
    dirty = true;
  });
  const endDrag = event => { if (!drag) return; drag = null; interact(); if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId); dirty = true; schedule(); };
  canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('contextmenu', event => event.preventDefault());
  canvas.addEventListener('wheel', event => { event.preventDefault(); interact(); pose.zoom = clamp(pose.zoom * Math.exp(-event.deltaY * .0015), .8, 6); dirty = true; schedule(); }, { passive: false });
  canvas.addEventListener('keydown', event => {
    const key = event.key.toLowerCase(), step = event.shiftKey ? 8 : 0;
    if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key)) {
      event.preventDefault(); interact();
      if (step) { const d = (renderer.span || SCENE.extent) / 30; if (key === 'arrowleft') pose.panX -= d; if (key === 'arrowright') pose.panX += d; if (key === 'arrowup') pose.panZ -= d; if (key === 'arrowdown') pose.panZ += d; }
      else { if (key === 'arrowleft') pose.yaw += .08; if (key === 'arrowright') pose.yaw -= .08; if (key === 'arrowup') pose.tilt = clamp(pose.tilt - .06, .2, 1.18); if (key === 'arrowdown') pose.tilt = clamp(pose.tilt + .06, .2, 1.18); }
    } else if (['+', '=', '-'].includes(key)) { event.preventDefault(); api.zoom(key === '-' ? 1 / 1.25 : 1.25); }
    else if (key === 'r') { event.preventDefault(); api.reset(); }
    else if (key === 't') { event.preventDefault(); api.toggleTopDown(); }
    else return;
    dirty = true; schedule();
  });
  new ResizeObserver(resize).observe(root);
  new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; schedule(); }, { threshold: .1 }).observe(root);
  document.addEventListener('visibilitychange', () => { last = 0; schedule(); });
  reduced.addEventListener('change', () => { dirty = true; schedule(); });
  resize();

  function stopReplay() { const done = replay?.onEnd; replay = null; dirty = true; done?.(); schedule(); }

  const api = {
    mode: renderer.mode,
    setVessels(list) {
      vessels = (Array.isArray(list) ? list : []).filter(v => v?.theater === 'hormuz' && isCurrentVesselPosition(v));
      if (selected && !vessels.some(v => v.mmsi === selected)) { selected = null; onSelect?.(null); }
      dirty = true; schedule();
    },
    vessel(mmsi) { return vessels.find(v => v.mmsi === mmsi) || null; },
    select(mmsi) { selected = mmsi; dirty = true; schedule(); },
    setShowAll(value) { showAll = Boolean(value); dirty = true; schedule(); },
    setPaused(value) { paused = Boolean(value); last = 0; schedule(); },
    zoom(factor) { interact(); animateTo({ zoom: clamp(pose.zoom * factor, .8, 6) }); },
    reset() { interact(); lastInteraction = -Infinity; animateTo(heroPose()); },
    toggleTopDown() { interact(); animateTo({ topDown: !pose.topDown }); return pose.topDown; },
    /** Replays received tanker positions from the last hour; returns false if none. */
    replay({ onClock, onEnd } = {}) {
      const now = Date.now(), withTracks = vessels.filter(v => isTanker(v) && trackPoints(v, now).length > 1);
      if (!withTracks.length) return false;
      const from = Math.min(...withTracks.map(v => trackPoints(v, now)[0][2]));
      replay = { from, to: now, elapsed: 0, onClock, onEnd }; dirty = true; schedule();
      return true;
    },
    stopReplay,
    get replaying() { return Boolean(replay); },
    destroy() { destroyed = true; cancelAnimationFrame(frame); renderer.destroy?.(); overlay.remove(); },
  };
  return api;
}

export const vesselLabel = vessel => `${isTanker(vessel) ? 'Tanker' : 'Vessel'} ${vessel.name || vessel.mmsi}`;
export { esc };
