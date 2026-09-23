import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIntelligence, mergeManualEvidence } from '../dist/intelligence-data.mjs';

const now = Date.parse('2026-09-23T12:00:00Z');
test('public evidence contains no private static reporting or invented review date', () => {
  const empty = buildIntelligence({ includeReviewedContext: false, now });
  assert.deepEqual(empty.nodes, []);
  assert.deepEqual(empty.edges, []);
  assert.equal(empty.review, null);
  const news = { items: [{ url: 'https://example.com/report', title: 'Saudi exports through Yanbu', source: 'Public publisher', publishedAt: '2026-09-23T10:00:00Z' }] };
  const graph = buildIntelligence({ news, includeReviewedContext: false, now });
  assert.equal(graph.stats.reports, 1);
  assert.ok(graph.nodes.some(node => node.type === 'actor'));
  assert.ok(graph.nodes.some(node => node.type === 'asset'));
  assert.ok(graph.nodes.every(node => !node.record?.readAt && !node.record?.reviewedContext));
  assert.equal(graph.review, null);
});
test('local reviewed context stays available while browser-saved records preserve service provenance', () => {
  const local = buildIntelligence({ now });
  assert.ok(local.nodes.some(node => node.record?.sourceId === 'reviewed-reporting'));
  assert.ok(local.review.date);
  assert.deepEqual(mergeManualEvidence(local, [], now).review, local.review);
  const publicGraph = buildIntelligence({ includeReviewedContext: false, now });
  const result = mergeManualEvidence(publicGraph, [{ url: 'https://example.com/own-source', title: 'Iran oil exports', publisher: 'Saved publisher', note: 'A browser-saved note' }], now);
  assert.equal(result.stats.reports, 1);
  assert.equal(result.review, null);
  assert.equal(result.nodes.find(node => node.type === 'report').record.manual, true);
  assert.deepEqual(publicGraph.nodes, []);
});
