import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/app/_components/workbench/workbench-sheet.tsx', 'utf-8');

test('workbench sheet | has dialog semantics', () => {
  assert.ok(source.includes('role="dialog"'), 'Sheet should render dialog role');
  assert.ok(source.includes('aria-modal="true"'), 'Sheet should mark itself modal');
  assert.ok(source.includes('aria-labelledby'), 'Sheet should connect visible title to dialog');
});

test('workbench sheet | traps keyboard focus and supports escape close', () => {
  assert.ok(source.includes("event.key === 'Escape'"), 'Sheet should close on Escape');
  assert.ok(source.includes("event.key !== 'Tab'"), 'Sheet should handle Tab navigation');
  assert.ok(source.includes('preventDefault'), 'Sheet should prevent focus from leaving boundaries');
  assert.ok(source.includes('FOCUSABLE_SELECTOR'), 'Sheet should enumerate focusable elements');
});

test('workbench sheet | restores focus and locks body scroll', () => {
  assert.ok(source.includes('returnFocusTo'), 'Sheet should accept returnFocusTo');
  assert.ok(source.includes('previousActiveRef'), 'Sheet should remember previous active element');
  assert.ok(source.includes("document.body.style.overflow = 'hidden'"), 'Sheet should lock body scroll while open');
});
