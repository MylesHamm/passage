import test from 'node:test';
import assert from 'node:assert/strict';
import { createOilSystemView } from '../dist/oil-system-view.mjs';

// Exercise the real view's public actions and event handlers without browser or
// data-service dependencies. Only the DOM methods used by this view are faked.
function harness(t) {
  const nodes = new Map();
  const document = Object.assign(new EventTarget(), { hidden: false, activeElement: null });
  class Node extends EventTarget {
    constructor(selector = '') { super(); this.selector = selector; }
    dataset = {};
    style = {};
    attributes = new Map();
    classes = new Set();
    classList = { toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name) };
    text = '';
    textWrites = 0;
    innerHTML = '';
    get textContent() { return this.text; }
    set textContent(value) { this.text = value; this.textWrites++; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    closest(selectors) { return selectors.split(',').map(value => value.trim()).includes(this.selector) ? this : null; }
    querySelector(selector) { return selector === 'small' ? this.small : nodes.get(selector) ?? null; }
    querySelectorAll(selector) { return selector === '[data-system-select]' ? controls : []; }
    focus() { document.activeElement = this; }
    scrollIntoView() { this.scrolled = true; }
  }
  for (const selector of [
    '.system-toggle', '.system-context', '[data-context-scope]', '[data-context-title]', '[data-context-note]',
    '[data-system-clear]', '#system-part-title', '[data-system-explanation]', '.system-prices',
    '[data-price-note]', '.system-status', '#oil-system-heading',
  ]) nodes.set(selector, new Node(selector));
  const controls = ['supply', 'transport', 'risk', 'benchmarks'].map(id => {
    nodes.set(`[data-system-part="${id}"]`, new Node('[data-system-part]'));
    const button = new Node('[data-system-select]');
    button.dataset.systemSelect = id;
    button.small = new Node();
    return button;
  });
  const previous = ['document', 'IntersectionObserver'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  Object.defineProperty(globalThis, 'IntersectionObserver', { configurable: true, value: class { observe() {} disconnect() {} } });
  const root = new Node();
  const view = createOilSystemView(root, { motionPreference: Object.assign(new EventTarget(), { matches: false }) });
  t.after(() => {
    view.destroy();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  function event(type, target, values = {}) {
    const event = new Event(type, { cancelable: true });
    Object.defineProperty(event, 'target', { value: target });
    Object.assign(event, values);
    root.dispatchEvent(event);
    return event;
  }
  return { view, root, document, controls, q: selector => nodes.get(selector), click: target => event('click', target), key: (target, key) => event('keydown', target, { key }) };
}

function assertSelection(h, id, title, expanded = false) {
  assert.equal(h.q('#system-part-title').textContent, title);
  assert.deepEqual(h.controls.filter(button => button.getAttribute('aria-pressed') === 'true').map(button => button.dataset.systemSelect), [id]);
  assert.equal(h.q(`[data-system-part="${id}"]`).classes.has('is-selected'), true);
  assert.equal(h.q('.system-status').textContent, `${title}. ${expanded ? 'Layers separated.' : 'Assembled view.'}`);
}

test('opening a report synchronizes the selected channel and live announcement', t => {
  const h = harness(t);
  h.click(h.controls[2]);
  assertSelection(h, 'risk', 'Security & insurance');

  h.view.open({ title: 'Tankers reroute through the Red Sea', source: 'Test reporting', publishedAt: '2026-10-11T12:00:00Z' });

  assertSelection(h, 'transport', 'Passage & freight');
  assert.equal(h.q('[data-context-title]').textContent, 'Tankers reroute through the Red Sea');
  assert.equal(h.document.activeElement, h.q('#oil-system-heading'));
  assert.equal(h.root.scrolled, true);
});

test('source refreshes retain selection and report without repeating the live announcement', t => {
  const h = harness(t);
  h.view.open({ title: 'Tankers reroute through the Red Sea' });
  const status = h.q('.system-status'), writes = status.textWrites;
  const title = h.q('[data-context-title]').textContent;

  h.view.update({ theater: 'hormuz', oil: { series: [] }, oilFailed: false });
  h.view.update({ oilFailed: true });

  assertSelection(h, 'transport', 'Passage & freight');
  assert.equal(h.q('[data-context-title]').textContent, title);
  assert.equal(status.textWrites, writes, 'unchanged selection must not mutate the live region during refresh');
});

test('keyboard selection and layer changes keep one status without repeating unchanged selections', t => {
  const h = harness(t);
  assert.equal(h.key(h.controls[1], 'ArrowRight').defaultPrevented, true);
  assertSelection(h, 'risk', 'Security & insurance');
  assert.equal(h.document.activeElement, h.controls[2]);
  h.click(h.q('.system-toggle'));
  assertSelection(h, 'risk', 'Security & insurance', true);
  const status = h.q('.system-status'), writes = status.textWrites;

  h.click(h.controls[2]);

  assert.equal(status.textWrites, writes, 'selecting the current channel must not repeat an announcement');
  h.view.open({ title: 'Delegates meet for talks' });
  assertSelection(h, 'supply', 'Export availability', true);
  h.click(h.q('[data-system-clear]'));
  assertSelection(h, 'supply', 'Export availability', true);
  assert.equal(h.document.activeElement, h.controls[0]);
  assert.equal(h.q('[data-system-clear]').hidden, true);
});
