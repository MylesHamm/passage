// Shared 3D terrain view: renderer, camera, interaction, labels and a calm camera
// sway. Layers draw through onPlace each frame; nothing here knows about vessels
// or events.
import { geographicPoint, cameraMatrix, clamp } from '../terrain/geometry.mjs';
import { nearestSea } from '../terrain/sea.mjs';
import { createWebGLRenderer, createPlanRenderer, loadSceneAssets } from '../terrain/renderer.mjs';

// A slow look around the scene: pausable, off under reduced motion, and paused
// for a while after any direct interaction.
export const SWAY_AMPLITUDE = .3;
const SWAY_PERIOD_MS = 80_000, SWAY_RESUME_MS = 20_000, SWAY_RAMP_MS = 1200;
export const FLY_DURATION_MS = 1100;

/** Camera pose between two poses; zoom moves in log space so a push feels even. */
export function poseBetween(from, to, t) {
  const k = clamp(t, 0, 1), e = k * k * (3 - 2 * k);
  const zoom = from.zoom > 0 && to.zoom > 0 ? Math.exp(Math.log(from.zoom) + (Math.log(to.zoom) - Math.log(from.zoom)) * e) : to.zoom;
  return { ...to, zoom, panX: from.panX + (to.panX - from.panX) * e, panZ: from.panZ + (to.panZ - from.panZ) * e, yaw: from.yaw + (to.yaw - from.yaw) * e, tilt: from.tilt + (to.tilt - from.tilt) * e };
}

export async function createTerrainView(root, { scene, labels = [], pose: initialPose, minZoom = .8, swayAmplitude = SWAY_AMPLITUDE, onPlace, onTick, isAnimating = () => false } = {}) {
  let canvas = root.querySelector('canvas');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const overlay = Object.assign(document.createElement('div'), { className: 'map-overlay' });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'map-tracks'); svg.setAttribute('aria-hidden', 'true');
  overlay.append(svg); root.append(overlay);
  const labelNodes = labels.map(label => {
    const node = Object.assign(document.createElement('span'), { className: 'map-label', textContent: label.name });
    node.dataset.kind = label.kind; node.setAttribute('aria-hidden', 'true'); overlay.append(node);
    return { label, node };
  });

  let renderer, pose = { ...initialPose }, width = 1, height = 1, frame = 0, dirty = true, destroyed = false;
  let paused = false, inView = true, lastInteraction = -Infinity, drag = null, swayClock = 0, swayRamp = 0, last = 0, flight = null;
  try { renderer = createWebGLRenderer(canvas); }
  catch { canvas.replaceWith(canvas = Object.assign(document.createElement('canvas'), { className: canvas.className })); renderer = createPlanRenderer(canvas); }
  const assets = await loadSceneAssets(scene, { planOnly: renderer.mode === 'plan' });
  renderer.setScene(scene, assets);
  // How far a ship marker may move to reach water: at least three grid samples, so the coarse regional grid can reach its coast.
  const sampleNm = 40075.016686 * Math.cos(scene.center[1] * Math.PI / 180) * scene.tileSpan / 2 ** scene.zoom / 255 / 1.852;
  const seaReachNm = Math.max(15, sampleNm * 3);

  function resize() {
    const box = root.getBoundingClientRect();
    width = Math.max(1, Math.round(box.width)); height = Math.max(1, Math.round(box.height));
    renderer.resize(width, height); svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    invalidate();
  }
  const visible = () => inView && !document.hidden && root.getClientRects().length > 0;
  const swaying = () => !reduced.matches && !paused && visible() && !drag && !flight && renderer.mode === 'webgl' && !pose.topDown && performance.now() - lastInteraction > SWAY_RESUME_MS;
  const animating = () => visible() && (dirty || drag || flight || swaying() || isAnimating());
  function schedule() { if (!frame && !destroyed && animating()) frame = requestAnimationFrame(tick); }
  function invalidate() { dirty = true; schedule(); }
  const project = (point, offset) => renderer.point(point, offset);

  function tick(now) {
    frame = 0;
    const dt = last ? Math.min(64, now - last) : 0; last = now;
    if (flight) {
      flight.elapsed += reduced.matches ? FLY_DURATION_MS : dt;
      pose = poseBetween(flight.from, flight.to, flight.elapsed / FLY_DURATION_MS);
      if (flight.elapsed >= FLY_DURATION_MS) { pose = { ...flight.to }; flight = null; }
    } else if (swaying()) {
      swayRamp = Math.min(1, swayRamp + dt / SWAY_RAMP_MS);
      const w = 2 * Math.PI / SWAY_PERIOD_MS;
      pose.yaw += swayAmplitude * w * Math.cos(w * swayClock) * dt * swayRamp * swayRamp;
      swayClock += dt * swayRamp;
    } else swayRamp = 0;
    onTick?.(dt, reduced.matches);
    renderer.draw(pose);
    for (const { label, node } of labelNodes) {
      const p = project(label.point, label.kind === 'water' ? .05 : .6);
      node.hidden = !p.visible;
      if (p.visible) node.style.transform = `translate3d(${p.x.toFixed(0)}px, ${p.y.toFixed(0)}px, 0) translate(-50%, -50%)`;
    }
    const eye = renderer.mode === 'webgl' && !pose.topDown ? cameraMatrix(pose, scene, width, height).eye : null;
    onPlace?.({ project, pose, eye, width, height, renderer, scene, overlay, svg });
    dirty = false;
    if (animating()) schedule(); else last = 0;
  }

  function interact() { lastInteraction = performance.now(); swayRamp = 0; flight = null; }
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
      const scale = (renderer.span || scene.extent) / Math.max(1, width), c = Math.cos(pose.yaw), s = Math.sin(pose.yaw);
      pose.panX = clamp(drag.pose.panX - (dx * c + dy * s) * scale, -scene.extent / 2, scene.extent / 2);
      pose.panZ = clamp(drag.pose.panZ - (-dx * s + dy * c) * scale, -scene.extent / 2, scene.extent / 2);
    } else {
      pose.yaw = drag.pose.yaw - dx * .006;
      pose.tilt = clamp(drag.pose.tilt + dy * .004, .2, 1.18);
    }
    invalidate();
  });
  const endDrag = event => { if (!drag) return; drag = null; interact(); if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId); invalidate(); };
  canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('contextmenu', event => event.preventDefault());
  canvas.addEventListener('wheel', event => { event.preventDefault(); interact(); pose.zoom = clamp(pose.zoom * Math.exp(-event.deltaY * .0015), minZoom, 8); invalidate(); }, { passive: false });
  canvas.addEventListener('keydown', event => {
    const key = event.key.toLowerCase();
    if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key)) {
      event.preventDefault(); interact();
      if (event.shiftKey) { const d = (renderer.span || scene.extent) / 30; if (key === 'arrowleft') pose.panX -= d; if (key === 'arrowright') pose.panX += d; if (key === 'arrowup') pose.panZ -= d; if (key === 'arrowdown') pose.panZ += d; }
      else { if (key === 'arrowleft') pose.yaw += .08; if (key === 'arrowright') pose.yaw -= .08; if (key === 'arrowup') pose.tilt = clamp(pose.tilt - .06, .2, 1.18); if (key === 'arrowdown') pose.tilt = clamp(pose.tilt + .06, .2, 1.18); }
      invalidate();
    } else if (['+', '=', '-'].includes(key)) { event.preventDefault(); api.zoom(key === '-' ? 1 / 1.25 : 1.25); }
    else if (key === 'r') { event.preventDefault(); api.reset(); }
    else if (key === 't') { event.preventDefault(); api.toggleTopDown(); }
  });
  new ResizeObserver(resize).observe(root);
  new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; last = 0; schedule(); }, { threshold: .05 }).observe(root);
  document.addEventListener('visibilitychange', () => { last = 0; schedule(); });
  reduced.addEventListener('change', invalidate);
  resize();

  const api = {
    mode: renderer.mode,
    get pose() { return pose; },
    project, invalidate, schedule,
    /** The nearest water on this map's terrain, or the point itself when no elevation grid is loaded. */
    seaPoint(point) { return assets?.heights?.length ? nearestSea(point, scene, assets.heights, { maxNm: seaReachNm, clearanceKm: 4 })?.point || point : point; },
    zoom(factor) { interact(); pose.zoom = clamp(pose.zoom * factor, minZoom, 8); invalidate(); },
    reset() { interact(); lastInteraction = -Infinity; pose = { ...initialPose }; invalidate(); },
    /** True once the reader has moved the camera since the last reset. */
    get interacted() { return lastInteraction !== -Infinity; },
    /** Replaces the view that reset returns to, and moves there unless told not to. */
    home(next, { move = true } = {}) { initialPose = { ...next }; if (move) { flight = null; pose = { ...initialPose }; } invalidate(); },
    toggleTopDown() { interact(); pose.topDown = !pose.topDown; invalidate(); return pose.topDown; },
    setPaused(value) { paused = Boolean(value); last = 0; schedule(); },
    /** Glides the camera to a place; zoom is relative to the scene's full extent. */
    flyTo([longitude, latitude], { zoom = pose.zoom } = {}) {
      const [x, , z] = geographicPoint([longitude, latitude], scene);
      lastInteraction = performance.now();
      flight = { from: { ...pose }, to: { ...pose, panX: clamp(x, -scene.extent / 2, scene.extent / 2), panZ: clamp(z, -scene.extent / 2, scene.extent / 2), zoom: clamp(zoom, minZoom, 8), topDown: false }, elapsed: 0 };
      invalidate();
    },
    destroy() { destroyed = true; cancelAnimationFrame(frame); renderer.destroy?.(); overlay.remove(); },
  };
  return api;
}
