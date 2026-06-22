import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const indexSource = readFileSync('src/app/_components/workbench/index.ts', 'utf-8');

test('workbench foundation | exports core components', () => {
  for (const symbol of [
    'Button',
    'Field',
    'StatusBanner',
    'EmptyState',
    'MetricCard',
    'EvidenceCard',
    'Timeline',
    'WorkbenchSheet',
    'InlineError',
    'Spinner',
    'Surface',
    'Badge',
    'ThemeToggle',
  ]) {
    assert.ok(indexSource.includes(symbol), `Expected ${symbol} to be exported`);
  }
});

test('workbench foundation | button supports product variants and loading', () => {
  const source = readFileSync('src/app/_components/workbench/button.tsx', 'utf-8');
  assert.ok(source.includes('primary'), 'Button should support primary variant');
  assert.ok(source.includes('secondary'), 'Button should support secondary variant');
  assert.ok(source.includes('danger'), 'Button should support danger variant');
  assert.ok(source.includes('loading'), 'Button should support loading state');
  assert.ok(source.includes('aria-busy'), 'Loading button should expose aria-busy');
});

test('workbench foundation | field exposes accessible error semantics', () => {
  const source = readFileSync('src/app/_components/workbench/field.tsx', 'utf-8');
  assert.ok(source.includes('aria-invalid'), 'Field controls should expose aria-invalid');
  assert.ok(source.includes('aria-describedby'), 'Field controls should connect helper/error text');
  assert.ok(source.includes('role="alert"'), 'Field error should be announced');
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
