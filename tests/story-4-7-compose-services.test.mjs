import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();

async function readRepoFile(relativePath) {
  return readFile(path.join(repoRoot, relativePath), 'utf8');
}

for (const relativePath of [
  'compose.yaml',
  '.env.example',
  'docs/local-infrastructure.md',
  'cube/conf/cube.js',
  'cube/conf/model/Finance.js',
  'cube/conf/model/ServiceOrders.js',
  'scripts/generate-cube-dev-token.mjs',
]) {
  test(`Story 4.7 工件存在：${relativePath}`, async () => {
    await access(path.join(repoRoot, relativePath));
  });
}

test('compose.yaml 正式定义 cube 与 neo4j 服务', async () => {
  const compose = await readRepoFile('compose.yaml');

  assert.match(compose, /^\s{2}cube:\s*$/m);
  assert.match(compose, /^\s{2}neo4j:\s*$/m);
  assert.match(compose, /image:\s*cubejs\/cube:v1\.6\.\d+/);
  assert.match(compose, /image:\s*neo4j:5\.26\.\d+-community-ubi9/);
  assert.match(compose, /127\.0\.0\.1:\$\{CUBE_PORT\}:4000/);
  assert.match(compose, /127\.0\.0\.1:\$\{NEO4J_HTTP_PORT\}:7474/);
  assert.match(compose, /127\.0\.0\.1:\$\{NEO4J_BOLT_PORT\}:7687/);
  assert.match(compose, /CUBEJS_DB_TYPE:\s*postgres/);
  assert.match(compose, /CUBEJS_API_SECRET:\s*\$\{CUBE_API_SECRET\}/);
  assert.match(compose, /cube-store:\/cube\/conf\/\.cubestore/);
  assert.match(compose, /NEO4J_AUTH:\s*\$\{NEO4J_USERNAME\}\/\$\{NEO4J_PASSWORD\}/);
});

test('.env.example 对齐 cube 与 neo4j 的真实本地端口和密钥约定', async () => {
  const envExample = await readRepoFile('.env.example');

  for (const variableName of [
    'CUBE_PORT',
    'CUBE_API_URL',
    'CUBE_API_SECRET',
    'CUBE_API_TOKEN',
    'CUBE_QUERY_TIMEOUT_MS',
    'NEO4J_HTTP_PORT',
    'NEO4J_BOLT_PORT',
    'NEO4J_URI',
    'NEO4J_USERNAME',
    'NEO4J_PASSWORD',
    'NEO4J_DATABASE',
  ]) {
    assert.match(envExample, new RegExp(`^${variableName}=`, 'm'));
  }

  assert.match(envExample, /^CUBE_API_URL=http:\/\/127\.0\.0\.1:4000\/cubejs-api\/v1$/m);
  assert.match(envExample, /^NEO4J_URI=bolt:\/\/127\.0\.0\.1:7687$/m);
});

test('本地基础设施文档覆盖 cube 与 neo4j 的启动、日志和 token 生成', async () => {
  const docs = await readRepoFile('docs/local-infrastructure.md');

  for (const phrase of [
    'docker compose up -d postgres redis neo4j cube',
    'docker compose logs -f cube',
    'docker compose logs -f neo4j',
    'pnpm cube:token',
    'pnpm test:smoke:neo4j',
    'http://127.0.0.1:4000/cubejs-api/v1/meta',
    'bolt://127.0.0.1:7687',
    'http://127.0.0.1:7474',
  ]) {
    assert.match(docs, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('Cube 本地模型至少提供 Finance 与 ServiceOrders 两个治理主题', async () => {
  const financeModel = await readRepoFile('cube/conf/model/Finance.js');
  const serviceOrdersModel = await readRepoFile('cube/conf/model/ServiceOrders.js');

  assert.match(financeModel, /cube\(`Finance`/);
  assert.match(financeModel, /collectionRate/);
  assert.match(financeModel, /receivableAmount/);
  assert.match(financeModel, /paidAmount/);

  assert.match(serviceOrdersModel, /cube\(`ServiceOrders`/);
  assert.match(serviceOrdersModel, /averageResponseDurationHours/);
  assert.match(serviceOrdersModel, /averageCloseDurationHours/);
  assert.match(serviceOrdersModel, /averageSatisfaction/);
});

test('package.json 提供本地 Cube token 生成脚本', async () => {
  const packageJson = await readRepoFile('package.json');

  assert.match(packageJson, /"cube:token"\s*:\s*"node scripts\/generate-cube-dev-token\.mjs"/);
  assert.match(packageJson, /"test:smoke:neo4j"\s*:\s*"NODE_OPTIONS=--conditions=react-server RUN_NEO4J_SMOKE_TEST=1 npx tsx --test tests\/story-4-5-neo4j-smoke\.test\.mjs --no-cache"/);
});
