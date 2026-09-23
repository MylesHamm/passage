import test from 'node:test';
import assert from 'node:assert/strict';
import { collectorHealth, collectorCard, COLLECTOR_DELAY_MS } from '../dist/collector-status.mjs';
import { reportingCoverageText } from '../dist/reporting-view.mjs';
const now = Date.parse('2026-09-23T12:00:00Z');
const stamp = age => new Date(now - age).toISOString();
const healthy = { active: true, intervalSeconds: 300, lastCompletedAt: stamp(60000), lastAttemptAt: stamp(120000), nextAttemptAt: stamp(-180000) };

test('collector freshness follows last completion, independently of a fresh response or source snapshot', () => {
  const current = collectorHealth(healthy, now);
  assert.equal(current.status, 'completed'); assert.equal(current.attention, false);
  const stopped = collectorHealth({ ...healthy, lastCompletedAt: stamp(COLLECTOR_DELAY_MS), generatedAt: stamp(0), retrievedAt: stamp(0), active: true }, now);
  assert.equal(stopped.status, 'delayed'); assert.equal(stopped.attention, true);
  assert.match(stopped.summary, /10 minutes/);
  assert.match(stopped.summary, /original source timestamps/);
  assert.equal(collectorHealth(healthy, now + COLLECTOR_DELAY_MS).status, 'delayed');
});
test('missing, invalid or materially future completion cannot verify background collection', () => {
  for (const lastCompletedAt of [null, 'invalid', stamp(-120000)]) {
    const result = collectorHealth({ ...healthy, lastCompletedAt, generatedAt: stamp(0), nextAttemptAt: stamp(-300000) }, now);
    assert.equal(result.status, 'unverified'); assert.equal(result.attention, true); assert.equal(result.lastCompletedAt, null);
  }
  assert.equal(collectorHealth(undefined, now).status, 'unverified');
});
test('failed, paused and unsaved cycles stay visible despite a recent completed check', () => {
  assert.equal(collectorHealth({ ...healthy, active: false }, now).status, 'paused');
  assert.equal(collectorHealth({ ...healthy, error: 'Collection did not finish' }, now).status, 'failed');
  const unsaved = collectorHealth({ ...healthy, persistenceError: 'Checkpoint could not be saved' }, now);
  assert.equal(unsaved.status, 'unsaved'); assert.equal(unsaved.attention, true);
  assert.match(unsaved.summary, /recovery.*not assured/);
  const running = collectorHealth({ ...healthy, collecting: true }, now);
  assert.equal(running.status, 'collecting'); assert.match(running.summary, /does not mean every provider succeeded/);
});
test('source details retain both failures and exact schedule clocks with escaped accessible markup', () => {
  const html = collectorCard({ ...healthy, error: '<failed>', persistenceError: '<unsaved>' }, now);
  for (const value of [healthy.lastCompletedAt, healthy.lastAttemptAt, healthy.nextAttemptAt]) assert.ok(html.includes(`datetime="${value}"`));
  assert.match(html, /aria-labelledby="collector-heading"/);
  assert.match(html, /Collection issue: &lt;failed&gt;/); assert.match(html, /Storage issue: &lt;unsaved&gt;/);
  assert.match(html, /Schedule times are plans/); assert.doesNotMatch(html, /<failed>|<unsaved>/);
});
test('hosted reporting coverage exposes collector delay without changing local coverage text', () => {
  const coverage = { collection: { ...healthy, lastCompletedAt: stamp(COLLECTOR_DELAY_MS), generatedAt: stamp(0) } };
  assert.doesNotMatch(reportingCoverageText(coverage, { now }), /Background|completed cycle/);
  assert.match(reportingCoverageText(coverage, { hosted: true, now }), /Background check delayed/);
  assert.match(reportingCoverageText(coverage, { hosted: true, now }), /23 Sept 2026|23 Sep 2026/);
  assert.match(reportingCoverageText({}, { hosted: true, now }), /unverified/);
});
