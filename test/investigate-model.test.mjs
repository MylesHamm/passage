import test from 'node:test';
import assert from 'node:assert/strict';
import { evidenceDate, evidenceOrder, filterEvidence, resolveFocus } from '../dist/investigate-model.mjs';
import { selectNeighborhood } from '../dist/graph-view.mjs';

const now = Date.parse('2026-09-21T18:30:00Z');
const ids = nodes => nodes.map(node => node.id);
const report = (id, label, publishedDate = '2026-09-20') => ({ id, label, type: 'report', record: { publishedDate } });
const entity = (id, label, type = 'actor') => ({ id, label, type });
const edge = (from, to) => ({ id: `${from}:${to}`, from, to });
function regionalGraph() {
  return {
    nodes: [
      entity('saudi', 'Saudi Arabia'), entity('iran', 'Iran'), entity('houthis', 'Houthis'),
      entity('supply', 'Supply disruption', 'channel'),
      report('saudi-report', 'Saudi export update'), report('iran-report', 'Iran diplomacy update'),
      report('shared-report', 'Regional shipping update'),
    ],
    edges: [
      edge('saudi-report', 'saudi'), edge('saudi-report', 'supply'),
      edge('iran-report', 'iran'), edge('iran-report', 'supply'),
      edge('shared-report', 'iran'), edge('shared-report', 'houthis'),
    ],
  };
}

test('an active report search leaves other actors and their network connections available', () => {
  const graph = regionalGraph();
  const result = filterEvidence(graph, { query: 'SAUDI', type: 'report', now });

  assert.deepEqual(ids(result.items), ['saudi-report']);
  assert.deepEqual(result.network, filterEvidence(graph, { now }).network);
  const iranView = selectNeighborhood(result.network, 'iran');
  assert.deepEqual(new Set(ids(iranView.nodes)), new Set(['iran', 'iran-report', 'shared-report', 'houthis', 'supply']));
  assert.equal(iranView.edges.length, 4);
});

test('an actor library filter does not truncate a report inspector or its other actor connection', () => {
  const result = filterEvidence(regionalGraph(), { query: 'Iran', type: 'actor', now });

  assert.deepEqual(ids(result.items), ['iran']);
  const reportView = selectNeighborhood(result.network, 'shared-report');
  assert.deepEqual(new Set(ids(reportView.nodes)), new Set(['shared-report', 'iran', 'houthis']));
  assert.equal(reportView.edges.length, 2);
});

test('export scope still contains only matching library records and their direct context', () => {
  const graph = regionalGraph(), original = structuredClone(graph);
  const result = filterEvidence(graph, { query: 'Saudi', type: 'report', now });

  assert.deepEqual(new Set(ids(result.graph.nodes)), new Set(['saudi-report', 'saudi', 'supply']));
  assert.deepEqual(result.graph.edges, [edge('saudi-report', 'saudi'), edge('saudi-report', 'supply')]);
  assert.ok(!result.graph.nodes.some(node => node.id === 'iran-report'), 'shared context must not recursively expand an export');
  assert.deepEqual(graph, original, 'filtering must not change the source evidence');
  const noMatches = filterEvidence(graph, { query: 'not present', now });
  assert.deepEqual(noMatches.items, []);
  assert.deepEqual(noMatches.graph, { nodes: [], edges: [] });
  assert.equal(noMatches.network.nodes.length, graph.nodes.length);
});

test('the date window applies to reports and events in both views while retaining unknown dates', () => {
  const graph = {
    nodes: [
      entity('iran', 'Iran'),
      report('boundary', 'Start of the selected window', '2026-09-15'),
      report('old', 'Before the selected window', '2026-09-14'),
      { id: 'discovery', label: 'Undated report', type: 'report', record: { discoveredAt: '2026-08-01T10:00:00Z' } },
      { id: 'event', label: 'Recent event', type: 'event', eventDate: '2026-09-16' },
      { id: 'old-event', label: 'Older event', type: 'event', eventDate: '2026-09-14', record: { publishedAt: '2026-09-21T10:00:00Z' } },
      { id: 'unknown-event', label: 'Undated event', type: 'event' },
      { id: 'market', label: 'Brent context', type: 'market', record: { observationDate: '2026-09-14' } },
    ],
    edges: ['boundary', 'old', 'discovery', 'event', 'old-event', 'unknown-event', 'market', 'missing'].map(id => edge(id, 'iran')),
  };
  const result = filterEvidence(graph, { days: '7', now });

  assert.deepEqual(new Set(ids(result.network.nodes)), new Set(['iran', 'boundary', 'discovery', 'event', 'unknown-event', 'market']));
  assert.deepEqual(result.graph, result.network);
  assert.equal(result.unknown, 2);
  assert.equal(result.network.edges.length, 5);
  assert.ok(result.network.edges.every(link => result.network.nodes.some(node => node.id === link.from) && result.network.nodes.some(node => node.id === link.to)));
  assert.equal(filterEvidence(graph, { days: 'all', now }).network.nodes.length, graph.nodes.length);
});

test('evidence dates preserve publication precision and never substitute discovery for publication', () => {
  assert.equal(evidenceDate({ type: 'report', record: { publishedAt: '2026-09-20T00:00:00Z', publicationPrecision: 'day' } }), '2026-09-20');
  assert.equal(evidenceDate({ type: 'report', record: { discoveredAt: '2026-09-21T10:00:00Z', addedAt: '2026-09-21T11:00:00Z' } }), null);
  assert.equal(evidenceDate({ type: 'event', eventDate: '2026-09-17', record: { publishedAt: '2026-09-19T10:00:00Z' } }), '2026-09-17');
  assert.equal(evidenceDate({ type: 'market', record: { observationDate: '2026-09-15' } }), '2026-09-15');

  const nodes = [entity('actor', 'Actor'), report('old', 'Old', '2026-09-18'), report('new', 'New', '2026-09-20')];
  assert.deepEqual(ids(nodes.sort(evidenceOrder)), ['new', 'old', 'actor']);
});

test('removing an older report with the date filter returns to the remembered actor', () => {
  const graph = { nodes: [entity('actor:saudi-arabia', 'Saudi Arabia'), entity('actor:houthis', 'Houthis'), report('old-report', 'Older report', '2026-09-01')], edges: [edge('old-report', 'actor:houthis')] };
  const broad = filterEvidence(graph, { days: '30', now }).network;
  const narrow = filterEvidence(graph, { days: '7', now }).network;
  assert.equal(resolveFocus(broad, 'old-report', 'actor:houthis'), 'old-report');
  assert.equal(resolveFocus(narrow, 'old-report', 'actor:houthis'), 'actor:houthis');
  assert.equal(resolveFocus(narrow, null, null), 'actor:saudi-arabia');
  assert.equal(resolveFocus({ nodes: [], edges: [] }, 'old-report', 'actor:houthis'), null);
});
