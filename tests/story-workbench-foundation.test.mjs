import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, globSync } from 'node:fs';

test('workbench foundation | legacy workbench primitives are fully removed', () => {
  assert.ok(
    !existsSync('src/app/_components/workbench'),
    'src/app/_components/workbench should be removed after shadcn convergence',
  );

  const sources = globSync('src/**/*.{ts,tsx}');
  const offenders = sources.filter((file) =>
    readFileSync(file, 'utf-8').includes('@/app/_components/workbench/'),
  );
  assert.deepEqual(offenders, [], 'no imports may reference the removed workbench primitives');
});

test('workbench foundation | shadcn primitives cover migrated controls', () => {
  for (const primitive of [
    'button',
    'badge',
    'sheet',
    'spinner',
    'skeleton',
    'label',
    'input',
    'textarea',
    'dialog',
    'dropdown-menu',
    'collapsible',
    'scroll-area',
    'tooltip',
  ]) {
    assert.ok(
      existsSync(`src/components/ui/${primitive}.tsx`),
      `Expected shadcn primitive src/components/ui/${primitive}.tsx`,
    );
  }
});

test('workbench foundation | semantic composites live under app _components', () => {
  for (const composite of [
    'empty-state',
    'evidence-card',
    'inline-error',
    'status-banner',
    'timeline',
    'theme-toggle',
    'workbench-sheet',
  ]) {
    assert.ok(
      existsSync(`src/app/_components/${composite}.tsx`),
      `Expected semantic composite src/app/_components/${composite}.tsx`,
    );
  }
});

test('workbench foundation | ai-elements conversation components are vendored', () => {
  for (const component of [
    'conversation',
    'message',
    'prompt-input',
    'tool',
    'suggestion',
    'loader',
    'code-block',
  ]) {
    assert.ok(
      existsSync(`src/components/ai-elements/${component}.tsx`),
      `Expected ai-elements component src/components/ai-elements/${component}.tsx`,
    );
  }
});

test('workbench foundation | ai package stays out of runtime dependencies', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));
  assert.equal(
    pkg.dependencies.ai,
    undefined,
    'ai must remain a devDependency (type-only usage in ai-elements)',
  );
});

test('workbench foundation | legacy global classes are removed from globals.css', () => {
  const source = readFileSync('src/app/globals.css', 'utf-8');
  for (const legacyClass of [
    '.primary-button',
    '.secondary-button',
    '.field-input',
    '.field-label',
    '.glass-panel',
    '.hero-panel',
    '.status-banner',
    '.tab-bar',
    '.data-table',
    '.status-progress-bar',
    '.form-group',
    '.action-bar',
  ]) {
    assert.ok(!source.includes(legacyClass), `${legacyClass} should not remain in globals.css`);
  }
});
