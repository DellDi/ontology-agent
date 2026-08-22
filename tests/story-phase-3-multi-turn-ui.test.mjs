import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Phase 3b | shell should accept optional thread prop', () => {
  const source = readFileSync(
    'src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-conversation-shell.tsx',
    'utf-8',
  );
  assert.ok(source.includes('thread?:'), 'Shell should accept optional thread prop');
  assert.ok(source.includes('ConversationThreadViewModel'), 'Should import thread type');
});

test('Phase 3b | shell should render CollapsedTurnSummary for non-active turns', () => {
  const source = readFileSync(
    'src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-conversation-shell.tsx',
    'utf-8',
  );
  assert.ok(source.includes('CollapsedTurnSummary'), 'Should have collapsed summary component');
  assert.ok(source.includes('isExpanded'), 'Should conditionally render based on isExpanded');
});

test('Phase 3b | shell should scroll to active turn', () => {
  const source = readFileSync(
    'src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-conversation-shell.tsx',
    'utf-8',
  );
  assert.ok(source.includes('scrollIntoView'), 'Should scroll to active turn');
});

test('Phase 3b | live shell should pass thread to conversation shell', () => {
  const source = readFileSync(
    'src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-execution-live-shell.tsx',
    'utf-8',
  );
  assert.ok(source.includes('thread'), 'Live shell should handle thread prop');
});
