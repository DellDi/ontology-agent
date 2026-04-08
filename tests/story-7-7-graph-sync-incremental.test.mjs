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

test('Story 7.7 scanner 必须按复合游标读取 source 变更并写入 dirty scope', async () => {
  const result = await runTsSnippet(`
    import incrementalModule from './src/application/graph-sync/incremental-use-cases.ts';

    const { createGraphSyncIncrementalUseCases } = incrementalModule;

    const scanCalls = [];
    const dirtyScopes = [];

    const useCases = createGraphSyncIncrementalUseCases({
      sourceScanPort: {
        async scanSourceChanges(input) {
          scanCalls.push(input);
          return {
            changes: [
              {
                sourceName: input.sourceName,
                sourcePk: '3',
                scopeOrgId: 'org-1',
                reason: 'receivables-changed',
                cursorTime: '2026-04-08T10:00:00.000Z',
                cursorPk: '3',
              },
              {
                sourceName: input.sourceName,
                sourcePk: '4',
                scopeOrgId: 'org-2',
                reason: 'receivables-changed',
                cursorTime: '2026-04-08T10:00:00.000Z',
                cursorPk: '4',
              },
            ],
            diagnostics: [],
          };
        },
      },
      cursorStore: {
        async getBySourceName(sourceName) {
          return {
            sourceName,
            cursorTime: '2026-04-08T09:00:00.000Z',
            cursorPk: '2',
            lastRunId: 'run-prev',
            updatedAt: '2026-04-08T09:05:00.000Z',
          };
        },
        async save(cursor) {
          return cursor;
        },
      },
      dirtyScopeStore: {
        async upsertPending(scope) {
          dirtyScopes.push(scope);
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
      },
      orgRebuildRunner: {
        async runOrganizationRebuild() {
          throw new Error('should not dispatch during scan-only test');
        },
      },
    });

    const scanResult = await useCases.scanSource({
      sourceName: 'erp.receivables',
    });

    console.log(JSON.stringify({
      scanCalls,
      dirtyScopes,
      scanResult,
    }));
  `);

  assert.equal(result.scanCalls.length, 1);
  assert.equal(result.scanCalls[0].cursor.cursorTime, '2026-04-08T09:00:00.000Z');
  assert.equal(result.scanCalls[0].cursor.cursorPk, '2');
  assert.equal(result.dirtyScopes.length, 2);
  assert.equal(result.scanResult.targetCursor.cursorTime, '2026-04-08T10:00:00.000Z');
  assert.equal(result.scanResult.targetCursor.cursorPk, '4');
});

test('Story 7.7 多条变更命中同一组织时必须只保留一个 pending dirty scope', async () => {
  const result = await runTsSnippet(`
    import incrementalModule from './src/application/graph-sync/incremental-use-cases.ts';

    const { createGraphSyncIncrementalUseCases } = incrementalModule;

    const storedScopes = new Map();

    const useCases = createGraphSyncIncrementalUseCases({
      sourceScanPort: {
        async scanSourceChanges(input) {
          return {
            changes: [
              {
                sourceName: input.sourceName,
                sourcePk: '3',
                scopeOrgId: 'org-1',
                reason: 'payments-changed',
                cursorTime: '2026-04-08T10:00:00.000Z',
                cursorPk: '3',
              },
              {
                sourceName: input.sourceName,
                sourcePk: '8',
                scopeOrgId: 'org-1',
                reason: 'payments-changed',
                cursorTime: '2026-04-08T10:05:00.000Z',
                cursorPk: '8',
              },
            ],
            diagnostics: [],
          };
        },
      },
      cursorStore: {
        async getBySourceName() {
          return null;
        },
        async save(cursor) {
          return cursor;
        },
      },
      dirtyScopeStore: {
        async upsertPending(scope) {
          const key = scope.scopeType + ':' + scope.scopeKey;
          const existing = storedScopes.get(key);
          if (!existing) {
            storedScopes.set(key, scope);
            return scope;
          }

          const merged = {
            ...existing,
            reason: scope.reason,
            sourceName: scope.sourceName,
            sourcePk: scope.sourcePk,
            lastDetectedAt: scope.lastDetectedAt,
            sourceProgress: {
              ...existing.sourceProgress,
              ...scope.sourceProgress,
            },
          };
          storedScopes.set(key, merged);
          return merged;
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
      },
      orgRebuildRunner: {
        async runOrganizationRebuild() {
          throw new Error('should not dispatch during scan-only test');
        },
      },
    });

    const scanResult = await useCases.scanSource({
      sourceName: 'erp.payments',
    });

    console.log(JSON.stringify({
      scanResult,
      dirtyScopes: [...storedScopes.values()],
    }));
  `);

  assert.equal(result.dirtyScopes.length, 1);
  assert.equal(result.dirtyScopes[0].scopeKey, 'org-1');
  assert.equal(result.dirtyScopes[0].sourceProgress['erp.payments'].cursorPk, '8');
  assert.equal(result.scanResult.dirtyScopeCount, 1);
});

test('Story 7.7 dirty scope 全部成功消费后才推进 cursor，且 dispatcher 调用组织级 org-rebuild', async () => {
  const result = await runTsSnippet(`
    import incrementalModule from './src/application/graph-sync/incremental-use-cases.ts';

    const { createGraphSyncIncrementalUseCases } = incrementalModule;

    const rebuiltOrganizations = [];
    const savedCursors = [];
    const scopeStates = [];

    const useCases = createGraphSyncIncrementalUseCases({
      sourceScanPort: {
        async scanSourceChanges(input) {
          return {
            changes: [
              {
                sourceName: input.sourceName,
                sourcePk: '3',
                scopeOrgId: 'org-1',
                reason: 'owners-changed',
                cursorTime: '2026-04-08T10:00:00.000Z',
                cursorPk: '3',
              },
              {
                sourceName: input.sourceName,
                sourcePk: '5',
                scopeOrgId: 'org-2',
                reason: 'owners-changed',
                cursorTime: '2026-04-08T10:10:00.000Z',
                cursorPk: '5',
              },
            ],
            diagnostics: [],
          };
        },
      },
      cursorStore: {
        async getBySourceName() {
          return null;
        },
        async save(cursor) {
          savedCursors.push(cursor);
          return cursor;
        },
      },
      dirtyScopeStore: {
        scopes: [],
        async upsertPending(scope) {
          this.scopes.push({
            ...scope,
            status: 'pending',
            attemptCount: 0,
            lastRunId: null,
          });
          return scope;
        },
        async listDispatchableBySource(sourceName) {
          return this.scopes.filter((scope) =>
            ['pending', 'failed'].includes(scope.status) && scope.sourceProgress[sourceName],
          );
        },
        async markProcessing(scope) {
          scope.status = 'processing';
          scope.attemptCount += 1;
          scopeStates.push({ scopeKey: scope.scopeKey, status: scope.status, attemptCount: scope.attemptCount });
          return scope;
        },
        async markCompleted(scope, input) {
          scope.status = 'completed';
          scope.lastRunId = input.lastRunId;
          scopeStates.push({ scopeKey: scope.scopeKey, status: scope.status, lastRunId: scope.lastRunId });
          return scope;
        },
        async markFailed(scope, input) {
          scope.status = 'failed';
          scope.lastRunId = input.lastRunId ?? null;
          scopeStates.push({ scopeKey: scope.scopeKey, status: scope.status, lastRunId: scope.lastRunId });
          return scope;
        },
      },
      orgRebuildRunner: {
        async runOrganizationRebuild(input) {
          rebuiltOrganizations.push(input.organizationId);
          return {
            run: {
              id: 'run-' + input.organizationId,
            },
          };
        },
      },
    });

    const result = await useCases.runIncrementalSource({
      sourceName: 'erp.owners',
      triggeredBy: 'test-suite',
      triggerType: 'scheduler',
    });

    console.log(JSON.stringify({
      result,
      rebuiltOrganizations,
      savedCursors,
      scopeStates,
    }));
  `);

  assert.deepEqual(result.rebuiltOrganizations, ['org-1', 'org-2']);
  assert.equal(result.savedCursors.length, 1);
  assert.equal(result.savedCursors[0].sourceName, 'erp.owners');
  assert.equal(result.savedCursors[0].cursorPk, '5');
});

test('Story 7.7 任一组织 rebuild 失败时 dirty scope 保持 failed，cursor 不得前移', async () => {
  const result = await runTsSnippet(`
    import incrementalModule from './src/application/graph-sync/incremental-use-cases.ts';

    const { createGraphSyncIncrementalUseCases } = incrementalModule;

    const savedCursors = [];
    const scopeStates = [];

    const useCases = createGraphSyncIncrementalUseCases({
      sourceScanPort: {
        async scanSourceChanges(input) {
          return {
            changes: [
              {
                sourceName: input.sourceName,
                sourcePk: '11',
                scopeOrgId: 'org-1',
                reason: 'service-orders-changed',
                cursorTime: '2026-04-08T11:00:00.000Z',
                cursorPk: '11',
              },
            ],
            diagnostics: [],
          };
        },
      },
      cursorStore: {
        async getBySourceName() {
          return null;
        },
        async save(cursor) {
          savedCursors.push(cursor);
          return cursor;
        },
      },
      dirtyScopeStore: {
        scopes: [],
        async upsertPending(scope) {
          this.scopes.push({
            ...scope,
            status: 'pending',
            attemptCount: 0,
            lastRunId: null,
          });
          return scope;
        },
        async listDispatchableBySource(sourceName) {
          return this.scopes.filter((scope) =>
            ['pending', 'failed'].includes(scope.status) && scope.sourceProgress[sourceName],
          );
        },
        async markProcessing(scope) {
          scope.status = 'processing';
          scope.attemptCount += 1;
          scopeStates.push({ scopeKey: scope.scopeKey, status: scope.status, attemptCount: scope.attemptCount });
          return scope;
        },
        async markCompleted(scope, input) {
          scope.status = 'completed';
          scope.lastRunId = input.lastRunId;
          scopeStates.push({ scopeKey: scope.scopeKey, status: scope.status, lastRunId: scope.lastRunId });
          return scope;
        },
        async markFailed(scope, input) {
          scope.status = 'failed';
          scope.lastRunId = input.lastRunId ?? null;
          scopeStates.push({ scopeKey: scope.scopeKey, status: scope.status, lastRunId: scope.lastRunId });
          return scope;
        },
      },
      orgRebuildRunner: {
        async runOrganizationRebuild() {
          throw new Error('neo4j rebuild failed');
        },
      },
    });

    const output = await useCases.runIncrementalSource({
      sourceName: 'erp.service_orders',
      triggeredBy: 'test-suite',
      triggerType: 'scheduler',
    });

    console.log(JSON.stringify({
      output,
      savedCursors,
      scopeStates,
    }));
  `);

  assert.equal(result.output.cursorAdvanced, false);
  assert.equal(result.savedCursors.length, 0);
  assert.equal(result.scopeStates.at(-1).status, 'failed');
});

test('Story 7.7 存在无法提取 organizationId 的变更时不得把 cursor 前移到该记录之后', async () => {
  const result = await runTsSnippet(`
    import incrementalModule from './src/application/graph-sync/incremental-use-cases.ts';

    const { createGraphSyncIncrementalUseCases } = incrementalModule;

    const savedCursors = [];
    const dirtyScopes = [];
    const rebuilds = [];

    const useCases = createGraphSyncIncrementalUseCases({
      sourceScanPort: {
        async scanSourceChanges(input) {
          return {
            changes: [
              {
                sourceName: input.sourceName,
                sourcePk: '10',
                scopeOrgId: null,
                reason: 'charge-items-changed',
                cursorTime: '2026-04-08T12:00:00.000Z',
                cursorPk: '10',
              },
              {
                sourceName: input.sourceName,
                sourcePk: '11',
                scopeOrgId: 'org-2',
                reason: 'charge-items-changed',
                cursorTime: '2026-04-08T12:05:00.000Z',
                cursorPk: '11',
              },
            ],
            diagnostics: [],
          };
        },
      },
      cursorStore: {
        async getBySourceName() {
          return null;
        },
        async save(cursor) {
          savedCursors.push(cursor);
          return cursor;
        },
      },
      dirtyScopeStore: {
        async upsertPending(scope) {
          dirtyScopes.push(scope);
          return scope;
        },
        async listDispatchableBySource() {
          return dirtyScopes;
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
      },
      orgRebuildRunner: {
        async runOrganizationRebuild(input) {
          rebuilds.push(input.organizationId);
          return {
            run: {
              id: 'run-' + input.organizationId,
            },
          };
        },
      },
    });

    const output = await useCases.runIncrementalSource({
      sourceName: 'erp.charge_items',
      triggeredBy: 'test-suite',
      triggerType: 'scheduler',
    });

    console.log(JSON.stringify({
      output,
      savedCursors,
      dirtyScopes,
      rebuilds,
    }));
  `);

  assert.equal(result.output.cursorAdvanced, false);
  assert.equal(result.savedCursors.length, 0);
  assert.equal(result.dirtyScopes.length, 0);
  assert.deepEqual(result.rebuilds, []);
  assert.match(result.output.diagnostics[0], /organizationId/i);
});

test('Story 7.7 null timestamp 退化扫描必须返回可收敛的复合游标', async () => {
  const result = await runTsSnippet(`
    import scanPortModule from './src/infrastructure/graph-sync/postgres-graph-sync-source-scan-port.ts';

    const { createPostgresGraphSyncSourceScanPort } = scanPortModule;

    let capturedQuery = null;
    let capturedParams = null;

    const port = createPostgresGraphSyncSourceScanPort({
      pool: {
        async query(query, params) {
          capturedQuery = query;
          capturedParams = params;
          return {
            rows: [
              {
                source_pk: '42',
                scope_org_id: 'org-42',
                cursor_time: new Date('9999-12-31T23:59:59.999Z'),
                raw_cursor_time: null,
              },
            ],
          };
        },
      },
    });

    const output = await port.scanSourceChanges({
      sourceName: 'erp.receivables',
      cursor: {
        cursorTime: '2026-04-08T09:00:00.000Z',
        cursorPk: '2',
      },
    });

    console.log(JSON.stringify({
      output,
      capturedQuery,
      capturedParams,
    }));
  `);

  assert.match(result.capturedQuery, /9999-12-31 23:59:59\.999\+00/);
  assert.equal(result.capturedParams[0], '2026-04-08T09:00:00.000Z');
  assert.equal(result.output.changes[0].cursorTime, '9999-12-31T23:59:59.999Z');
  assert.match(result.output.diagnostics[0], /退化为主键窗口扫描/);
});

test('Story 7.7 dirty scope pending upsert 在唯一键竞争时必须回退为读取并合并', async () => {
  const result = await runTsSnippet(`
    import dirtyScopeStoreModule from './src/infrastructure/graph-sync/postgres-graph-sync-dirty-scope-store.ts';

    const { createPostgresGraphSyncDirtyScopeStore } = dirtyScopeStoreModule;

    let selectCount = 0;
    let updatePayload = null;

    const pendingRow = {
      id: 'scope-1',
      scopeType: 'organization',
      scopeKey: 'org-1',
      reason: 'payments-changed',
      sourceName: 'erp.payments',
      sourcePk: '3',
      sourceProgress: {
        'erp.payments': {
          cursorTime: '2026-04-08T10:00:00.000Z',
          cursorPk: '3',
          sourcePk: '3',
          reason: 'payments-changed',
        },
      },
      firstDetectedAt: new Date('2026-04-08T10:00:00.000Z'),
      lastDetectedAt: new Date('2026-04-08T10:00:00.000Z'),
      status: 'pending',
      attemptCount: 0,
      lastRunId: null,
    };

    const db = {
      select() {
        return {
          from() {
            return {
              async where() {
                selectCount += 1;
                return selectCount === 1 ? [] : [pendingRow];
              },
            };
          },
        };
      },
      insert() {
        return {
          values() {
            return {
              async returning() {
                const error = new Error('duplicate key');
                error.code = '23505';
                throw error;
              },
            };
          },
        };
      },
      update() {
        return {
          set(payload) {
            updatePayload = payload;
            return {
              where() {
                return {
                  async returning() {
                    return [
                      {
                        ...pendingRow,
                        ...payload,
                        firstDetectedAt: pendingRow.firstDetectedAt,
                        lastDetectedAt: payload.lastDetectedAt,
                      },
                    ];
                  },
                };
              },
            };
          },
        };
      },
    };

    const store = createPostgresGraphSyncDirtyScopeStore(db);

    const output = await store.upsertPending({
      id: 'scope-2',
      scopeType: 'organization',
      scopeKey: 'org-1',
      reason: 'payments-changed',
      sourceName: 'erp.payments',
      sourcePk: '8',
      sourceProgress: {
        'erp.payments': {
          cursorTime: '2026-04-08T10:05:00.000Z',
          cursorPk: '8',
          sourcePk: '8',
          reason: 'payments-changed',
        },
      },
      firstDetectedAt: '2026-04-08T10:05:00.000Z',
      lastDetectedAt: '2026-04-08T10:05:00.000Z',
      status: 'pending',
      attemptCount: 0,
      lastRunId: null,
    });

    console.log(JSON.stringify({
      output,
      selectCount,
      updatePayload,
    }));
  `);

  assert.equal(result.selectCount, 2);
  assert.equal(result.output.scopeKey, 'org-1');
  assert.equal(result.output.sourceProgress['erp.payments'].cursorPk, '8');
  assert.equal(result.updatePayload.sourceProgress['erp.payments'].cursorPk, '8');
});
