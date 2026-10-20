import test from 'node:test';
import assert from 'node:assert/strict';
import {assessBackendReadiness} from '../lib/backend-readiness.mjs';
import {backendFixture} from './fixtures/release-backend.mjs';

test('a collector matching this frontend passes and still discloses coverage limits', () => {
  const result = assessBackendReadiness(backendFixture());
  assert.equal(result.ready, true);
  assert.equal(result.coverageEstablished, false);
  assert.ok(result.warnings.some(warning => warning.category === 'coverage'));
});
test('a collector missing a dashboard source fails', () => {
  const input = backendFixture(); input.diagnostics.sources = input.diagnostics.sources.filter(source => source.id !== 'portwatch');
  const result = assessBackendReadiness(input);
  assert.equal(result.ready, false);
  assert.ok(result.failures.some(failure => failure.id === 'diagnostics-inventory' && /portwatch/.test(failure.reasons[0])));
});
test('a previous deployment still reporting retired sources is rejected', () => {
  const input = backendFixture();
  input.diagnostics.sources.push({id: 'gdelt-hormuz', configured: true}, {id: 'marad-advisories', configured: false});
  const result = assessBackendReadiness(input);
  assert.equal(result.compatible, false);
  assert.ok(result.failures.some(failure => /gdelt-hormuz/.test(failure.reasons[0])));
});
test('capability declarations must match the frontend exactly', () => {
  for (const endpoint of ['config', 'news']) {
    const input = backendFixture(); input[endpoint].capabilities.oil = {...input[endpoint].capabilities.oil, sourceIds: ['brent']};
    assert.equal(assessBackendReadiness(input).ready, false, endpoint);
    const missing = backendFixture(); delete missing[endpoint].capabilities;
    assert.equal(assessBackendReadiness(missing).ready, false, endpoint);
  }
});
test('malformed arrays, null rows and duplicate source identities fail without throwing', () => {
  for (const sources of [null, 'x', [null], [{id: ''}], [{id: 'bbc'}, {id: 'bbc'}]]) {
    const input = backendFixture(); input.diagnostics.sources = sources;
    assert.equal(assessBackendReadiness(input).ready, false, JSON.stringify(sources));
  }
  assert.equal(assessBackendReadiness({}).ready, false);
});
test('incident registers must stay explicitly incomplete and new panels need their response shapes', () => {
  const complete = backendFixture(); complete.maritime.coverage.complete = true;
  assert.equal(assessBackendReadiness(complete).ready, false);
  const transits = backendFixture(); transits.transits = {baselines: {}};
  assert.equal(assessBackendReadiness(transits).ready, false);
  const oil = backendFixture(); delete oil.oil.latestCloses;
  assert.equal(assessBackendReadiness(oil).ready, false);
});
