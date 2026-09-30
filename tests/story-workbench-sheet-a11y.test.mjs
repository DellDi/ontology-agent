import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/app/_components/workbench-sheet.tsx', 'utf-8');
const sheetSource = readFileSync('src/components/ui/sheet.tsx', 'utf-8');

test('workbench sheet | delegates dialog semantics to shadcn Sheet (Radix Dialog)', () => {
  assert.ok(source.includes('@/components/ui/sheet'), 'Sheet wrapper should consume shadcn sheet');
  assert.ok(source.includes('SheetContent'), 'Sheet wrapper should render SheetContent');
  assert.ok(
    sheetSource.includes('@radix-ui/react-dialog') || sheetSource.includes('radix-ui'),
    'ui/sheet should be built on Radix Dialog (focus trap, escape, scroll lock built-in)',
  );
});

test('workbench sheet | connects title and description semantics', () => {
  assert.ok(source.includes('SheetTitle'), 'Sheet should render SheetTitle for accessible name');
  assert.ok(
    source.includes('SheetDescription'),
    'Sheet should render SheetDescription for accessible description',
  );
});

test('workbench sheet | exposes close affordance and side variants', () => {
  assert.ok(source.includes('onOpenChange'), 'Sheet should translate Radix onOpenChange to onClose');
  assert.ok(source.includes('toolbar'), 'Sheet should keep the toolbar slot');
  assert.ok(
    source.includes("side === 'right'") && source.includes("side === 'bottom'"),
    'Sheet should keep right/bottom side variants',
  );
});
