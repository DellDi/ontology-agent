import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

async function runTsSnippet(code) {
  const { stdout } = await execFileAsync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', code],
    {
      cwd: projectRoot,
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--conditions=react-server']
          .filter(Boolean)
          .join(' '),
      },
    },
  );

  const trimmed = stdout.trim();
  if (!trimmed) return null;
  return JSON.parse(trimmed.split('\n').pop() ?? 'null');
}

const PROJECTION_IMPORT = `
  import projectionModule from './src/application/analysis-message-projection/index.ts';
  import runtimeModule from './src/application/ai-runtime/index.ts';
  const {
    createAnalysisUiMessageProjectionUseCases,
    filterAnalysisUiMessageProjectionResumeEvents,
  } = projectionModule;
  const {
    AI_RUNTIME_CONTRACT_VERSION,
    AI_RUNTIME_SCHEMA_VERSION,
    buildAiRuntimeProjection,
    mergeAnalysisExecutionStreamEvents,
  } = runtimeModule;
`;

const POSTGRES_IMPORT = `
  import schemaModule from './src/infrastructure/postgres/schema/index.ts';
  import storeModule from './src/infrastructure/analysis-message-projection/postgres-analysis-ui-message-projection-store.ts';
  const { analysisUiMessageProjections } = schemaModule;
  const { createPostgresAnalysisUiMessageProjectionStore } = storeModule;
`;

const DISPLAY_IMPORT = `
  import displayModule from './src/app/(workspace)/workspace/analysis/[sessionId]/analysis-execution-display.ts';
  const {
    buildAnalysisExecutionStreamUrl,
    resolvePlanSnapshotForDisplay,
    resolveExecutionProjectionDisplaySelection,
  } = displayModule;
`;

const STREAM_IMPORT = `
  import streamModule from './src/application/analysis-execution/stream-use-cases.ts';
  const { resolveAnalysisExecutionStreamAccess } = streamModule;
`;

function buildEvents({ sessionId = 'session-10-3', executionId = 'exec-10-3' } = {}) {
  return [
    {
      id: 'evt-1',
      sessionId,
      executionId,
      sequence: 1,
      kind: 'execution-status',
      timestamp: '2026-05-05T00:00:00.000Z',
      status: 'processing',
      message: '开始恢复测试',
      renderBlocks: [],
    },
    {
      id: 'evt-2',
      sessionId,
      executionId,
      sequence: 2,
      kind: 'stage-result',
      timestamp: '2026-05-05T00:00:01.000Z',
      message: '阶段结果',
      step: {
        id: 'step-1',
        order: 1,
        title: '校验收费口径',
        status: 'completed',
      },
      renderBlocks: [
        {
          type: 'markdown',
          title: '阶段摘要',
          content: '收费口径已校验。',
        },
      ],
    },
  ];
}

test('Story 10.3 AC1/AC2 | 持久化 projection 可按 owner/session/round hydrate，并保留 message、part 与 stream cursor', async () => {
  const events = buildEvents();
  const result = await runTsSnippet(`
    ${PROJECTION_IMPORT}
    const records = [];
    const projectionStore = {
      async save(record) {
        const existingIndex = records.findIndex((item) => item.id === record.id);
        if (existingIndex >= 0) records.splice(existingIndex, 1, record);
        else records.push(record);
        return record;
      },
      async getByScope(scope) {
        return records.find((record) =>
          record.ownerUserId === scope.ownerUserId &&
          record.sessionId === scope.sessionId &&
          record.executionId === scope.executionId &&
          record.followUpId === (scope.followUpId ?? null) &&
          record.historyRoundId === (scope.historyRoundId ?? null)
        ) ?? null;
      },
    };
    const useCases = createAnalysisUiMessageProjectionUseCases({ projectionStore });
    const projection = buildAiRuntimeProjection({
      sessionId: 'session-10-3',
      executionId: 'exec-10-3',
      events: ${JSON.stringify(events)},
    });
    await useCases.saveProjection({
      ownerUserId: 'owner-10-3',
      followUpId: null,
      historyRoundId: 'session-root',
      projection,
      recoveryMetadata: { source: 'live-stream' },
    });
    const hydrated = await useCases.hydrateProjection({
      ownerUserId: 'owner-10-3',
      sessionId: 'session-10-3',
      executionId: 'exec-10-3',
      followUpId: null,
      historyRoundId: 'session-root',
      canonical: {
        events: [],
        fallbackConclusion: null,
      },
    });
    console.log(JSON.stringify({
      source: hydrated?.source,
      lastSequence: hydrated?.resumeCursor.lastSequence,
      messageCount: hydrated?.projection.messages.length,
      partKinds: hydrated?.projection.messages[0].parts.map((part) => part.kind),
      schemaVersion: hydrated?.record.partSchemaVersion,
      contractVersion: hydrated?.record.contractVersion,
      storeSize: records.length,
    }));
  `);

  assert.equal(result.source, 'persisted');
  assert.equal(result.lastSequence, 2);
  assert.equal(result.messageCount, 1);
  assert.deepEqual(result.partKinds, [
    'status-banner',
    'step-timeline',
    'evidence-card',
    'conclusion-card',
    'resume-anchor',
  ]);
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.contractVersion, 1);
  assert.equal(result.storeSize, 1);
});

test('Story 10.3 AC3 | projection 版本不匹配时必须从 canonical truth 重建并回写，不得沿用旧 message', async () => {
  const events = buildEvents();
  const result = await runTsSnippet(`
    ${PROJECTION_IMPORT}
    const records = [{
      id: 'legacy-record',
      sessionId: 'session-10-3',
      ownerUserId: 'owner-10-3',
      executionId: 'exec-10-3',
      followUpId: null,
      historyRoundId: 'session-root',
      projectionVersion: 1,
      partSchemaVersion: 999,
      contractVersion: AI_RUNTIME_CONTRACT_VERSION,
      streamCursor: { lastSequence: 999, lastEventId: 'legacy-event' },
      messages: [
        {
          id: 'legacy-message',
          role: 'assistant',
          parts: [{ id: 'legacy-part', kind: 'legacy-kind' }],
          createdAt: '2026-05-04T00:00:00.000Z',
          updatedAt: '2026-05-04T00:00:00.000Z',
        },
      ],
      recoveryMetadata: { source: 'legacy' },
      createdAt: '2026-05-04T00:00:00.000Z',
      updatedAt: '2026-05-04T00:00:00.000Z',
    }];
    const projectionStore = {
      async save(record) {
        records.splice(0, records.length, record);
        return record;
      },
      async getByScope() {
        return records[0] ?? null;
      },
    };
    const useCases = createAnalysisUiMessageProjectionUseCases({ projectionStore });
    const hydrated = await useCases.hydrateProjection({
      ownerUserId: 'owner-10-3',
      sessionId: 'session-10-3',
      executionId: 'exec-10-3',
      followUpId: null,
      historyRoundId: 'session-root',
      canonical: {
        events: ${JSON.stringify(events)},
        fallbackConclusion: null,
      },
    });
    console.log(JSON.stringify({
      source: hydrated?.source,
      rebuildReason: hydrated?.rebuildReason,
      lastSequence: hydrated?.projection.lastSequence,
      persistedLastSequence: records[0].streamCursor.lastSequence,
      hasLegacyPart: hydrated?.projection.messages.some((message) =>
        message.parts.some((part) => part.kind === 'legacy-kind')
      ),
      partSchemaVersion: records[0].partSchemaVersion,
    }));
  `);

  assert.equal(result.source, 'rebuilt-from-canonical');
  assert.match(result.rebuildReason, /version/);
  assert.equal(result.lastSequence, 2);
  assert.equal(result.persistedLastSequence, 2);
  assert.equal(result.hasLegacyPart, false);
  assert.equal(result.partSchemaVersion, 1);
});

test('Story 10.3 AC3 | projection message tree 损坏时必须重建，不能把坏 projection 当作事实源', async () => {
  const events = buildEvents();
  const result = await runTsSnippet(`
    ${PROJECTION_IMPORT}
    const records = [{
      id: 'damaged-record',
      sessionId: 'session-10-3',
      ownerUserId: 'owner-10-3',
      executionId: 'exec-10-3',
      followUpId: null,
      historyRoundId: 'session-root',
      projectionVersion: 1,
      partSchemaVersion: AI_RUNTIME_SCHEMA_VERSION,
      contractVersion: AI_RUNTIME_CONTRACT_VERSION,
      status: 'processing',
      isTerminal: false,
      streamCursor: { lastSequence: 2, lastEventId: 'evt-2' },
      messages: [
        {
          id: 'damaged-message',
          role: 'assistant',
          parts: 'not-an-array',
          createdAt: '2026-05-04T00:00:00.000Z',
          updatedAt: '2026-05-04T00:00:00.000Z',
        },
      ],
      recoveryMetadata: { source: 'damaged' },
      createdAt: '2026-05-04T00:00:00.000Z',
      updatedAt: '2026-05-04T00:00:00.000Z',
    }];
    const projectionStore = {
      async save(record) {
        records.splice(0, records.length, record);
        return record;
      },
      async getByScope() {
        return records[0] ?? null;
      },
    };
    const useCases = createAnalysisUiMessageProjectionUseCases({ projectionStore });
    const hydrated = await useCases.hydrateProjection({
      ownerUserId: 'owner-10-3',
      sessionId: 'session-10-3',
      executionId: 'exec-10-3',
      followUpId: null,
      historyRoundId: 'session-root',
      canonical: {
        events: ${JSON.stringify(events)},
        fallbackConclusion: null,
      },
    });
    console.log(JSON.stringify({
      source: hydrated?.source,
      rebuildReason: hydrated?.rebuildReason,
      firstMessageId: hydrated?.projection.messages[0].id,
      partsIsArray: Array.isArray(records[0].messages[0].parts),
    }));
  `);

  assert.equal(result.source, 'rebuilt-from-canonical');
  assert.match(result.rebuildReason, /message.*parts/);
  assert.notEqual(result.firstMessageId, 'damaged-message');
  assert.equal(result.partsIsArray, true);
});

test('Story 10.3 AC4/AC6 | projection scope mismatch 必须 fail loud，历史轮次 projection 互不覆盖', async () => {
  const events = buildEvents();
  const result = await runTsSnippet(`
    ${PROJECTION_IMPORT}
    const records = [];
    const projectionStore = {
      async save(record) {
        const existingIndex = records.findIndex((item) => item.id === record.id);
        if (existingIndex >= 0) records.splice(existingIndex, 1, record);
        else records.push(record);
        return record;
      },
      async getByScope(scope) {
        return records.find((record) =>
          record.sessionId === scope.sessionId &&
          record.executionId === scope.executionId &&
          record.followUpId === (scope.followUpId ?? null) &&
          record.historyRoundId === (scope.historyRoundId ?? null)
        ) ?? null;
      },
    };
    const useCases = createAnalysisUiMessageProjectionUseCases({ projectionStore });
    const rootProjection = buildAiRuntimeProjection({
      sessionId: 'session-10-3',
      executionId: 'exec-root',
      events: ${JSON.stringify(buildEvents({ executionId: 'exec-root' }))},
    });
    const followUpProjection = buildAiRuntimeProjection({
      sessionId: 'session-10-3',
      executionId: 'exec-follow-up',
      events: ${JSON.stringify(buildEvents({ executionId: 'exec-follow-up' }))},
    });
    await useCases.saveProjection({
      ownerUserId: 'owner-10-3',
      followUpId: null,
      historyRoundId: 'session-root',
      projection: rootProjection,
    });
    await useCases.saveProjection({
      ownerUserId: 'owner-10-3',
      followUpId: 'follow-up-1',
      historyRoundId: 'follow-up-1',
      projection: followUpProjection,
    });

    const root = await useCases.hydrateProjection({
      ownerUserId: 'owner-10-3',
      sessionId: 'session-10-3',
      executionId: 'exec-root',
      followUpId: null,
      historyRoundId: 'session-root',
      canonical: { events: ${JSON.stringify(events)}, fallbackConclusion: null },
    });
    const followUp = await useCases.hydrateProjection({
      ownerUserId: 'owner-10-3',
      sessionId: 'session-10-3',
      executionId: 'exec-follow-up',
      followUpId: 'follow-up-1',
      historyRoundId: 'follow-up-1',
      canonical: { events: ${JSON.stringify(events)}, fallbackConclusion: null },
    });

    let mismatchError = '';
    try {
      await useCases.hydrateProjection({
        ownerUserId: 'foreign-owner',
        sessionId: 'session-10-3',
        executionId: 'exec-root',
        followUpId: null,
        historyRoundId: 'session-root',
        canonical: { events: ${JSON.stringify(events)}, fallbackConclusion: null },
      });
    } catch (error) {
      mismatchError = error.message;
    }

    console.log(JSON.stringify({
      rootExecutionId: root?.projection.executionId,
      followUpExecutionId: followUp?.projection.executionId,
      recordCount: records.length,
      ids: records.map((record) => record.id),
      mismatchError,
    }));
  `);

  assert.equal(result.rootExecutionId, 'exec-root');
  assert.equal(result.followUpExecutionId, 'exec-follow-up');
  assert.equal(result.recordCount, 2);
  assert.equal(new Set(result.ids).size, 2);
  assert.match(result.mismatchError, /projection scope mismatch/);
});

test('Story 10.3 AC5 | resume 续流按 cursor 与显式 sequence 去重，避免重复应用 message/part', async () => {
  const events = buildEvents();
  const result = await runTsSnippet(`
    ${PROJECTION_IMPORT}
    const events = ${JSON.stringify(events)};
    const pending = filterAnalysisUiMessageProjectionResumeEvents(events, {
      lastSequence: 1,
      lastEventId: 'evt-1',
    });
    let merged = [events[0]];
    merged = mergeAnalysisExecutionStreamEvents(merged, {
      ...events[0],
      id: 'evt-1-duplicate-id',
    }, {
      sessionId: 'session-10-3',
      executionId: 'exec-10-3',
      deduplicateBySequence: true,
    });
    merged = mergeAnalysisExecutionStreamEvents(merged, events[1], {
      sessionId: 'session-10-3',
      executionId: 'exec-10-3',
    });
    console.log(JSON.stringify({
      pendingSequences: pending.map((event) => event.sequence),
      mergedIds: merged.map((event) => event.id),
      mergedSequences: merged.map((event) => event.sequence),
    }));
  `);

  assert.deepEqual(result.pendingSequences, [2]);
  assert.deepEqual(result.mergedSequences, [1, 2]);
  assert.deepEqual(result.mergedIds, ['evt-1', 'evt-2']);
});

test('Story 10.3 Review | 默认 event merge 只按 id 去重，sequence 去重仅限 resume 显式开启', async () => {
  const events = buildEvents();
  const result = await runTsSnippet(`
    ${PROJECTION_IMPORT}
    const events = ${JSON.stringify(events)};
    const sameSequenceDifferentId = {
      ...events[0],
      id: 'evt-1-replayed-with-new-id',
      message: 'same sequence, different envelope',
    };
    const defaultMerged = mergeAnalysisExecutionStreamEvents(
      [events[0]],
      sameSequenceDifferentId,
      { sessionId: 'session-10-3', executionId: 'exec-10-3' },
    );
    const resumeMerged = mergeAnalysisExecutionStreamEvents(
      [events[0]],
      sameSequenceDifferentId,
      {
        sessionId: 'session-10-3',
        executionId: 'exec-10-3',
        deduplicateBySequence: true,
      },
    );
    console.log(JSON.stringify({
      defaultCount: defaultMerged.length,
      resumeCount: resumeMerged.length,
      defaultIds: defaultMerged.map((event) => event.id),
      resumeIds: resumeMerged.map((event) => event.id),
    }));
  `);

  assert.equal(result.defaultCount, 2);
  assert.equal(result.resumeCount, 1);
  assert.deepEqual(result.defaultIds, ['evt-1', 'evt-1-replayed-with-new-id']);
  assert.deepEqual(result.resumeIds, ['evt-1']);
});

test('Story 10.3 AC1/AC6 | Postgres schema 与 store 暴露 projection 表、owner/session 索引和 scope 查询契约', async () => {
  const result = await runTsSnippet(`
    ${POSTGRES_IMPORT}
    const tableConfig = analysisUiMessageProjections[Symbol.for('drizzle:Name')] ?? analysisUiMessageProjections._?.name;
    const store = createPostgresAnalysisUiMessageProjectionStore({
      select() {
        return {
          from() {
            return {
              where() {
                return {
                  limit() {
                    return Promise.resolve([]);
                  },
                };
              },
            };
          },
        };
      },
      insert() {
        return {
          values() {
            return {
              onConflictDoUpdate() {
                return Promise.resolve();
              },
            };
          },
        };
      },
    });
    console.log(JSON.stringify({
      tableName: tableConfig,
      hasSave: typeof store.save === 'function',
      hasGetByScope: typeof store.getByScope === 'function',
      hasOwnerUserId: Boolean(analysisUiMessageProjections.ownerUserId),
      hasSessionId: Boolean(analysisUiMessageProjections.sessionId),
      hasExecutionId: Boolean(analysisUiMessageProjections.executionId),
      hasHistoryRoundId: Boolean(analysisUiMessageProjections.historyRoundId),
      hasStreamCursor: Boolean(analysisUiMessageProjections.streamCursor),
    }));
  `);

  assert.equal(result.tableName, 'analysis_ui_message_projections');
  assert.equal(result.hasSave, true);
  assert.equal(result.hasGetByScope, true);
  assert.equal(result.hasOwnerUserId, true);
  assert.equal(result.hasSessionId, true);
  assert.equal(result.hasExecutionId, true);
  assert.equal(result.hasHistoryRoundId, true);
  assert.equal(result.hasStreamCursor, true);
});

test('Story 10.3 AC2/AC4 | historyRoundId 切换主 projection 轮次，且历史回放不续写 live stream', async () => {
  const result = await runTsSnippet(`
    ${DISPLAY_IMPORT}
    const snapshots = [
      {
        executionId: 'exec-root',
        sessionId: 'session-10-3',
        ownerUserId: 'owner-10-3',
        followUpId: null,
        status: 'completed',
        stepResults: [],
        conclusionState: { causes: [], renderBlocks: [] },
        planSnapshot: { mode: 'minimal', summary: 'root plan', steps: [] },
      },
      {
        executionId: 'exec-follow-up',
        sessionId: 'session-10-3',
        ownerUserId: 'owner-10-3',
        followUpId: 'follow-up-1',
        status: 'completed',
        stepResults: [],
        conclusionState: { causes: [], renderBlocks: [] },
        planSnapshot: { mode: 'minimal', summary: 'follow-up plan', steps: [] },
      },
    ];
    const selectedRoot = {
      id: 'session-root',
      followUpId: null,
      executionId: 'exec-root',
      isLatest: false,
    };
    const historySelection = resolveExecutionProjectionDisplaySelection({
      requestedExecutionIdForDisplay: '',
      sessionScopedRequestedExecutionSnapshot: null,
      latestExecutionSnapshot: snapshots[1],
      sessionSnapshots: snapshots,
      selectedHistoryRound: selectedRoot,
    });
    const normalSelection = resolveExecutionProjectionDisplaySelection({
      requestedExecutionIdForDisplay: '',
      sessionScopedRequestedExecutionSnapshot: null,
      latestExecutionSnapshot: snapshots[1],
      sessionSnapshots: snapshots,
      selectedHistoryRound: null,
    });
    console.log(JSON.stringify({
      historyExecutionId: historySelection.resolvedExecutionId,
      historyRoundId: historySelection.historyRoundIdForProjection,
      historyFollowUpId: historySelection.followUpIdForProjection,
      historyLiveStream: historySelection.enableLiveStream,
      normalExecutionId: normalSelection.resolvedExecutionId,
      normalHistoryRoundId: normalSelection.historyRoundIdForProjection,
      normalLiveStream: normalSelection.enableLiveStream,
    }));
  `);

  assert.equal(result.historyExecutionId, 'exec-root');
  assert.equal(result.historyRoundId, 'session-root');
  assert.equal(result.historyFollowUpId, null);
  assert.equal(result.historyLiveStream, false);
  assert.equal(result.normalExecutionId, 'exec-follow-up');
  assert.equal(result.normalHistoryRoundId, 'follow-up-1');
  assert.equal(result.normalLiveStream, true);
});

test('Story 10.3 AC5 | live stream URL 携带 projection cursor，服务端可从确认 sequence 之后续流', async () => {
  const result = await runTsSnippet(`
    ${DISPLAY_IMPORT}
    const url = buildAnalysisExecutionStreamUrl({
      sessionId: 'session-10-3',
      executionId: 'exec-10-3',
      resumeCursor: { lastSequence: 12, lastEventId: 'evt-12' },
    });
    const parsed = new URL(url, 'http://127.0.0.1');
    console.log(JSON.stringify({
      pathname: parsed.pathname,
      executionId: parsed.searchParams.get('executionId'),
      afterSequence: parsed.searchParams.get('afterSequence'),
    }));
  `);

  assert.equal(
    result.pathname,
    '/api/analysis/sessions/session-10-3/stream',
  );
  assert.equal(result.executionId, 'exec-10-3');
  assert.equal(result.afterSequence, '12');
});

test('Story 10.3 Review | follow-up 普通视图优先展示当前 follow-up plan，历史回放优先展示选中快照 plan', async () => {
  const result = await runTsSnippet(`
    ${DISPLAY_IMPORT}
    const activeFollowUpPlan = {
      mode: 'minimal',
      summary: 'active follow-up plan',
      steps: [],
    };
    const selectedSnapshot = {
      executionId: 'exec-follow-up',
      sessionId: 'session-10-3',
      ownerUserId: 'owner-10-3',
      followUpId: 'follow-up-1',
      status: 'completed',
      stepResults: [],
      conclusionState: { causes: [], renderBlocks: [] },
      planSnapshot: {
        mode: 'minimal',
        summary: 'persisted execution snapshot plan',
        steps: [],
      },
    };
    const normalPlan = resolvePlanSnapshotForDisplay({
      sessionScopedRequestedExecutionSnapshot: null,
      requestedExecutionJob: null,
      activeFollowUpPlanSnapshot: activeFollowUpPlan,
      snapshotForDisplay: selectedSnapshot,
      isHistoryReplay: false,
    });
    const historyPlan = resolvePlanSnapshotForDisplay({
      sessionScopedRequestedExecutionSnapshot: null,
      requestedExecutionJob: null,
      activeFollowUpPlanSnapshot: activeFollowUpPlan,
      snapshotForDisplay: selectedSnapshot,
      isHistoryReplay: true,
    });
    console.log(JSON.stringify({
      normalPlanSummary: normalPlan?.summary,
      historyPlanSummary: historyPlan?.summary,
    }));
  `);

  assert.equal(result.normalPlanSummary, 'active follow-up plan');
  assert.equal(result.historyPlanSummary, 'persisted execution snapshot plan');
});

test('Story 10.3 Review | stream access 必须显式确认 execution 属于当前 owner/session', async () => {
  const result = await runTsSnippet(`
    ${STREAM_IMPORT}
    const allowedBySnapshot = resolveAnalysisExecutionStreamAccess({
      sessionId: 'session-10-3',
      ownerUserId: 'owner-10-3',
      executionId: 'exec-10-3',
      snapshot: {
        sessionId: 'session-10-3',
        ownerUserId: 'owner-10-3',
        executionId: 'exec-10-3',
      },
      job: null,
    });
    const deniedForeignSnapshot = resolveAnalysisExecutionStreamAccess({
      sessionId: 'session-10-3',
      ownerUserId: 'owner-10-3',
      executionId: 'exec-10-3',
      snapshot: {
        sessionId: 'foreign-session',
        ownerUserId: 'owner-10-3',
        executionId: 'exec-10-3',
      },
      job: null,
    });
    const allowedByLiveJob = resolveAnalysisExecutionStreamAccess({
      sessionId: 'session-10-3',
      ownerUserId: 'owner-10-3',
      executionId: 'exec-live',
      snapshot: null,
      job: {
        id: 'exec-live',
        type: 'analysis-execution',
        status: 'queued',
        data: {
          sessionId: 'session-10-3',
          ownerUserId: 'owner-10-3',
          organizationId: 'org-10-3',
          projectIds: [],
          areaIds: [],
          followUpId: null,
          questionText: 'stream access check',
          submittedAt: '2026-05-05T00:00:00.000Z',
          plan: {
            mode: 'minimal',
            summary: 'plan',
            steps: [
              {
                id: 'step-1',
                order: 1,
                title: '校验',
                objective: '确认 execution 归属',
                dependencyIds: [],
              },
            ],
          },
        },
      },
    });
    console.log(JSON.stringify({
      allowedBySnapshot,
      deniedForeignSnapshot,
      allowedByLiveJob,
    }));
  `);

  assert.equal(result.allowedBySnapshot.allowed, true);
  assert.equal(result.allowedBySnapshot.source, 'snapshot');
  assert.equal(result.deniedForeignSnapshot.allowed, false);
  assert.equal(result.deniedForeignSnapshot.status, 404);
  assert.equal(result.allowedByLiveJob.allowed, true);
  assert.equal(result.allowedByLiveJob.source, 'job');
});
