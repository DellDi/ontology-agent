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

test('Story 7.8 不同 graph sync job 入口必须路由到正确 use case', async () => {
  const result = await runTsSnippet(`
    import jobRunnerModule from './src/application/graph-sync/job-runner.ts';

    const { createGraphSyncJobRunner } = jobRunnerModule;

    const calls = [];

    const runner = createGraphSyncJobRunner({
      operationsUseCases: {
        async runBootstrapJob(input) {
          calls.push({ method: 'bootstrap', input });
          return { ok: true, job: 'bootstrap' };
        },
        async runOrgJob(input) {
          calls.push({ method: 'org', input });
          return { ok: true, job: 'org' };
        },
        async runIncrementalJob(input) {
          calls.push({ method: 'incremental', input });
          return { ok: true, job: 'incremental' };
        },
        async runDispatchJob(input) {
          calls.push({ method: 'dispatch', input });
          return { ok: true, job: 'dispatch' };
        },
        async runConsistencySweepJob(input) {
          calls.push({ method: 'consistency-sweep', input });
          return { ok: true, job: 'consistency-sweep' };
        },
        async runDiagnoseOrgJob(input) {
          calls.push({ method: 'diagnose-org', input });
          return { ok: true, job: 'diagnose-org' };
        },
        async getStatus(input) {
          calls.push({ method: 'status', input });
          return { ok: true, job: 'status' };
        },
      },
    });

    await runner.runJob({ job: 'bootstrap', triggerType: 'manual', triggeredBy: 'test', organizationIds: ['org-1'] });
    await runner.runJob({ job: 'org', triggerType: 'manual', triggeredBy: 'test', organizationIds: ['org-2'] });
    await runner.runJob({ job: 'incremental', triggerType: 'scheduler', triggeredBy: 'test' });
    await runner.runJob({ job: 'dispatch', triggerType: 'scheduler', triggeredBy: 'test', retryFailed: true, maxRetryAttempts: 3 });
    await runner.runJob({ job: 'consistency-sweep', triggerType: 'recovery', triggeredBy: 'test', organizationIds: ['org-9'] });
    await runner.runJob({ job: 'diagnose-org', triggerType: 'manual', triggeredBy: 'test', organizationIds: ['org-10'] });
    await runner.runJob({ job: 'status', maxRetryAttempts: 3 });

    console.log(JSON.stringify({ calls }));
  `);

  assert.deepEqual(
    result.calls.map((entry) => entry.method),
    ['bootstrap', 'org', 'incremental', 'dispatch', 'consistency-sweep', 'diagnose-org', 'status'],
  );
  assert.equal(result.calls[3].input.retryFailed, true);
  assert.equal(result.calls[4].input.triggerType, 'recovery');
  assert.deepEqual(result.calls[5].input.organizationIds, ['org-10']);
});

test('Story 7.8 dispatch 重试必须保留超阈值 failed dirty scope 并只重试可补偿项', async () => {
  const result = await runTsSnippet(`
    import operationsModule from './src/application/graph-sync/operations-use-cases.ts';

    const { createGraphSyncOperationsUseCases } = operationsModule;

    const state = {
      pending: [],
      failed: [
        {
          id: 'failed-1',
          scopeType: 'organization',
          scopeKey: 'org-1',
          reason: 'payments-changed',
          sourceName: 'erp.payments',
          sourcePk: '11',
          sourceProgress: {
            'erp.payments': {
              cursorTime: '2026-04-08T10:00:00.000Z',
              cursorPk: '11',
              sourcePk: '11',
              reason: 'payments-changed',
            },
          },
          firstDetectedAt: '2026-04-08T10:00:00.000Z',
          lastDetectedAt: '2026-04-08T10:00:00.000Z',
          status: 'failed',
          attemptCount: 1,
          lastRunId: 'run-old',
        },
        {
          id: 'failed-2',
          scopeType: 'organization',
          scopeKey: 'org-2',
          reason: 'payments-changed',
          sourceName: 'erp.payments',
          sourcePk: '12',
          sourceProgress: {
            'erp.payments': {
              cursorTime: '2026-04-08T10:05:00.000Z',
              cursorPk: '12',
              sourcePk: '12',
              reason: 'payments-changed',
            },
          },
          firstDetectedAt: '2026-04-08T10:05:00.000Z',
          lastDetectedAt: '2026-04-08T10:05:00.000Z',
          status: 'failed',
          attemptCount: 3,
          lastRunId: 'run-old',
        },
      ],
    };

    const runSaves = [];
    const retriedScopes = [];
    const dispatched = [];

    const useCases = createGraphSyncOperationsUseCases({
      sourceNames: ['erp.payments'],
      organizationSource: {
        async listOrganizationIds() {
          return [];
        },
        async diagnoseOrganizationIds() {
          return [];
        },
      },
      graphSyncRunStore: {
        async save(run) {
          runSaves.push(run);
          return run;
        },
        async listRecent() {
          return [];
        },
      },
      dirtyScopeStore: {
        async upsertPending(scope) {
          return scope;
        },
        async listPendingBySource() {
          return state.pending;
        },
        async listFailedBySource() {
          return state.failed;
        },
        async markPending(scope, input) {
          retriedScopes.push({ scopeKey: scope.scopeKey, retryReason: input.retryReason });
          state.pending.push({ ...scope, status: 'pending', lastRunId: scope.lastRunId });
          return { ...scope, status: 'pending' };
        },
        async listDispatchableBySource() {
          return [];
        },
        async markProcessing(scope) {
          return scope;
        },
        async markCompleted(scope) {
          return scope;
        },
        async markFailed(scope, input) {
          return { ...scope, status: 'failed', errorSummary: input.errorSummary };
        },
        async countByStatus() {
          return {
            pending: state.pending.length,
            processing: 0,
            completed: 0,
            failed: state.failed.length,
          };
        },
        async listRecentFailures() {
          return state.failed;
        },
      },
      incrementalUseCases: {
        async scanSource() {
          throw new Error('not used');
        },
        async dispatchSource(input) {
          dispatched.push(input);
          return {
            sourceName: input.sourceName,
            rebuiltOrganizations: ['org-1'],
            cursorAdvanced: false,
            advancedCursor: null,
          };
        },
      },
      organizationRebuildRunner: {
        async runOrganizationRebuild() {
          throw new Error('not used');
        },
      },
    });

    const output = await useCases.runDispatchJob({
      sourceNames: ['erp.payments'],
      triggerType: 'recovery',
      triggeredBy: 'test-suite',
      retryFailed: true,
      maxRetryAttempts: 3,
    });

    console.log(JSON.stringify({
      output,
      retriedScopes,
      dispatched,
      runStatuses: runSaves.map((run) => run.status),
    }));
  `);

  assert.deepEqual(result.retriedScopes, [
    {
      scopeKey: 'org-1',
      retryReason: 'manual-retry-dispatch',
    },
  ]);
  assert.equal(result.dispatched.length, 1);
  assert.equal(result.output.summaries[0].retriedScopeCount, 1);
  assert.equal(result.output.summaries[0].blockedFailedScopeCount, 1);
  assert.deepEqual(result.runStatuses, ['pending', 'running', 'completed']);
});

test('Story 7.8 consistency sweep 必须复用受控 org-rebuild 路径', async () => {
  const result = await runTsSnippet(`
    import operationsModule from './src/application/graph-sync/operations-use-cases.ts';

    const { createGraphSyncOperationsUseCases } = operationsModule;

    const rebuildCalls = [];

    const useCases = createGraphSyncOperationsUseCases({
      sourceNames: ['erp.organizations'],
      organizationSource: {
        async listOrganizationIds() {
          return ['org-1', 'org-2'];
        },
        async diagnoseOrganizationIds() {
          return [];
        },
      },
      graphSyncRunStore: {
        async save(run) {
          return run;
        },
        async listRecent() {
          return [];
        },
      },
      dirtyScopeStore: {
        async upsertPending(scope) {
          return scope;
        },
        async listPendingBySource() {
          return [];
        },
        async listFailedBySource() {
          return [];
        },
        async markPending(scope) {
          return scope;
        },
        async listDispatchableBySource() {
          return [];
        },
        async markProcessing(scope) {
          return scope;
        },
        async markCompleted(scope) {
          return scope;
        },
        async markFailed(scope) {
          return scope;
        },
        async countByStatus() {
          return {
            pending: 0,
            processing: 0,
            completed: 0,
            failed: 0,
          };
        },
        async listRecentFailures() {
          return [];
        },
      },
      incrementalUseCases: {
        async scanSource() {
          throw new Error('not used');
        },
        async dispatchSource() {
          throw new Error('not used');
        },
      },
      organizationRebuildRunner: {
        async runOrganizationRebuild(input) {
          rebuildCalls.push(input);
          return {
            run: {
              id: 'run-' + input.organizationId,
            },
          };
        },
      },
    });

    const output = await useCases.runConsistencySweepJob({
      triggerType: 'recovery',
      triggeredBy: 'test-suite',
      organizationIds: ['org-9'],
    });

    console.log(JSON.stringify({
      output,
      rebuildCalls,
    }));
  `);

  assert.deepEqual(result.output.organizationIds, ['org-9']);
  assert.equal(result.rebuildCalls.length, 1);
  assert.equal(result.rebuildCalls[0].mode, 'consistency-sweep');
  assert.equal(result.rebuildCalls[0].triggerType, 'recovery');
});

test('Story 7.8 真实组织诊断必须区分无效 organization_id 与有效 org_id 路径命中', async () => {
  const result = await runTsSnippet(`
    import operationsModule from './src/application/graph-sync/operations-use-cases.ts';

    const { createGraphSyncOperationsUseCases } = operationsModule;

    const useCases = createGraphSyncOperationsUseCases({
      sourceNames: ['erp.organizations'],
      organizationSource: {
        async listOrganizationIds() {
          return [];
        },
        async diagnoseOrganizationIds(input) {
          return input.organizationIds.map((organizationId) => ({
            requestedOrganizationId: organizationId,
            matchedOrganization: organizationId === '2849'
              ? {
                  organizationId: '2849',
                  organizationName: '北京物业分公司',
                  organizationPath: '/240/',
                }
              : null,
            descendantOrganizationCount: organizationId === '2849' ? 38 : 0,
            projectCount: organizationId === '2849' ? 37 : 0,
            serviceOrderCount: organizationId === '2849' ? 24291 : 0,
            precinctOrganizationIdMatchCount: organizationId === '2849' ? 0 : 356,
            precinctOrgIdMatchCount: organizationId === '2849' ? 37 : 0,
            diagnostics: organizationId === '2849'
              ? [
                  '命中 erp_staging.dw_datacenter_system_organization.source_id。',
                  'dw_datacenter_precinct.organization_id 未命中，实际作用域键为 org_id。',
                ]
              : [
                  '未命中真实组织主数据。',
                ],
          }));
        },
      },
      graphSyncRunStore: {
        async save(run) {
          return run;
        },
        async listRecent() {
          return [];
        },
      },
      dirtyScopeStore: {
        async upsertPending(scope) {
          return scope;
        },
        async listPendingBySource() {
          return [];
        },
        async listFailedBySource() {
          return [];
        },
        async markPending(scope) {
          return scope;
        },
        async listDispatchableBySource() {
          return [];
        },
        async markProcessing(scope) {
          return scope;
        },
        async markCompleted(scope) {
          return scope;
        },
        async markFailed(scope) {
          return scope;
        },
        async countByStatus() {
          return {
            pending: 0,
            processing: 0,
            completed: 0,
            failed: 0,
          };
        },
        async listRecentFailures() {
          return [];
        },
      },
      incrementalUseCases: {
        async scanSource() {
          throw new Error('not used');
        },
        async dispatchSource() {
          throw new Error('not used');
        },
      },
      organizationRebuildRunner: {
        async runOrganizationRebuild() {
          throw new Error('not used');
        },
      },
    });

    const output = await useCases.runDiagnoseOrgJob({
      organizationIds: ['0', '2849'],
      triggerType: 'manual',
      triggeredBy: 'test-suite',
    });

    console.log(JSON.stringify({ output }));
  `);

  assert.equal(result.output.job, 'diagnose-org');
  assert.equal(result.output.summaries[0].matchedOrganization, null);
  assert.equal(result.output.summaries[0].precinctOrganizationIdMatchCount, 356);
  assert.equal(result.output.summaries[1].matchedOrganization.organizationId, '2849');
  assert.equal(result.output.summaries[1].projectCount, 37);
  assert.equal(result.output.summaries[1].serviceOrderCount, 24291);
  assert.match(result.output.summaries[1].diagnostics[1], /org_id/);
});

test('Story 7.8 运行状态输出必须包含 run、backlog、failure 与 runbook 信息', async () => {
  const result = await runTsSnippet(`
    import operationsModule from './src/application/graph-sync/operations-use-cases.ts';

    const { createGraphSyncOperationsUseCases } = operationsModule;

    const useCases = createGraphSyncOperationsUseCases({
      sourceNames: ['erp.projects'],
      organizationSource: {
        async listOrganizationIds() {
          return [];
        },
        async diagnoseOrganizationIds() {
          return [];
        },
      },
      graphSyncRunStore: {
        async save(run) {
          return run;
        },
        async listRecent() {
          return [
            {
              id: 'run-1',
              mode: 'dispatch',
              status: 'partial',
              scopeType: 'all',
              scopeKey: 'erp.projects',
              triggerType: 'scheduler',
              triggeredBy: 'cron',
              cursorSnapshot: {},
              nodesWritten: 0,
              edgesWritten: 0,
              errorSummary: 'org-9 rebuild failed',
              errorDetail: null,
              startedAt: '2026-04-08T10:00:00.000Z',
              finishedAt: '2026-04-08T10:01:00.000Z',
              createdAt: '2026-04-08T10:00:00.000Z',
              updatedAt: '2026-04-08T10:01:00.000Z',
            },
          ];
        },
      },
      dirtyScopeStore: {
        async upsertPending(scope) {
          return scope;
        },
        async listPendingBySource() {
          return [];
        },
        async listFailedBySource() {
          return [];
        },
        async markPending(scope) {
          return scope;
        },
        async listDispatchableBySource() {
          return [];
        },
        async markProcessing(scope) {
          return scope;
        },
        async markCompleted(scope) {
          return scope;
        },
        async markFailed(scope) {
          return scope;
        },
        async countByStatus() {
          return {
            pending: 2,
            processing: 1,
            completed: 5,
            failed: 3,
          };
        },
        async listRecentFailures() {
          return [
            {
              id: 'failed-1',
              scopeType: 'organization',
              scopeKey: 'org-9',
              reason: 'projects-changed',
              sourceName: 'erp.projects',
              sourcePk: '99',
              sourceProgress: {},
              firstDetectedAt: '2026-04-08T09:00:00.000Z',
              lastDetectedAt: '2026-04-08T10:00:00.000Z',
              status: 'failed',
              attemptCount: 4,
              lastRunId: 'run-1',
            },
          ];
        },
      },
      incrementalUseCases: {
        async scanSource() {
          throw new Error('not used');
        },
        async dispatchSource() {
          throw new Error('not used');
        },
      },
      organizationRebuildRunner: {
        async runOrganizationRebuild() {
          throw new Error('not used');
        },
      },
    });

    const output = await useCases.getStatus({
      maxRetryAttempts: 3,
      recentRunLimit: 5,
    });

    console.log(JSON.stringify({ output }));
  `);

  assert.equal(result.output.backlog.pending, 2);
  assert.equal(result.output.backlog.failed, 3);
  assert.equal(result.output.backlog.blockedFailed, 1);
  assert.equal(result.output.recentRuns[0].errorSummary, 'org-9 rebuild failed');
  assert.match(result.output.runbook[0], /graph:sync:dispatch/);
});

test('Story 7.8 incremental 扫描失败时必须保留 failed run 供后续补偿', async () => {
  const result = await runTsSnippet(`
    import operationsModule from './src/application/graph-sync/operations-use-cases.ts';

    const { createGraphSyncOperationsUseCases } = operationsModule;

    const runSaves = [];

    const useCases = createGraphSyncOperationsUseCases({
      sourceNames: ['erp.receivables'],
      organizationSource: {
        async listOrganizationIds() {
          return [];
        },
      },
      graphSyncRunStore: {
        async save(run) {
          runSaves.push(run);
          return run;
        },
        async listRecent() {
          return [];
        },
      },
      dirtyScopeStore: {
        async upsertPending(scope) {
          return scope;
        },
        async listPendingBySource() {
          return [];
        },
        async listFailedBySource() {
          return [];
        },
        async markPending(scope) {
          return scope;
        },
        async listDispatchableBySource() {
          return [];
        },
        async markProcessing(scope) {
          return scope;
        },
        async markCompleted(scope) {
          return scope;
        },
        async markFailed(scope) {
          return scope;
        },
        async countByStatus() {
          return {
            pending: 0,
            processing: 0,
            completed: 0,
            failed: 0,
          };
        },
        async listRecentFailures() {
          return [];
        },
      },
      incrementalUseCases: {
        async scanSource() {
          throw new Error('scan source failed');
        },
        async dispatchSource() {
          throw new Error('not used');
        },
      },
      organizationRebuildRunner: {
        async runOrganizationRebuild() {
          throw new Error('not used');
        },
      },
    });

    const output = await useCases.runIncrementalJob({
      sourceNames: ['erp.receivables'],
      triggerType: 'scheduler',
      triggeredBy: 'test-suite',
    });

    console.log(JSON.stringify({
      output,
      runStatuses: runSaves.map((run) => ({
        mode: run.mode,
        status: run.status,
        scopeKey: run.scopeKey,
        errorSummary: run.errorSummary,
      })),
    }));
  `);

  assert.equal(result.output.summaries[0].status, 'failed');
  assert.deepEqual(result.runStatuses, [
    {
      mode: 'incremental-scan',
      status: 'pending',
      scopeKey: 'erp.receivables',
      errorSummary: null,
    },
    {
      mode: 'incremental-scan',
      status: 'running',
      scopeKey: 'erp.receivables',
      errorSummary: null,
    },
    {
      mode: 'incremental-scan',
      status: 'failed',
      scopeKey: 'erp.receivables',
      errorSummary: 'scan source failed',
    },
  ]);
});

test('Story 7.8 默认组织发现必须基于真实 org_id 而不是 precinct.organization_id 的伪值', async () => {
  const result = await runTsSnippet(`
    import sourceModule from './src/infrastructure/graph-sync/postgres-graph-sync-organization-source.ts';

    const { createPostgresGraphSyncOrganizationSource } = sourceModule;

    const queries = [];
    const organizationSource = createPostgresGraphSyncOrganizationSource({
      pool: {
        async query(text) {
          queries.push(text);
          return {
            rows: [
              { organization_id: '2849' },
              { organization_id: '3064' },
            ],
          };
        },
      },
    });

    const organizationIds = await organizationSource.listOrganizationIds({
      limit: 2,
    });

    console.log(JSON.stringify({
      organizationIds,
      query: queries[0],
    }));
  `);

  assert.deepEqual(result.organizationIds, ['2849', '3064']);
  assert.match(result.query, /dw_datacenter_system_organization/);
  assert.match(result.query, /p\.org_id = o\.source_id::text/);
  assert.doesNotMatch(
    result.query,
    /coalesce\\(organization_id::text, org_id\\)/,
  );
});
