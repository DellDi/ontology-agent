import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Phase 1c | history panel should not use viewport-based grid for drawer layout', () => {
  const source = readFileSync(
    'src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-history-panel.tsx',
    'utf-8'
  );
  assert.ok(
    !source.includes('xl:grid-cols'),
    'History panel should not use xl:grid-cols (viewport breakpoint in drawer context)'
  );
});

test('Phase 1c | history panel should use stacked layout', () => {
  const source = readFileSync(
    'src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-history-panel.tsx',
    'utf-8'
  );
  assert.ok(
    source.includes('space-y-4') || source.includes('flex-col'),
    'History panel should use stacked layout (space-y or flex-col)'
  );
});
