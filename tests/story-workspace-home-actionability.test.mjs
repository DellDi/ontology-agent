import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('workspace home | action cards do not render fake primary-button spans', () => {
  const source = readFileSync('src/app/(workspace)/_components/workspace-home-shell.tsx', 'utf-8');
  assert.ok(!source.includes('<span className="primary-button"'), 'Ready actions should not be non-clickable primary-button spans');
  assert.ok(source.includes('<Button asChild'), 'Ready actions should use real Button links');
  assert.ok(source.includes('<Badge tone="neutral" aria-disabled="true"'), 'Unavailable actions should render as disabled Badge');
});

test('workspace home | model exposes failed bucket and degraded state', () => {
  const source = readFileSync('src/application/workspace/home.ts', 'utf-8');
  assert.ok(source.includes('failedItems'), 'Home model should expose failedItems');
  assert.ok(source.includes('degradedState'), 'Home model should expose degradedState');
  assert.ok(source.includes("derivedStatus === 'failed'"), 'Home model should derive failed bucket from snapshots');
});

test('workspace home | page does not silently swallow stream fallback failures', () => {
  const source = readFileSync('src/app/(workspace)/workspace/page.tsx', 'utf-8');
  assert.ok(source.includes('console.warn'), 'Workspace page should log fallback failures');
  assert.ok(source.includes('stream-fallback'), 'Workspace page should identify stream fallback failures');
  assert.ok(source.includes('redis-fallback'), 'Workspace page should identify Redis fallback failures');
});
