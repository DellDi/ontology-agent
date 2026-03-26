import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();

async function readRepoFile(relativePath) {
  return readFile(path.join(repoRoot, relativePath), 'utf8');
}

const requiredPaths = [
  'compose.yaml',
  '.env.example',
  'Dockerfile.dev',
  'docs/local-infrastructure.md',
];

for (const relativePath of requiredPaths) {
  test(`Story 2.1 工件存在：${relativePath}`, async () => {
    await access(path.join(repoRoot, relativePath));
  });
}

test('compose.yaml 定义 web、postgres、redis 与基础健康检查', async () => {
  const compose = await readRepoFile('compose.yaml');

  assert.match(compose, /^name:\s*ontology-agent$/m);
  assert.match(compose, /^services:\s*$/m);
  assert.match(compose, /^\s{2}web:\s*$/m);
  assert.match(compose, /^\s{2}postgres:\s*$/m);
  assert.match(compose, /^\s{2}redis:\s*$/m);
  assert.match(compose, /condition:\s*service_healthy/);
  assert.match(compose, /pg_isready/);
  assert.match(compose, /redis-cli/);
  assert.match(compose, /127\.0\.0\.1:\$\{POSTGRES_PORT\}/);
  assert.match(compose, /127\.0\.0\.1:\$\{REDIS_PORT\}/);
  assert.match(compose, /^volumes:\s*$/m);
  assert.match(compose, /^\s{2}postgres-data:\s*$/m);
  assert.match(compose, /^\s{2}redis-data:\s*$/m);
});

test('.env.example 暴露 Story 2.1 所需环境变量约定', async () => {
  const envExample = await readRepoFile('.env.example');

  for (const variableName of [
    'APP_PORT',
    'POSTGRES_DB',
    'POSTGRES_USER',
    'POSTGRES_PASSWORD',
    'POSTGRES_PORT',
    'REDIS_PORT',
    'DATABASE_URL',
    'REDIS_URL',
    'SESSION_SECRET',
    'ENABLE_DEV_ERP_AUTH',
  ]) {
    assert.match(
      envExample,
      new RegExp(`^${variableName}=`, 'm'),
      `缺少 ${variableName} 示例值`,
    );
  }
});

test('Dockerfile.dev 使用 Node 24 Debian 变体并启用 pnpm', async () => {
  const dockerfile = await readRepoFile('Dockerfile.dev');

  assert.match(dockerfile, /^FROM node:24\.[\d.]+-bookworm$/m);
  assert.match(dockerfile, /corepack enable/);
  assert.match(dockerfile, /pnpm dev --hostname 0\.0\.0\.0 --port \$APP_PORT/);
});

test('本地基础设施文档覆盖常用命令、边界和后续扩展位', async () => {
  const docs = await readRepoFile('docs/local-infrastructure.md');

  for (const phrase of [
    'docker compose up -d',
    'docker compose down',
    'docker compose logs',
    'docker compose ps',
    'docker compose config',
    'docker compose down -v',
    'ENABLE_DEV_ERP_AUTH=1',
    'worker',
  ]) {
    assert.match(docs, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('Story 2.1 基线仍不接入 neo4j、cube 服务', async () => {
  const compose = await readRepoFile('compose.yaml');

  assert.doesNotMatch(compose, /^\s{2}neo4j:\s*$/m);
  assert.doesNotMatch(compose, /^\s{2}cube:\s*$/m);
});
