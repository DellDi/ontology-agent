import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function runTsSnippet(code) {
  const { stdout } = await execFileAsync(
    'node',
    ['--import', 'tsx', '--input-type=module', '-e', code],
    { cwd: process.cwd() },
  );

  return JSON.parse(stdout.trim());
}

test('Story 7.6 org-rebuild 会写 run 记录、节点边运行元数据，并执行 scoped cleanup', async () => {
  const result = await runTsSnippet(`
    import graphSyncUseCasesModule from './src/application/graph-sync/use-cases.ts';

    const { createGraphSyncUseCases } = graphSyncUseCasesModule;

    const savedRuns = [];
    let syncedBatch = null;
    let cleanupInput = null;

    const useCases = createGraphSyncUseCases({
      erpReadUseCases: {
        async listOrganizations() {
          return [{ id: 'org-1', name: '组织A' }];
        },
        async listProjects() {
          return [{ id: 'project-1', name: '丰和园小区项目', organizationId: 'org-1' }];
        },
        async listCurrentOwners() {
          return [];
        },
        async listChargeItems() {
          return [{ id: 'charge-item-1', name: '物业费' }];
        },
        async listReceivables() {
          return [{ recordId: 'receivable-1', organizationId: 'org-1', projectId: 'project-1', projectName: '丰和园小区项目', chargeItemId: 'charge-item-1', chargeItemName: '物业费' }];
        },
        async listPayments() {
          return [{ recordId: 'payment-1', organizationId: 'org-1', projectId: 'project-1', projectName: '丰和园小区项目', chargeItemId: 'charge-item-1', chargeItemName: '物业费' }];
        },
        async listServiceOrders() {
          return [];
        },
      },
      graphUseCases: {
        async syncBaseline(batch) {
          syncedBatch = batch;
          return {
            nodesWritten: batch.nodes.length,
            edgesWritten: batch.edges.length,
          };
        },
        async cleanupScopedData(input) {
          cleanupInput = input;
          return {
            deletedNodes: 1,
            deletedEdges: 2,
          };
        },
      },
      graphSyncRunStore: {
        async save(run) {
          savedRuns.push(run);
          return run;
        },
      },
    });

    const output = await useCases.runOrganizationRebuild({
      session: {
        userId: 'sync-user',
        displayName: 'sync-user',
        sessionId: 'sync-session',
        expiresAt: '2099-01-01T00:00:00.000Z',
        scope: {
          organizationId: 'org-1',
          projectIds: [],
          areaIds: [],
          roleCodes: ['SYSTEM_SYNC'],
        },
      },
      mode: 'org-rebuild',
      triggerType: 'manual',
      triggeredBy: 'test-suite',
      cursorSnapshot: {
        'erp.receivables': {
          cursorTime: '2026-04-08T00:00:00.000Z',
          cursorPk: 'receivable-1',
        },
      },
    });

    console.log(JSON.stringify({
      output,
      runStatuses: savedRuns.map((run) => run.status),
      finalRun: savedRuns.at(-1),
      nodeProperties: syncedBatch.nodes.map((node) => node.properties ?? null),
      edgeProperties: syncedBatch.edges.map((edge) => edge.properties ?? null),
      cleanupInput,
    }));
  `);

  assert.deepEqual(result.runStatuses, ['pending', 'running', 'completed']);
  assert.equal(result.output.nodesWritten > 0, true);
  assert.equal(result.output.edgesWritten > 0, true);
  assert.equal(result.finalRun.scopeKey, 'organization:org-1');
  assert.equal(result.finalRun.triggerType, 'manual');
  assert.equal(result.finalRun.triggeredBy, 'test-suite');
  assert.equal(result.finalRun.nodesWritten > 0, true);
  assert.equal(result.finalRun.edgesWritten > 0, true);
  assert.equal(result.nodeProperties.every((value) => value?.scope_org_id === 'org-1'), true);
  assert.equal(result.nodeProperties.every((value) => typeof value?.last_seen_run_id === 'string' && value.last_seen_run_id.length > 0), true);
  assert.equal(result.edgeProperties.every((value) => value?.scope_org_id === 'org-1'), true);
  assert.equal(result.cleanupInput.scopeOrgId, 'org-1');
  assert.equal(result.cleanupInput.lastSeenRunId, result.finalRun.id);
});

test('Story 7.6 构造的 scoped cleanup Cypher 必须限制当前组织与当前 run', async () => {
  const result = await runTsSnippet(`
    import syncModule from './src/infrastructure/sync/neo4j-graph-sync.ts';

    const cypher = syncModule.buildNeo4jScopedCleanupCypher();

    console.log(JSON.stringify({ cypher }));
  `);

  assert.match(result.cypher, /scope_org_id = \$scopeOrgId/);
  assert.match(result.cypher, /last_seen_run_id <> \$lastSeenRunId/);
  assert.doesNotMatch(result.cypher, /DETACH DELETE/);
});

test('Story 7.6 org-rebuild 失败时必须把 run 记录为 failed 并保留错误摘要', async () => {
  const result = await runTsSnippet(`
    import graphSyncUseCasesModule from './src/application/graph-sync/use-cases.ts';

    const { createGraphSyncUseCases } = graphSyncUseCasesModule;

    const savedRuns = [];

    const useCases = createGraphSyncUseCases({
      erpReadUseCases: {
        async listOrganizations() {
          return [{ id: 'org-1', name: '组织A' }];
        },
        async listProjects() {
          return [{ id: 'project-1', name: '丰和园小区项目', organizationId: 'org-1' }];
        },
        async listCurrentOwners() {
          return [];
        },
        async listChargeItems() {
          return [];
        },
        async listReceivables() {
          return [];
        },
        async listPayments() {
          return [];
        },
        async listServiceOrders() {
          return [];
        },
      },
      graphUseCases: {
        async syncBaseline() {
          throw new Error('neo4j down');
        },
        async cleanupScopedData() {
          throw new Error('should not reach cleanup');
        },
      },
      graphSyncRunStore: {
        async save(run) {
          savedRuns.push(run);
          return run;
        },
      },
    });

    try {
      await useCases.runOrganizationRebuild({
        session: {
          userId: 'sync-user',
          displayName: 'sync-user',
          sessionId: 'sync-session',
          expiresAt: '2099-01-01T00:00:00.000Z',
          scope: {
            organizationId: 'org-1',
            projectIds: [],
            areaIds: [],
            roleCodes: ['SYSTEM_SYNC'],
          },
        },
        mode: 'org-rebuild',
        triggerType: 'manual',
        triggeredBy: 'test-suite',
        cursorSnapshot: {},
      });
    } catch (error) {
      console.log(JSON.stringify({
        errorMessage: error instanceof Error ? error.message : String(error),
        runStatuses: savedRuns.map((run) => run.status),
        finalRun: savedRuns.at(-1),
      }));
    }
  `);

  assert.equal(result.errorMessage, 'neo4j down');
  assert.deepEqual(result.runStatuses, ['pending', 'running', 'failed']);
  assert.equal(result.finalRun.errorSummary, 'neo4j down');
});
