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

test('workspace home | page avoids snapshot N+1 and loads independent data in parallel', () => {
  const source = readFileSync('src/app/(workspace)/workspace/page.tsx', 'utf-8');
  assert.ok(
    source.includes('Promise.all') &&
      source.includes('listOwnedSessions') &&
      source.includes('listProjects'),
    'Workspace page should load history sessions and scoped projects in parallel',
  );
  assert.ok(
    source.includes('getLatestSummariesBySessionIds'),
    'Workspace page should batch slim latest snapshot summary reads instead of loading full execution snapshots',
  );
  assert.ok(
    !source.includes('getLatestBySessionId('),
    'Workspace page should not call latest snapshot lookup once per session',
  );
  assert.ok(
    !source.includes('.getLatestBySessionIds('),
    'Workspace page should not load full snapshot JSON for home status cards',
  );
});

test('workspace home | loading route gives immediate feedback while server data loads', () => {
  const source = readFileSync('src/app/(workspace)/workspace/loading.tsx', 'utf-8');
  assert.ok(source.includes('WorkspaceLoading'), 'Workspace loading route should be defined');
  assert.ok(source.includes('aria-busy="true"'), 'Loading route should expose busy state');
  assert.ok(source.includes('Skeleton'), 'Loading route should render skeleton UI');
  assert.ok(source.includes('正在加载你的工作台'), 'Loading route should use user-facing loading copy');
});

test('login | directory login form exposes pending state while navigating to workspace', () => {
  const source = readFileSync('src/app/(auth)/login/_components/directory-login-form.tsx', 'utf-8');
  const page = readFileSync('src/app/(auth)/login/page.tsx', 'utf-8');
  assert.ok(source.includes('useFormStatus'), 'Login form should use form pending state');
  assert.ok(source.includes('loading={pending}'), 'Submit button should show loading while pending');
  assert.ok(source.includes('disabled={pending}'), 'Inputs should be disabled while pending');
  assert.ok(source.includes('正在校验账号并加载你的工作台数据'), 'Pending copy should explain the wait');
  assert.ok(page.includes('DirectoryLoginForm'), 'Login page should use the client pending form');
});
