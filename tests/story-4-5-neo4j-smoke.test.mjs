import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

loadLocalEnvFiles(process.cwd());

const shouldRunSmokeTest = process.env.RUN_NEO4J_SMOKE_TEST === '1';

const smokeTestSkipReason =
  '设置 RUN_NEO4J_SMOKE_TEST=1 后，才会执行真实 Neo4j smoke test。';

function loadLocalEnvFiles(cwd) {
  for (const filename of ['.env.local', '.env']) {
    const absolutePath = path.join(cwd, filename);

    if (!existsSync(absolutePath)) {
      continue;
    }

    const content = readFileSync(absolutePath, 'utf8');
    const lines = content.split(/\r?\n/);

    for (const line of lines) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const separatorIndex = trimmed.indexOf('=');

      if (separatorIndex <= 0) {
        continue;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      const rawValue = trimmed.slice(separatorIndex + 1).trim();

      if (!key || process.env[key]) {
        continue;
      }

      process.env[key] = rawValue.replace(/^['"]|['"]$/g, '');
    }
  }
}

function getRequiredEnv(name) {
  const value = process.env[name]?.trim();
  assert.ok(value, `${name} 必须存在，才能执行真实 Neo4j smoke test`);
  return value;
}

async function getNeo4jModules() {
  const adapterModule = await import('../src/infrastructure/neo4j/neo4j-graph-adapter.ts');
  const syncModule = await import('../src/infrastructure/sync/neo4j-graph-sync.ts');

  assert.equal(
    typeof adapterModule.createNeo4jGraphAdapter,
    'function',
    '应能从 adapter 模块解析出 createNeo4jGraphAdapter',
  );
  assert.equal(
    typeof syncModule.buildGraphSyncBatch,
    'function',
    '应能从 sync 模块解析出 buildGraphSyncBatch',
  );

  return {
    createNeo4jGraphAdapter: adapterModule.createNeo4jGraphAdapter,
    buildGraphSyncBatch: syncModule.buildGraphSyncBatch,
  };
}

test(
  'Story 4.5 真实 Neo4j smoke test',
  {
    skip: shouldRunSmokeTest ? false : smokeTestSkipReason,
    timeout: 30_000,
  },
  async (t) => {
    getRequiredEnv('NEO4J_URI');
    getRequiredEnv('NEO4J_USERNAME');
    getRequiredEnv('NEO4J_PASSWORD');

    const { createNeo4jGraphAdapter, buildGraphSyncBatch } = await getNeo4jModules();
    const adapter = createNeo4jGraphAdapter();

    await t.test('健康检查可通过', async () => {
      const health = await adapter.checkHealth();

      assert.equal(health.ok, true);
      assert.equal(health.status, 'ready');
    });

    await t.test('真实写入最小图谱后，fee-analysis 可返回非静态候选因素', async () => {
      const unique = `smoke-${Date.now()}`;
      const orgId = `org-${unique}`;
      const projectId = `project-${unique}`;
      const chargeItemId = `charge-item-${unique}`;
      const receivableId = `receivable-${unique}`;
      const paymentId = `payment-${unique}`;
      const projectLabel = `项目${unique}`;
      const chargeItemLabel = `物业费${unique}`;

      const batch = buildGraphSyncBatch({
        organizations: [{ id: orgId, name: `组织${unique}` }],
        projects: [{ id: projectId, name: projectLabel, organizationId: orgId }],
        chargeItems: [{ id: chargeItemId, name: chargeItemLabel }],
        receivables: [{ recordId: receivableId, projectId, chargeItemId }],
        payments: [{ recordId: paymentId, projectId, chargeItemId }],
      });

      const syncResult = await adapter.syncBaseline(batch);
      assert.equal(syncResult.nodesWritten, 5);
      assert.equal(syncResult.edgesWritten, 5);

      const factors = await adapter.findCandidateFactors({
        intentType: 'fee-analysis',
        metric: '收费回款率',
        entity: unique,
        timeRange: '本月',
        questionText: `为什么本月${projectLabel}收费回款率下降了？`,
      });

      assert.ok(factors.length > 0, '真实图谱应返回至少一个候选因素');
      assert.equal(factors[0].factorLabel, chargeItemLabel);
      assert.equal(factors[0].relationType, 'belongs-to');
      assert.equal(factors[0].source, 'erp-derived');
      assert.doesNotMatch(factors[0].explanation, /治理规则|因果边/i);
    });
  },
);
