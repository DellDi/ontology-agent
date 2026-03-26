import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();

async function readRepoFile(relativePath) {
  return readFile(path.join(repoRoot, relativePath), 'utf8');
}

const requiredPaths = [
  'src/infrastructure/redis/client.ts',
  'src/infrastructure/redis/keys.ts',
  'src/infrastructure/redis/health.ts',
  'src/infrastructure/redis/index.ts',
];

for (const relativePath of requiredPaths) {
  test(`Story 2.5 工件存在：${relativePath}`, async () => {
    await access(path.join(repoRoot, relativePath));
  });
}

test('package.json 包含 redis 依赖', async () => {
  const packageJson = JSON.parse(await readRepoFile('package.json'));

  assert.ok(
    packageJson.dependencies.redis,
    'dependencies 应包含 redis',
  );
});

test('Redis 客户端入口使用官方 redis 库且读取 REDIS_URL', async () => {
  const client = await readRepoFile('src/infrastructure/redis/client.ts');

  assert.match(client, /from 'redis'/);
  assert.match(client, /createRedisClient/);
  assert.match(client, /REDIS_URL/);
  assert.match(client, /createClient/);
});

test('Redis 客户端连接失败不静默', async () => {
  const client = await readRepoFile('src/infrastructure/redis/client.ts');

  assert.match(
    client,
    /throw new Error/,
    '缺少 REDIS_URL 时应抛出错误',
  );
  assert.match(
    client,
    /\.on\('error'/,
    '应监听 error 事件',
  );
});

test('Key namespace 包含稳定前缀和至少 4 个命名空间', async () => {
  const keys = await readRepoFile('src/infrastructure/redis/keys.ts');

  assert.match(keys, /oa/, '应包含应用前缀 oa');

  for (const namespace of ['rate', 'worker', 'stream', 'cache']) {
    assert.match(
      keys,
      new RegExp(namespace),
      `应包含 ${namespace} 命名空间`,
    );
  }
});

test('Key namespace 支持环境隔离前缀', async () => {
  const keys = await readRepoFile('src/infrastructure/redis/keys.ts');

  assert.match(
    keys,
    /REDIS_KEY_PREFIX/,
    '应支持通过环境变量覆盖前缀',
  );
});

test('健康检查模块包含 PING 验证', async () => {
  const health = await readRepoFile('src/infrastructure/redis/health.ts');

  assert.match(health, /ping/, '应调用 PING 命令');
  assert.match(health, /latencyMs/, '应返回延迟指标');
  assert.match(health, /ok/, '应返回健康状态布尔值');
});

test('统一导出入口包含 client、keys、health', async () => {
  const index = await readRepoFile('src/infrastructure/redis/index.ts');

  assert.match(index, /createRedisClient/);
  assert.match(index, /redisKeys/);
  assert.match(index, /checkRedisHealth/);
});

test('.env.example 包含 REDIS_URL', async () => {
  const envExample = await readRepoFile('.env.example');

  assert.match(envExample, /REDIS_URL/);
});

test('Memory session store 未被替换为 Redis', async () => {
  const memorySessionStore = await readRepoFile(
    'src/infrastructure/session/memory-session-store.ts',
  );
  const memoryAnalysisStore = await readRepoFile(
    'src/infrastructure/analysis-session/memory-analysis-session-store.ts',
  );

  assert.match(memorySessionStore, /createMemorySessionStore/);
  assert.match(memoryAnalysisStore, /createMemoryAnalysisSessionStore/);
});
