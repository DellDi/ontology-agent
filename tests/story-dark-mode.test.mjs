import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('dark mode | globals define light and dark token scopes', () => {
  const source = readFileSync('src/app/globals.css', 'utf-8');
  assert.ok(
    source.includes('[data-theme="light"]') || source.includes("[data-theme='light']"),
    'globals.css should define light theme scope',
  );
  assert.ok(
    source.includes('[data-theme="dark"]') || source.includes("[data-theme='dark']"),
    'globals.css should define dark theme scope',
  );
  assert.ok(source.includes('--background'), 'theme scopes should map semantic background token');
  assert.ok(source.includes('--foreground'), 'theme scopes should map semantic foreground token');
});

test('dark mode | root layout installs ThemeProvider safely', () => {
  const source = readFileSync('src/app/layout.tsx', 'utf-8');
  assert.ok(source.includes('ThemeProvider'), 'Root layout should import/use ThemeProvider');
  assert.ok(source.includes('suppressHydrationWarning'), 'Root html should suppress theme hydration warning');
});

test('dark mode | ThemeProvider and ThemeToggle use data-theme semantics', () => {
  const provider = readFileSync('src/app/_components/theme-provider.tsx', 'utf-8');
  const toggle = readFileSync('src/app/_components/workbench/theme-toggle.tsx', 'utf-8');
  assert.ok(provider.includes('attribute="data-theme"'), 'ThemeProvider should write data-theme attribute');
  assert.ok(provider.includes('enableSystem'), 'ThemeProvider should support system theme');
  assert.ok(provider.includes('disableTransitionOnChange'), 'ThemeProvider should avoid transition flicker');
  assert.ok(toggle.includes('useTheme'), 'ThemeToggle should use next-themes');
  assert.ok(toggle.includes('setTheme'), 'ThemeToggle should change theme');
  assert.ok(toggle.includes('mounted'), 'ThemeToggle should guard theme-dependent UI until mounted');
  assert.ok(toggle.includes('useSyncExternalStore'), 'ThemeToggle should use a hydration-safe client mounted guard');
  assert.ok(
    !toggle.includes('suppressHydrationWarning'),
    'ThemeToggle should avoid mismatching SVG subtrees instead of suppressing them',
  );
});
