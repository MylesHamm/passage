// Shared motion rules. Animation explains a change, then settles: every sequence is
// finite, CSS holds the resting state (WAAPI fills never persist) and reduced motion,
// a hidden page or a missing animation API lands on that state at once.
// Timing follows the reviewed motion references recorded in the local motion notes.
export const MOTION = Object.freeze({
  press: 90,
  hoverIn: 80,
  hoverOut: 160,
  short: 200,
  exit: 140,
  medium: 280,
  long: 450,
  stagger: 30,
  maxStagger: 120,
  distance: 8,
  ease: Object.freeze({
    standard: 'cubic-bezier(.2, 0, 0, 1)',
    enter: 'cubic-bezier(.16, 1, .3, 1)',
    exit: 'cubic-bezier(.3, 0, 1, 1)',
    move: 'cubic-bezier(.65, 0, .35, 1)',
  }),
  settle: Object.freeze({ visualDuration: .3, duration: 400, samples: 16 }),
});

/** Critically damped spring (no overshoot), sampled for CSS linear(). */
export function settleCurve({ visualDuration = MOTION.settle.visualDuration, duration = MOTION.settle.duration, samples = MOTION.settle.samples } = {}) {
  const omega = 2 * Math.PI / (1.2 * visualDuration), seconds = duration / 1000;
  return Array.from({ length: samples + 1 }, (_, i) => {
    if (i === samples) return 1;
    const t = seconds * i / samples;
    return Math.round((1 - (1 + omega * t) * Math.exp(-omega * t)) * 1000) / 1000;
  });
}
export const settleEasing = options => `linear(${settleCurve(options).join(', ')})`;

/** Delay for item `index` of `count`; the whole group always starts within `max` ms. */
export function staggerDelay(index, count, { each = MOTION.stagger, max = MOTION.maxStagger } = {}) {
  if (!Number.isInteger(index) || index < 1 || !Number.isInteger(count) || count < 2) return 0;
  return Math.round(Math.min(each, max / (count - 1)) * Math.min(index, count - 1));
}

export function motionAllowed(scope = globalThis) {
  if (typeof scope.matchMedia !== 'function') return false;
  if (scope.document?.hidden) return false;
  return !scope.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const canAnimate = (element, scope) => typeof element?.animate === 'function' && motionAllowed(scope);
const finite = options => ({ iterations: 1, ...options });

/**
 * Opacity plus a short travel; never opacity alone. `fill: backwards` holds the first
 * frame through a stagger delay, then the element returns to its CSS state.
 */
export function enter(element, { x = 0, y = MOTION.distance, duration = MOTION.short, delay = 0, easing = MOTION.ease.enter, scope = globalThis } = {}) {
  if (!canAnimate(element, scope)) return null;
  for (const running of element.getAnimations?.() || []) if (running.id === 'passage-enter') running.cancel();
  const animation = element.animate([
    { opacity: 0, translate: `${x}px ${y}px` },
    { opacity: 1, translate: '0 0' },
  ], finite({ duration, delay, easing, fill: 'backwards' }));
  animation.id = 'passage-enter';
  return animation;
}

/** Reading-order entrance for a small group; later items are already resting. */
export function enterSequence(elements, { limit = 4, ...options } = {}) {
  const items = [...elements].filter(Boolean), moving = items.slice(0, limit);
  return moving.map((element, index) => enter(element, { ...options, delay: (options.delay || 0) + staggerDelay(index, moving.length) })).filter(Boolean);
}

/**
 * A tab indicator that stretches: the leading edge reaches the new tab first and the
 * trailing edge follows, so the bar shows both where it came from and where it went.
 */
export function indicatorFrames(from, to) {
  const ok = box => box && [box.left, box.width].every(Number.isFinite) && box.width > 0;
  if (!ok(from) || !ok(to)) return null;
  const right = box => box.left + box.width, forward = to.left >= from.left;
  const lag = (a, b) => a + (b - a) * .35;
  const middle = forward
    ? { left: lag(from.left, to.left), right: right(to) }
    : { left: to.left, right: lag(right(from), right(to)) };
  const frame = (left, width, offset) => ({ transform: `translateX(${left.toFixed(1)}px) scaleX(${Math.max(1, width).toFixed(1)})`, opacity: 1, offset });
  return [
    frame(from.left, from.width, 0),
    frame(middle.left, middle.right - middle.left, .6),
    frame(to.left, to.width, 1),
  ];
}

const latestIndicator = new WeakMap();
export function moveIndicator(indicator, from, to, { duration = MOTION.medium, easing = MOTION.ease.standard, onDone, scope = globalThis } = {}) {
  const frames = indicatorFrames(from, to);
  if (!frames || !canAnimate(indicator, scope)) { latestIndicator.delete(indicator); onDone?.(); return null; }
  const animation = indicator.animate(frames, finite({ duration, easing }));
  latestIndicator.set(indicator, animation);
  for (const running of indicator.getAnimations?.() || []) if (running !== animation) running.cancel();
  // Only the newest move may restore the resting border; an interrupted move's late
  // cancel event must not. The timer guarantees the resting state even without events.
  const done = () => { if (latestIndicator.get(indicator) === animation) onDone?.(); };
  animation.addEventListener('finish', done);
  animation.addEventListener('cancel', done);
  scope.setTimeout?.(done, duration + 120);
  return animation;
}

/** Current rendered box of a moving indicator, so an interruption continues from it. */
export function indicatorBox(indicator, scope = globalThis) {
  if (!indicator?.getAnimations?.().length || typeof scope.getComputedStyle !== 'function') return null;
  const match = /matrix\(([^)]+)\)/.exec(scope.getComputedStyle(indicator).transform || '');
  if (!match) return null;
  const [a, , , , e] = match[1].split(',').map(Number);
  return Number.isFinite(a) && Number.isFinite(e) ? { left: e, width: a } : null;
}

/**
 * Disclosures animate only when a person opened them. Initial `open` attributes,
 * restored state and programmatic refreshes stay still.
 */
export function bindDisclosures(root = globalThis.document, { window = 600, scope = globalThis } = {}) {
  if (!root?.addEventListener) return () => {};
  let intent = -Infinity;
  const now = () => scope.performance?.now?.() ?? Date.now();
  const mark = () => { intent = now(); };
  const toggle = event => {
    const details = event.target;
    if (details?.tagName !== 'DETAILS' || !details.open || now() - intent > window) return;
    enterSequence([...details.children].filter(child => child.tagName !== 'SUMMARY'), { y: 6, limit: 3, scope });
  };
  root.addEventListener('pointerdown', mark, true);
  root.addEventListener('keydown', mark, true);
  root.addEventListener('toggle', toggle, true);
  return () => {
    root.removeEventListener('pointerdown', mark, true);
    root.removeEventListener('keydown', mark, true);
    root.removeEventListener('toggle', toggle, true);
  };
}
