export const THEATRES = {
  both: { name: 'Both theatres', rotation: [-45, -16, 0], zoom: 1 },
  bab: { name: 'Bab el-Mandeb', point: [43.33, 12.58], rotation: [-43.33, -12.58, 0], zoom: 3.4 },
  hormuz: { name: 'Strait of Hormuz', point: [56.25, 26.57], rotation: [-56.25, -26.57, 0], zoom: 3.4 }
};
// Geographic context only. Neither line direction nor animation measures traffic.
// These offshore waypoints keep reference corridors in water instead of
// drawing a single great-circle chord across Egypt, Arabia, or the Horn. The
// first points sit offshore because a city or terminal coordinate can be land.
export const ROUTES = [
  { name: 'Suez / Bab el-Mandeb', coordinates: [[32.6,29.2],[32.8,28.8],[33,28.3],[33.2,28],[33.6,27.5],[34,26.8],[35,25],[37,23.5],[39,20.5],[41,17],[43.33,12.58],[46,12],[52,13],[60,11],[68,10],[73,9]] },
  { name: 'Strait of Hormuz / Indian Ocean', coordinates: [[49.5,27.5],[51,27],[52.5,26.7],[54,26.4],[56.25,26.57],[57,26],[58,24],[59.5,24],[61,20],[65,14],[69,11],[73,9]] },
  { name: 'Cape of Good Hope', coordinates: [[-8,34],[-18,25],[-18,5],[-5,-15],[15,-35],[28,-42],[40,-36],[52,-24],[73,9]] }
];
export const LANDMARKS = [
  ['Suez',32.55,29.97],['Jeddah',39.17,21.48],['Aden',45.03,12.78],
  ['Djibouti',43.14,11.60],['Salalah',54.01,16.95],['Fujairah',56.36,25.13],
  ['Bandar Abbas',56.28,27.18]
];
export function visiblePoint([lon, lat], rotation) {
  const r = Math.PI / 180, a = (lon + rotation[0]) * r, b = lat * r, c = -rotation[1] * r;
  return Math.sin(b) * Math.sin(c) + Math.cos(b) * Math.cos(c) * Math.cos(a) > 0.015;
}
export function shortestAngle(from, to) { return from + (((to - from) % 360 + 540) % 360) - 180; }
// Zoom is interpolated in log space: equal time covers an equal perceived change in
// scale, so a focus push neither crawls at first nor lurches at the end.
const zoomBetween = (from, to, k) => k <= 0 ? from : k >= 1 ? to : from > 0 && to > 0 ? Math.exp(Math.log(from) + (Math.log(to) - Math.log(from)) * k) : from + (to - from) * k;
export function poseBetween(from, to, t) {
  const p = Math.max(0, Math.min(1, t)), k = p * p * (3 - 2 * p);
  return { rotation: [from.rotation[0] + (shortestAngle(from.rotation[0],to.rotation[0])-from.rotation[0])*k,
    from.rotation[1]+(to.rotation[1]-from.rotation[1])*k,0], zoom: zoomBetween(from.zoom, to.zoom, k) };
}
// Overview rotation: 4°/s (one turn every 90 s) is visible at a glance and calm enough
// to read beside. After exploring, rotation eases back in over 0.8 s instead of
// jumping to full speed; exploring itself still stops it at once.
export const SPIN_DEGREES_PER_SECOND = 4;
export const SPIN_RAMP_MS = 800;
export function spinStep(longitude, elapsed, warmth = 1) {
  const ms = Number.isFinite(elapsed) ? Math.max(0, Math.min(50, elapsed)) : 0;
  const before = Number.isFinite(warmth) ? Math.max(0, Math.min(1, warmth)) : 1;
  const after = Math.min(1, before + ms / SPIN_RAMP_MS);
  // Distance is the integral of a smoothstep speed ramp, so the start has no jolt.
  const travelled = r => r * r * r - r * r * r * r / 2;
  const degrees = after < 1 || before < 1
    ? SPIN_DEGREES_PER_SECOND * SPIN_RAMP_MS / 1000 * (travelled(after) - travelled(before)) + SPIN_DEGREES_PER_SECOND * Math.max(0, ms - (after - before) * SPIN_RAMP_MS) / 1000
    : SPIN_DEGREES_PER_SECOND * ms / 1000;
  return { longitude: ((longitude + degrees + 180) % 360 + 360) % 360 - 180, warmth: after };
}
export function eligibleVessels(vessels, theatre, now = Date.now()) {
  return vessels.filter(v => Number.isFinite(v.latitude) && Number.isFinite(v.longitude)
    && Math.abs(v.latitude)<=90 && Math.abs(v.longitude)<=180
    && Number.isFinite(Date.parse(v.positionTime)) && now-Date.parse(v.positionTime)>=0
    && now-Date.parse(v.positionTime)<1800000 && (theatre==='both'||v.theater===theatre));
}
