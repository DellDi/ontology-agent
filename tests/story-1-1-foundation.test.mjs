import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();

const requiredPaths = [
  'package.json',
  'tsconfig.json',
  'next.config.ts',
  'src/app/layout.tsx',
  'src/app/page.tsx',
  'src/app/globals.css',
  'src/app/api',
  'src/app/(auth)',
  'src/app/(workspace)',
  'src/app/(admin)',
  'src/domain',
  'src/application',
  'src/infrastructure',
  'src/shared',
];

for (const relativePath of requiredPaths) {
  test(`基础骨架包含 ${relativePath}`, async () => {
    await access(path.join(repoRoot, relativePath));
  });
}

test('package.json 提供 Next.js 基础脚本', async () => {
  const packageJson = JSON.parse(
    await readFile(path.join(repoRoot, 'package.json'), 'utf8'),
  );

  assert.equal(packageJson.scripts.dev, 'next dev');
  assert.equal(packageJson.scripts.build, 'next build');
  assert.equal(packageJson.scripts.start, 'next start');
  assert.ok(
    packageJson.scripts.lint,
    '需要存在 lint 脚本用于故事基础验证',
  );
  assert.equal(packageJson.scripts['lint:fix'], 'eslint . --fix');
});

test('全局样式预留 DIP3 亮色品牌 token', async () => {
  const globals = await readFile(
    path.join(repoRoot, 'src/app/globals.css'),
    'utf8',
  );

  assert.match(globals, /--brand-700/i);
  assert.match(globals, /--mist-0/i);
  assert.match(globals, /--radius-/i);
});
