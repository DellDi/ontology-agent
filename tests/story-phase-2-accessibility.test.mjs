import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Phase 2c | drawer should have role="dialog"', () => {
  const source = readFileSync(
    'src/app/_components/workbench/workbench-sheet.tsx',
    'utf-8',
  );
  assert.ok(source.includes('role="dialog"'), 'Drawer should have role="dialog"');
});

test('Phase 2c | drawer should have aria-modal="true"', () => {
  const source = readFileSync(
    'src/app/_components/workbench/workbench-sheet.tsx',
    'utf-8',
  );
  assert.ok(source.includes('aria-modal="true"'), 'Drawer should have aria-modal="true"');
});

test('Phase 2c | drawer should have aria-label', () => {
  const source = readFileSync(
    'src/app/_components/workbench/workbench-sheet.tsx',
    'utf-8',
  );
  assert.ok(
    source.includes('aria-labelledby') || source.includes('aria-label'),
    'Drawer should have an accessible label',
  );
});

test('Phase 2c | drawer should implement focus trap (Tab key handling)', () => {
  const source = readFileSync(
    'src/app/_components/workbench/workbench-sheet.tsx',
    'utf-8',
  );
  assert.ok(source.includes("event.key !== 'Tab'"), 'Should handle Tab key for focus trap');
  assert.ok(source.includes('preventDefault'), 'Should prevent default Tab behavior at boundaries');
});

test('Phase 2c | drawer should use useRef for focus management', () => {
  const source = readFileSync(
    'src/app/_components/workbench/workbench-sheet.tsx',
    'utf-8',
  );
  assert.ok(source.includes('useRef'), 'Should use useRef for drawer element');
});

test('Phase 2c | PendingRefreshGate should render loading indicator when enabled', () => {
  const source = readFileSync(
    'src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-pending-refresh-gate.tsx',
    'utf-8',
  );
  assert.ok(!source.match(/return null;\s*\n}/), 'Should not return null unconditionally');
  assert.ok(source.includes('role="status"'), 'Should have role="status" for screen readers');
  assert.ok(source.includes('aria-live="polite"'), 'Should have aria-live for dynamic content');
  assert.ok(source.includes('正在加载'), 'Should show loading text in Chinese');
});

test('Phase 2c | PendingRefreshGate should show exhausted UI when maxAttempts reached', () => {
  const source = readFileSync(
    'src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-pending-refresh-gate.tsx',
    'utf-8',
  );
  assert.ok(source.includes('exhausted'), 'Should track exhausted state');
  assert.ok(source.includes('setExhausted(true)'), 'Should set exhausted when maxAttempts reached');
  assert.ok(source.includes('分析仍在后台处理中'), 'Should show exhausted message in Chinese');
  assert.ok(source.includes('手动刷新'), 'Should offer manual refresh button');
  assert.ok(
    source.includes('onClick={() => router.refresh()}'),
    'Manual refresh button should call router.refresh()',
  );
});
