import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { MOTION, settleCurve, settleEasing, staggerDelay, motionAllowed, enter, enterSequence, indicatorFrames, moveIndicator, bindDisclosures } from '../dist/motion.mjs';
import { chartRevealReason, revealChart } from '../dist/oil-chart-view.mjs';

const css = await readFile(new URL('../dist/motion.css', import.meta.url), 'utf8');
const scope = ({ reduce = false, hidden = false } = {}) => ({ matchMedia: () => ({ matches: reduce }), document: { hidden } });

class Animated extends EventTarget {
  constructor(tagName = 'DIV', children = []) { super(); this.tagName = tagName; this.children = children; this.calls = []; this.running = []; }
  animate(keyframes, options) {
    const animation = Object.assign(new EventTarget(), { keyframes, options, cancelled: false, cancel() { this.cancelled = true; } });
    this.calls.push(animation); this.running.push(animation);
    return animation;
  }
  getAnimations() { return this.running.filter(animation => !animation.cancelled); }
}

test('the settle curve is a critically damped spring: it starts at rest, never overshoots and lands exactly', () => {
  const curve = settleCurve();
  assert.equal(curve[0], 0);
  assert.equal(curve.at(-1), 1);
  for (let i = 1; i < curve.length; i++) assert.ok(curve[i] >= curve[i - 1] && curve[i] <= 1, `sample ${i} must be monotonic without overshoot`);
  assert.ok(curve.at(-2) > .98, 'the final step must be visually imperceptible');
});

test('motion.css carries the same spring and timing tokens as motion.mjs', () => {
  assert.ok(css.includes(`--ease-settle: ${settleEasing()};`));
  const tokens = { press: 'press', 'hover-in': 'hoverIn', 'hover-out': 'hoverOut', short: 'short', exit: 'exit', medium: 'medium', long: 'long' };
  for (const [name, key] of Object.entries(tokens)) assert.ok(css.includes(`--motion-${name}: ${MOTION[key]}ms;`), `--motion-${name}`);
  for (const [name, key] of Object.entries({ standard: 'standard', enter: 'enter', exit: 'exit', move: 'move' })) assert.ok(css.includes(`--ease-${name}: ${MOTION.ease[key]};`), `--ease-${name}`);
  assert.ok(MOTION.exit < MOTION.short, 'exits leave faster than entrances arrive');
  assert.ok(MOTION.hoverIn < MOTION.hoverOut, 'hover answers quickly and releases slowly');
});

test('reduced motion zeroes every duration token and removes travel and press scaling', () => {
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  const declared = [...css.slice(0, css.indexOf('}')).matchAll(/--motion-([a-z-]+):/g)].map(m => m[1]);
  assert.ok(declared.length >= 7);
  for (const name of declared) assert.ok(reduced.includes(`--motion-${name}: 0ms`), `--motion-${name} must be 0ms under reduced motion`);
  assert.match(reduced, /\.toast \{ translate: none; \}/);
  assert.match(reduced, /scale: none/);
  assert.match(reduced, /\.workspace-tab-indicator \{ display: none; \}/);
});

test('nothing in the dashboard ends moving: no CSS or script animation repeats', async () => {
  const dist = new URL('../dist/', import.meta.url);
  const files = (await readdir(dist, { recursive: true })).filter(name => /\.(css|mjs|js)$/.test(name) && !name.startsWith('vendor'));
  for (const name of files) {
    const source = await readFile(new URL(name, dist), 'utf8');
    assert.doesNotMatch(source, /animation[^;{}]*\binfinite\b|iteration-count:\s*infinite|iterations:\s*Infinity/, `${name} must not loop an animation`);
  }
});

test('staggers stay in reading order and the whole group starts within the cap', () => {
  assert.equal(staggerDelay(0, 4), 0);
  assert.equal(staggerDelay(1, 4), MOTION.stagger);
  assert.equal(staggerDelay(3, 4), 3 * MOTION.stagger);
  assert.ok(staggerDelay(19, 20) <= MOTION.maxStagger, 'large groups compress rather than lengthen');
  assert.ok(staggerDelay(10, 20) < staggerDelay(19, 20));
  for (const bad of [-1, 1.5, NaN]) assert.equal(staggerDelay(bad, 4), 0);
});

test('motion is withheld without a browser, under reduced motion and while the page is hidden', () => {
  assert.equal(motionAllowed({}), false);
  assert.equal(motionAllowed(scope({ reduce: true })), false);
  assert.equal(motionAllowed(scope({ hidden: true })), false);
  assert.equal(motionAllowed(scope()), true);
  const element = new Animated();
  assert.equal(enter(element, { scope: scope({ reduce: true }) }), null);
  assert.equal(element.calls.length, 0, 'reduced motion lands on the CSS resting state without animating');
  assert.equal(enter({}, { scope: scope() }), null, 'elements without the Web Animations API are left as they are');
});

test('entrances pair opacity with travel, run once and leave no persistent fill', () => {
  const element = new Animated();
  const first = enter(element, { scope: scope() });
  assert.deepEqual(first.keyframes.flatMap(Object.keys).sort(), ['opacity', 'opacity', 'translate', 'translate']);
  assert.equal(first.options.iterations, 1);
  assert.equal(first.options.fill, 'backwards');
  assert.equal(first.keyframes[0].translate, `0px ${MOTION.distance}px`);
  enter(element, { scope: scope() });
  assert.equal(first.cancelled, true, 'a newer entrance interrupts the older one instead of stacking');
});

test('sequences animate only the first few items, in order, within the stagger cap', () => {
  const items = Array.from({ length: 6 }, () => new Animated());
  const animations = enterSequence(items, { scope: scope(), limit: 4 });
  assert.equal(animations.length, 4);
  assert.deepEqual(animations.map(animation => animation.options.delay), [0, 30, 60, 90]);
  assert.equal(items[5].calls.length, 0, 'later items are already resting');
});

test('the tab indicator stretches: the leading edge arrives before the trailing edge', () => {
  const parse = frame => { const [, x, w] = /translateX\(([-\d.]+)px\) scaleX\(([-\d.]+)\)/.exec(frame.transform).map(Number); return { left: x, right: x + w }; };
  const from = { left: 0, width: 140 }, to = { left: 300, width: 160 };
  const forward = indicatorFrames(from, to).map(parse);
  assert.deepEqual(forward[0], { left: 0, right: 140 });
  assert.equal(forward[1].right, 460, 'moving right, the right edge reaches the new tab first');
  assert.ok(forward[1].left > 0 && forward[1].left < 300, 'the trailing edge is still travelling');
  assert.deepEqual(forward[2], { left: 300, right: 460 });
  const back = indicatorFrames(to, from).map(parse);
  assert.equal(back[1].left, 0, 'moving left, the left edge reaches the new tab first');
  assert.ok(back[1].right < 460 && back[1].right > 140);
  assert.equal(indicatorFrames(null, to), null);
  assert.equal(indicatorFrames({ left: 0, width: 0 }, to), null);
});

test('an interrupted tab move cannot restore the resting border while the newer move is travelling', () => {
  const indicator = new Animated('SPAN'), timers = [], calls = [];
  const local = { ...scope(), setTimeout: fn => timers.push(fn) };
  const a = moveIndicator(indicator, { left: 0, width: 100 }, { left: 200, width: 100 }, { scope: local, onDone: () => calls.push('a') });
  const b = moveIndicator(indicator, { left: 120, width: 100 }, { left: 400, width: 100 }, { scope: local, onDone: () => calls.push('b') });
  assert.equal(a.cancelled, true);
  a.dispatchEvent(new Event('cancel'));
  timers[0]();
  assert.deepEqual(calls, [], 'the superseded move stays silent');
  b.dispatchEvent(new Event('finish'));
  assert.deepEqual(calls, ['b']);
  timers[1]();
  assert.deepEqual(calls, ['b', 'b'], 'the fallback timer repeats the idempotent resting step');
  const still = [];
  assert.equal(moveIndicator(indicator, { left: 0, width: 1 }, { left: 9, width: 1 }, { scope: scope({ reduce: true }), onDone: () => still.push(1) }), null);
  assert.deepEqual(still, [1], 'reduced motion goes straight to the resting border');
});

test('the oil chart replays only for its first visible appearance or a new history window', () => {
  const data = period => ({ hasData: true, period });
  assert.equal(chartRevealReason(null, data(90), { visible: false }), null, 'nothing animates offscreen');
  assert.equal(chartRevealReason(null, { hasData: false, period: 90 }, { visible: true }), null);
  assert.equal(chartRevealReason(null, data(90), { visible: true }), 'intro');
  assert.equal(chartRevealReason(data(90), data(90), { visible: true, revealed: true }), null, 'a refresh keeps the reading position still');
  assert.equal(chartRevealReason(data(90), data(30), { visible: true, revealed: true }), 'period');
});

test('the chart draws axes, then each series in date order, then endpoint labels once lines arrive', () => {
  const grid = new Animated('G'), brent = new Animated('G'), wti = new Animated('G'), endpoints = new Animated('G'), focus = new Animated('G');
  const svg = Object.assign(new Animated('SVG'), {
    querySelector: selector => ({ '[data-chart-grid]': grid, '[data-chart-endpoints]': endpoints, '[data-chart-focus]': focus })[selector] ?? null,
    querySelectorAll: selector => selector === '[data-chart-series]' ? [brent, wti] : [],
  });
  const intro = revealChart(svg, 'intro', { scope: scope() });
  assert.equal(intro.length, 5);
  assert.equal(grid.calls.length, 1);
  const [brentDraw] = brent.calls, [wtiDraw] = wti.calls, [labels] = endpoints.calls;
  assert.equal(brentDraw.keyframes[0].clipPath, 'inset(0 100% 0 0)');
  assert.ok(wtiDraw.options.delay > brentDraw.options.delay);
  assert.equal(labels.options.delay, wtiDraw.options.delay + MOTION.long, 'labels wait for the last line to land');
  assert.equal(focus.calls[0].options.delay, labels.options.delay, 'the date readout appears with the values it reads');
  for (const animation of intro) assert.equal(animation.options.iterations, 1);

  revealChart(svg, 'period', { scope: scope() });
  assert.equal(grid.calls.length, 1, 'a new window keeps the axes frozen and redraws only the data');
  assert.deepEqual(revealChart(svg, 'period', { scope: scope({ reduce: true }) }), []);
});

test('disclosures animate only when a person opened them', () => {
  let clock = 0;
  const root = new EventTarget();
  const summary = new Animated('SUMMARY'), body = new Animated('DIV');
  const details = Object.assign(new Animated('DETAILS', [summary, body]), { open: true });
  const toggle = () => { const event = new Event('toggle'); Object.defineProperty(event, 'target', { value: details }); root.dispatchEvent(event); };
  const stop = bindDisclosures(root, { scope: { ...scope(), performance: { now: () => clock } } });
  toggle();
  assert.equal(body.calls.length, 0, 'an initially open or restored disclosure stays still');
  root.dispatchEvent(new Event('pointerdown'));
  clock = 100; toggle();
  assert.equal(body.calls.length, 1);
  assert.equal(summary.calls.length, 0, 'the summary a person pressed does not move');
  clock = 2000; toggle();
  assert.equal(body.calls.length, 1, 'a later programmatic toggle stays still');
  stop();
});
