import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import javaMobileViewModel from '../src/infrastructure/java-backend/mobile-view-model.ts';

const { buildJavaMobileAnalysisView } = javaMobileViewModel;

async function fixture(name) {
  return JSON.parse(await readFile(new URL(`../contracts/backend/fixtures/${name}`, import.meta.url), 'utf8'));
}

test('mobile view model projects the selected Java round without a TypeScript business fallback', async () => {
  const aggregate = await fixture('analysis-session-completed.json');
  const view = buildJavaMobileAnalysisView(aggregate);

  assert.equal(view.executionId, 'execution-1');
  assert.equal(view.status, 'completed');
  assert.equal(view.statusLabel, '已完成');
  assert.match(view.summary, /80%/);
  assert.equal(view.evidence.length, 3);
  assert.equal(view.history.length, 1);
  assert.equal(view.canCreateFollowUp, true);
});

test('mobile view model never enables a child follow-up from a failed active round', async () => {
  const aggregate = await fixture('analysis-session-completed.json');
  const failedSnapshot = await fixture('snapshot-failed.json');
  aggregate.runtime.status = 'failed';
  aggregate.runtime.resolvedExecutionId = failedSnapshot.executionId;
  aggregate.snapshot = failedSnapshot;
  aggregate.history[0].executionId = failedSnapshot.executionId;
  aggregate.history[0].status = 'failed';
  aggregate.history[0].conclusionState = failedSnapshot.conclusionState;
  const view = buildJavaMobileAnalysisView(aggregate);

  assert.equal(view.status, 'failed');
  assert.equal(view.summary, null);
  assert.equal(view.canCreateFollowUp, false);
});
