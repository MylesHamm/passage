import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {reportingEmptyState} from '../dist/reporting-view.mjs';
import { preserveViewFocus } from '../dist/view-focus.mjs';

const investigate = readFileSync(new URL('../dist/investigate.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
const functionSource = (source, start, end) => source.slice(source.indexOf(`function ${start}(`), source.indexOf(`function ${end}(`));

// A small DOM stand-in models the browser behavior relevant to these regressions:
// replacing or hiding the focused element moves activeElement back to the body.
function harness() {
  const document = { activeElement: null }, nodes = new Map();
  class Node {
    constructor(tagName = 'DIV', attributes = {}) {
      this.tagName = tagName; this.attributes = attributes; this.id = attributes.id || '';
      this.className = attributes.class || ''; this.dataset = {};
      for (const [key, value] of Object.entries(attributes)) if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
      this.children = []; this.ownerDocument = document; this.scrollTop = 0;
      this.classList = { add() {}, remove() {} };
    }
    contains(node) { return node === this || this.children.includes(node); }
    get innerHTML() { return this.html || ''; }
    set innerHTML(html) {
      if (this.children.includes(document.activeElement)) document.activeElement = document.body;
      this.html = html; this.children = [...html.matchAll(/<(a|button)\b([^>]*)>/g)].map(([, tag, attrs]) => {
        const attributes = Object.fromEntries([...attrs.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, name, value]) => [name, value]));
        return new Node(tag.toUpperCase(), attributes);
      });
    }
    get hidden() { return this.isHidden; }
    set hidden(value) { this.isHidden = value; if (value && document.activeElement === this) document.activeElement = document.body; }
    getClientRects() { return this.hidden ? [] : [{}]; }
    hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    querySelectorAll(selector) {
      return this.children.filter(node => /^\[data-[\w-]+\]$/.test(selector) ? node.hasAttribute(selector.slice(1, -1)) : selector === '[id]' ? node.id : selector === 'a[href]' ? node.tagName === 'A' && node.hasAttribute('href') : false);
    }
    focus(options) { document.activeElement = this; this.focusOptions = options; }
    showModal() { this.open = true; }
    close() { this.open = false; }
  }
  document.body = new Node('BODY'); document.activeElement = document.body;
  const $ = selector => {
    if (!nodes.has(selector)) nodes.set(selector, new Node('DIV', { id: selector.startsWith('#') ? selector.slice(1) : '' }));
    return nodes.get(selector);
  };
  document.getElementById = id => [...nodes.values(), ...[...nodes.values()].flatMap(node => node.children)].find(node => node.id === id);
  const $$ = selector => [...nodes.values()].flatMap(node => node.querySelectorAll(selector));
  const context = vm.createContext({ document, $, $$, preserveViewFocus, inspectorReturn: null, inspectorMode: null, selectedMmsi: null, markSelection() {} });
  return { document, $, context };
}

test('Investigate refresh preserves the focused source-link role when a URL is repeated', () => {
  const h = harness(), body = h.$('#inspector-body');
  vm.runInContext(functionSource(investigate, 'setMarkup', 'filteredEvidence'), h.context);
  const links = '<a class="source-link" href="https://example.com/report">Read original source</a><a class="relation-source" href="https://example.com/report">Relationship source</a>';
  h.context.setMarkup(body, links + '<p>Retrieved at 12:00</p>');
  body.children[1].focus(); body.scrollTop = 180;

  h.context.setMarkup(body, links + '<p>Retrieved at 12:01</p>');

  assert.equal(h.document.activeElement, body.children[1]);
  assert.equal(h.document.activeElement.className, 'relation-source');
  assert.equal(body.scrollTop, 180);
  assert.deepEqual(h.document.activeElement.focusOptions, { preventScroll: true });
});

test('Investigate refresh falls back to the source heading when the focused link disappears', () => {
  const h = harness(), body = h.$('#inspector-body');
  vm.runInContext(functionSource(investigate, 'setMarkup', 'filteredEvidence'), h.context);
  h.context.setMarkup(body, '<a class="source-link" href="https://example.com/old">Read original source</a>');
  body.children[0].focus();

  h.context.setMarkup(body, '<a class="source-link" href="https://example.com/new">Updated source</a>');

  assert.equal(h.document.activeElement, h.$('#inspector-heading'));
});

test('Investigate Back to actor focuses the actor selector after hiding the originating button', () => {
  const h = harness();
  Object.assign(h.context, {
    state: { graph: { nodes: [{ id: 'actor:saudi', type: 'actor' }] }, actor: 'actor:saudi', selected: 'report:one' },
    location: { href: 'https://example.com/investigate.html' }, URL,
    history: { replaceState() {} }, matchMedia: () => ({ matches: false }),
    render() { h.$('#return-to-actor').hidden = true; },
  });
  vm.runInContext(functionSource(investigate, 'selectNode', 'fact'), h.context);
  h.$('#return-to-actor').focus();

  h.context.selectNode('actor:saudi');

  assert.equal(h.context.state.selected, 'actor:saudi');
  assert.equal(h.$('#return-to-actor').hidden, true);
  assert.equal(h.document.activeElement, h.$('#actor-select'));
});

test('vessel inspector refresh retains the source anchor and uses its heading if the source disappears', () => {
  const h = harness(), body = h.$('#inspector-content');
  vm.runInContext(functionSource(app, 'openInspector', 'closeInspector'), h.context);
  const source = '<a class="primary-link" href="https://aisstream.io/">Source: AISStream</a>';
  body.innerHTML = source + '<p>Position received at 12:00</p>';
  body.children[0].focus(); body.scrollTop = 140;

  h.context.openInspector('AIS POSITION', source + '<p>Position received at 12:01</p>', { refresh: true });

  assert.equal(h.document.activeElement, body.children[0]);
  assert.equal(body.scrollTop, 140);
  h.context.openInspector('AIS POSITION', '<p>Source unavailable</p>', { refresh: true });
  assert.equal(h.document.activeElement, h.$('#inspector-kicker'));
});

test('focus restoration preserves node actions and leaves controls outside the replaced view alone', () => {
  const h = harness(), body = h.$('#inspector-body');
  body.innerHTML = '<button data-select-node="report:one">Report</button>';
  body.children[0].focus();
  let restore = preserveViewFocus(body, h.$('#inspector-heading'));
  body.innerHTML = '<button data-select-node="report:one">Updated report label</button>';
  restore();
  assert.equal(h.document.activeElement, body.children[0]);

  const outside = h.$('#entity-search'); outside.focus();
  restore = preserveViewFocus(body, h.$('#inspector-heading'));
  body.innerHTML = '<p>No selection</p>'; restore();
  assert.equal(h.document.activeElement, outside);
});

test('removing the last saved report moves bookmark focus to the visible feed heading', () => {
  const h = harness(), feed = h.$('#feed'), report = { id: 'report:one', title: 'A saved report' };
  const state = { view: 'saved', saved: { [report.id]: report } };
  Object.assign(h.context, {
    state, runtime: {}, reportingCoverageText: () => '', reportingEmptyState, esc: String, renderActors() {},
    reports: () => Object.values(state.saved), groupReporting: rows => rows.map(row => ({ reports: [row] })),
    coverage: () => ({ unknown: false }), allSourceStates: () => [], resetFilters() {},
    renderScope() {}, selectedContext: null, renderMetrics() {}, renderTheaters() {},
    renderCivilianSummary() {}, renderAcledSummary() {}, renderArrivals() {}, monitoring: null, priority: null,
    storyById: () => report, storage: { set: () => true }, toast() {},
  });
  vm.runInContext(functionSource(app, 'renderReports', 'renderArrivals') + functionSource(app, 'toggleSave', 'showStory'), h.context);
  feed.innerHTML = '<button data-save="report:one">Unsave report</button>';
  feed.children[0].focus();

  h.context.toggleSave(report.id);

  assert.equal(Object.hasOwn(state.saved, report.id), false);
  assert.match(feed.innerHTML, /No saved reports match this view/);
  assert.equal(h.document.activeElement, h.$('#feed-heading'));
});

test('failed saved-report storage keeps session changes and does not overwrite the failure notice', () => {
  const report = { id: 'report:one', title: 'A report' }, messages = [], state = { saved: {} };
  const context = vm.createContext({
    state, storyById: () => report, renderReports() {}, toast: message => messages.push(message),
    localStorage: { setItem() { throw new Error('Storage quota exceeded'); } },
  });
  const storageSource = app.slice(app.indexOf('const storage='), app.indexOf('const state='));
  vm.runInContext(storageSource + functionSource(app, 'toggleSave', 'showStory'), context);

  context.toggleSave(report.id);

  assert.equal(state.saved[report.id], report, 'saving still works for this session');
  assert.deepEqual(messages, ['Browser storage is unavailable. Changes will last for this session.']);
  context.toggleSave(report.id);
  assert.equal(Object.hasOwn(state.saved, report.id), false, 'removal still works for this session');
  assert.equal(messages.length, 2);
  assert.equal(messages[1], messages[0]);
});
