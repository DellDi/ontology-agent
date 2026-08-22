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
  'cube/conf/model/FinancePayments.js',
  'cube/conf/model/ServiceOrders.js',
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
  assert.match(compose, /image:\s*neo4j:5\.26\.\d+-community-ubi10/);
  assert.match(compose, /127\.0\.0\.1:\$\{CUBE_PORT\}:4000/);
  assert.match(compose, /127\.0\.0\.1:\$\{NEO4J_HTTP_PORT\}:7474/);
  assert.match(compose, /127\.0\.0\.1:\$\{NEO4J_BOLT_PORT\}:7687/);
  assert.match(compose, /CUBEJS_DB_TYPE:\s*postgres/);
  assert.match(compose, /CUBEJS_API_SECRET:\s*\$\{CUBE_API_SECRET\}/);
  assert.match(compose, /cube-store:\/cube\/conf\/\.cubestore/);
  assert.match(compose, /NEO4J_AUTH:\s*\$\{NEO4J_USERNAME\}\/\$\{NEO4J_PASSWORD\}/);
});

test('开发 compose 只向 Java backend 注入数据层与模型凭据', async () => {
  const compose = await readRepoFile('compose.yaml');
  const webBlock = compose.match(/^  web:\r?\n[\s\S]*?(?=^  postgres:)/m)?.[0];

  assert.ok(webBlock, '应能定位 web service 配置');
  assert.doesNotMatch(
    webBlock,
    /CUBE_API_SECRET|NEO4J_PASSWORD|LLM_PROVIDER_API_KEY/,
    'Web 容器不得持有 Java backend 的上游凭据',
  );
});

test('.env.example 对齐 cube 与 neo4j 的真实本地端口和密钥约定', async () => {
  const envExample = await readRepoFile('.env.example');

  for (const variableName of [
    'CUBE_PORT',
    'CUBE_API_URL',
    'CUBE_API_SECRET',
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

test('本地基础设施文档覆盖 cube 与 neo4j 的启动、日志和 Cube API 自动签名', async () => {
  const docs = await readRepoFile('docs/local-infrastructure.md');

  for (const phrase of [
    'docker compose up -d postgres redis neo4j cube',
    'docker compose logs -f cube',
    'docker compose logs -f neo4j',
    '自动签发 Cube API JWT',
    'http://127.0.0.1:4000/readyz',
    'bolt://127.0.0.1:7687',
    'http://127.0.0.1:7474',
  ]) {
    assert.match(docs, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('Cube 本地模型至少提供 FinanceReceivables、FinancePayments 与 ServiceOrders 治理主题', async () => {
  const receivablesModel = await readRepoFile('cube/conf/model/Finance.js');
  const paymentsModel = await readRepoFile('cube/conf/model/FinancePayments.js');
  const serviceOrdersModel = await readRepoFile('cube/conf/model/ServiceOrders.js');

  assert.match(receivablesModel, /cube\(`FinanceReceivables`/);
  assert.match(receivablesModel, /receivableAmount/);

  assert.match(paymentsModel, /cube\(`FinancePayments`/);
  assert.match(paymentsModel, /paidAmount/);

  assert.match(serviceOrdersModel, /cube\(`ServiceOrders`/);
  assert.match(serviceOrdersModel, /averageResponseDurationHours/);
  assert.match(serviceOrdersModel, /averageCloseDurationHours/);
  assert.match(serviceOrdersModel, /averageSatisfaction/);
  assert.match(serviceOrdersModel, /NULLIF\(satisfaction,\s*0\)/);
  assert.match(serviceOrdersModel, /accept_date - \${CUBE}\.create_date_time/);
  assert.match(serviceOrdersModel, /completedAt/);
  assert.match(serviceOrdersModel, /accomplish_date/);
});

test('package.json 不再暴露 TypeScript Graph Sync 或 Neo4j 运行入口', async () => {
  const packageJson = await readRepoFile('package.json');

  assert.doesNotMatch(packageJson, /"graph:sync:/, 'Graph Sync 已由 Java 独占，不得保留 TS 写入口');
  assert.doesNotMatch(packageJson, /"test:smoke:neo4j"/);
});
