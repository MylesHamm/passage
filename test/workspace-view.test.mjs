import test from 'node:test';
import assert from 'node:assert/strict';
import { WORKSPACES, workspaceFor, adjacentWorkspace } from '../dist/workspace-view.mjs';

test('saved and impact filters retain the reporting workspace', () => {
  assert.equal(workspaceFor('saved'), 'reporting');
  assert.equal(workspaceFor('civilian'), 'reporting');
  assert.equal(workspaceFor('energy'), 'energy');
  assert.equal(workspaceFor('unknown'), 'overview');
});
test('workspace keyboard navigation wraps and supports Home and End', () => {
  assert.equal(adjacentWorkspace('overview', 'ArrowLeft'), 'evidence');
  assert.equal(adjacentWorkspace('evidence', 'ArrowRight'), 'overview');
  assert.equal(adjacentWorkspace('saved', 'ArrowRight'), 'energy');
  assert.equal(adjacentWorkspace('energy', 'Home'), WORKSPACES[0]);
  assert.equal(adjacentWorkspace('overview', 'End'), WORKSPACES.at(-1));
  assert.equal(adjacentWorkspace('overview', 'Enter'), null);
});
