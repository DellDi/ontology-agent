import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function loadInteractionSubjects() {
  return (await import('@/application/analysis-interaction')) as {
    buildAssumptionCardPart: (input: {
      assumptions: string[];
      title?: string;
      note?: string;
      source?: {
        sourceType: 'runtime-foundation-part' | 'conclusion-read-model';
        sessionId?: string;
        executionId?: string;
        eventId?: string;
        sequence?: number;
        blockIndex?: number;
      };
    }) => {
      kind: string;
      payload: Record<string, unknown>;
    };
    buildProcessBoardPart: (input: {
      sessionId: string;
      executionId: string;
      events: Array<Record<string, unknown>>;
    }) => {
      kind: string;
      payload: Record<string, unknown>;
    };
    normalizeExecutionRenderBlock: (
      block: Record<string, unknown>,
      source: {
        sourceType: 'execution-render-block';
        sessionId: string;
        executionId: string;
        eventId: string;
        sequence: number;
        blockIndex: number;
      },
    ) => {
      kind: string;
    };
  };
}

async function loadUiBehaviorSubjects() {
  const liveShellModule = (await import(
    '@/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-execution-live-shell'
  )) as {
    PROCESS_BOARD_STORAGE_KEY_PREFIX: string;
    buildProcessBoardStorageKey: (ownerUserId: string) => string;
    shouldRestoreProcessBoardOpenState: (persistedValue: string | null) => boolean;
    shouldCloseProcessBoardOnKeydown: (key: string) => boolean;
  };
  const autoExecuteGateModule = (await import(
    '@/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-auto-execute-gate'
  )) as {
    buildAnalysisAutoExecuteScopeKey: (
      sessionId: string,
      followUpId?: string,
    ) => string;
    buildAnalysisAutoExecuteAttemptStorageKey: (
      executionScopeKey: string,
    ) => string;
    resolveAnalysisAutoExecuteAttempt: (input: {
      enabled: boolean;
      lastSubmittedScope: string | null;
      executionScopeKey: string;
      sessionAttemptedValue: string | null;
    }) =>
      | 'skip-disabled'
      | 'skip-memory-dedup'
      | 'skip-session-dedup'
      | 'submit';
    submitAnalysisAutoExecuteForm: (formElement: {
      requestSubmit?: () => void;
      submit: () => void;
    }) => void;
  };

  return {
    ...liveShellModule,
    ...autoExecuteGateModule,
  };
}

test('Story 10.7 AC1/AC3 | reasoning-summary / process-board / assumption-card 已落成正式 interaction parts', async () => {
  const {
    buildAssumptionCardPart,
    buildProcessBoardPart,
    normalizeExecutionRenderBlock,
  } = await loadInteractionSubjects();

  const reasoningSummary = normalizeExecutionRenderBlock(
    {
      type: 'markdown',
      title: '阶段说明',
      content: '阶段推进原因说明。',
    },
    {
      sourceType: 'execution-render-block',
      sessionId: 'session-10-7',
      executionId: 'exec-10-7',
      eventId: 'evt-reasoning',
      sequence: 3,
      blockIndex: 0,
    },
  );

  const processBoard = buildProcessBoardPart({
    sessionId: 'session-10-7',
    executionId: 'exec-10-7',
    events: [
      {
        id: 'evt-1',
        sessionId: 'session-10-7',
        executionId: 'exec-10-7',
        sequence: 1,
        kind: 'stage-result',
        timestamp: '2026-05-12T10:00:00.000Z',
        step: {
          id: 'step-1',
          order: 1,
          title: '确认分析口径',
          status: 'completed',
        },
        renderBlocks: [
          {
            type: 'kv-list',
            title: '阶段结果',
            items: [{ label: '进度', value: '1 / 4 steps' }],
          },
        ],
        metadata: {
          processBoardProgress: {
            processed: 1,
            total: 4,
          },
        },
      },
    ],
  });

  const assumptionCard = buildAssumptionCardPart({
    assumptions: ['时间语义暂未完全治理化，先按当前问题中的时间范围继续执行。'],
    source: {
      sourceType: 'conclusion-read-model',
      eventId: 'conclusion-assumptions',
      blockIndex: 0,
    },
  });

  assert.equal(reasoningSummary.kind, 'reasoning-summary');
  assert.equal(processBoard.kind, 'process-board');
  assert.equal(assumptionCard.kind, 'assumption-card');
  assert.deepEqual(processBoard.payload.progress, {
    processed: 1,
    total: 4,
    percent: 25,
    label: '已完成 1/4 步',
  });
  assert.deepEqual(assumptionCard.payload.assumptions, [
    '时间语义暂未完全治理化，先按当前问题中的时间范围继续执行。',
  ]);
});

test('Story 10.7 AC3 | assumption-card 对空 assumptions fail loud，避免静默空卡片', async () => {
  const { buildAssumptionCardPart } = await loadInteractionSubjects();

  assert.throws(
    () =>
      buildAssumptionCardPart({
        assumptions: [],
      }),
    /assumption-card 至少需要一条 assumption/,
  );
});

test('Story 10.7 AC2/AC3 | 关键组件必须消费正式 helper，而不是继续手写 parse/hardcode', async () => {
  const [streamPanelSource, conclusionPanelSource] = await Promise.all([
    readFile(
      'src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-execution-stream-panel.tsx',
      'utf8',
    ),
    readFile(
      'src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-conclusion-panel.tsx',
      'utf8',
    ),
  ]);

  assert.doesNotMatch(streamPanelSource, /function parseProgressText/);
  assert.match(streamPanelSource, /buildProcessBoardPart/);
  assert.match(conclusionPanelSource, /buildAssumptionCardPart/);
  assert.doesNotMatch(conclusionPanelSource, /planAssumptions\?\.map/);
});

test('Story 10.7 AC2/AC3 | _executionAssumptions 必须被纳入正式 runtime annotation 约定', async () => {
  const analysisPlanModule = (await import('@/domain/analysis-plan/models')) as {
    ANALYSIS_PLAN_RUNTIME_ANNOTATION_FIELDS: readonly string[];
  };
  const architectureSource = await readFile(
    '_bmad-output/planning-artifacts/architecture.md',
    'utf8',
  );

  assert.ok(
    analysisPlanModule.ANALYSIS_PLAN_RUNTIME_ANNOTATION_FIELDS.includes(
      '_executionAssumptions',
    ),
  );
  assert.match(architectureSource, /下划线\s*=\s*运行时只读标注/);
});

test('Story 10.7 AC2 | 10.6 关键 UI 行为语义仍在源码中保留', async () => {
  const {
    PROCESS_BOARD_STORAGE_KEY_PREFIX,
    buildProcessBoardStorageKey,
    shouldRestoreProcessBoardOpenState,
    shouldCloseProcessBoardOnKeydown,
    buildAnalysisAutoExecuteScopeKey,
    buildAnalysisAutoExecuteAttemptStorageKey,
    resolveAnalysisAutoExecuteAttempt,
    submitAnalysisAutoExecuteForm,
  } = await loadUiBehaviorSubjects();

  assert.equal(PROCESS_BOARD_STORAGE_KEY_PREFIX, 'analysis-process-board-open-v2');
  assert.equal(
    buildProcessBoardStorageKey('user-1'),
    'analysis-process-board-open-v2:user-1',
  );
  assert.equal(shouldRestoreProcessBoardOpenState('1'), true);
  assert.equal(shouldRestoreProcessBoardOpenState('0'), false);
  assert.equal(shouldRestoreProcessBoardOpenState(null), false);
  assert.equal(shouldCloseProcessBoardOnKeydown('Escape'), true);
  assert.equal(shouldCloseProcessBoardOnKeydown('Enter'), false);

  assert.equal(
    buildAnalysisAutoExecuteScopeKey('session-10-7'),
    'session-10-7:root',
  );
  assert.equal(
    buildAnalysisAutoExecuteScopeKey('session-10-7', 'follow-up-1'),
    'session-10-7:follow-up-1',
  );
  assert.equal(
    buildAnalysisAutoExecuteAttemptStorageKey('session-10-7:follow-up-1'),
    'analysis-auto-execute-attempted:session-10-7:follow-up-1',
  );
  assert.equal(
    resolveAnalysisAutoExecuteAttempt({
      enabled: false,
      lastSubmittedScope: null,
      executionScopeKey: 'session-10-7:root',
      sessionAttemptedValue: null,
    }),
    'skip-disabled',
  );
  assert.equal(
    resolveAnalysisAutoExecuteAttempt({
      enabled: true,
      lastSubmittedScope: 'session-10-7:root',
      executionScopeKey: 'session-10-7:root',
      sessionAttemptedValue: null,
    }),
    'skip-memory-dedup',
  );
  assert.equal(
    resolveAnalysisAutoExecuteAttempt({
      enabled: true,
      lastSubmittedScope: null,
      executionScopeKey: 'session-10-7:root',
      sessionAttemptedValue: '1',
    }),
    'skip-session-dedup',
  );
  assert.equal(
    resolveAnalysisAutoExecuteAttempt({
      enabled: true,
      lastSubmittedScope: null,
      executionScopeKey: 'session-10-7:root',
      sessionAttemptedValue: null,
    }),
    'submit',
  );

  const requestSubmitCalls: string[] = [];
  submitAnalysisAutoExecuteForm({
    requestSubmit: () => requestSubmitCalls.push('requestSubmit'),
    submit: () => requestSubmitCalls.push('submit'),
  });
  assert.deepEqual(requestSubmitCalls, ['requestSubmit']);

  const submitCalls: string[] = [];
  submitAnalysisAutoExecuteForm({
    submit: () => submitCalls.push('submit'),
  });
  assert.deepEqual(submitCalls, ['submit']);
});
