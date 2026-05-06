import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Story 9.6 — ontology version must be stored on canonical execution,
// follow-up, and history facts. These tests intentionally exercise the
// application/domain boundary first; Postgres schema coverage is added once
// the contract exists.

function buildContext() {
  return {
    targetMetric: { label: '目标指标', value: '收缴率', state: 'confirmed' as const },
    entity: { label: '实体对象', value: '项目 A', state: 'confirmed' as const },
    timeRange: { label: '时间范围', value: '本月', state: 'confirmed' as const },
    comparison: { label: '比较方式', value: '同比', state: 'confirmed' as const },
    constraints: [],
  };
}

function buildPlan(ontologyVersionId: string) {
  return {
    mode: 'multi-step' as const,
    summary: '基于治理化本体版本生成的分析计划。',
    steps: [
      {
        id: 'confirm-analysis-scope',
        order: 1,
        title: '确认分析口径',
        objective: '确认收缴率的分析边界。',
        dependencyIds: [],
      },
    ],
    _groundedSource: ontologyVersionId,
    _groundingStatus: 'success' as const,
  };
}

function buildConclusion(title = '收缴率波动主要来自缴费节奏变化') {
  return {
    causes: [
      {
        id: 'cause-1',
        rank: 1,
        title,
        summary: '本轮结论摘要。',
        confidence: 0.82,
        evidence: [{ label: '证据', summary: '关键证据摘要。' }],
      },
    ],
    renderBlocks: [],
  };
}

function buildSession() {
  const timestamp = '2026-05-05T00:00:00.000Z';

  return {
    id: 'story-9-6-session',
    ownerUserId: 'story-9-6-owner',
    organizationId: 'org-story-9-6',
    projectIds: ['project-story-9-6'],
    areaIds: ['area-story-9-6'],
    questionText: '本月项目 A 收缴率为什么下降？',
    savedContext: buildContext(),
    status: 'pending' as const,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function buildSnapshot(input?: {
  executionId?: string;
  followUpId?: string | null;
  ontologyVersionId?: string | null;
}) {
  const timestamp = '2026-05-05T00:00:00.000Z';
  const ontologyVersionId =
    input && 'ontologyVersionId' in input
      ? (input.ontologyVersionId ?? null)
      : 'ontology-v1';

  return {
    executionId: input?.executionId ?? 'execution-root',
    sessionId: 'story-9-6-session',
    ownerUserId: 'story-9-6-owner',
    followUpId: input?.followUpId ?? null,
    ontologyVersionId,
    ontologyVersionBinding: ontologyVersionId
      ? { ontologyVersionId, source: 'inherited' as const }
      : { ontologyVersionId: null, source: 'legacy/unknown' as const },
    status: 'completed' as const,
    planSnapshot: buildPlan(ontologyVersionId ?? 'legacy-plan-source'),
    stepResults: [],
    conclusionState: buildConclusion(),
    resultBlocks: [],
    mobileProjection: {
      summary: '本轮结论摘要。',
      status: 'completed' as const,
      updatedAt: timestamp,
    },
    failurePoint: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

test('Story 9.6 AC1 | saveExecutionSnapshot writes execution-time ontology version into canonical snapshot', async () => {
  const { createAnalysisExecutionPersistenceUseCases } = await import(
    '@/application/analysis-execution/persistence-use-cases'
  );

  let savedSnapshot: Record<string, unknown> | null = null;
  const useCases = createAnalysisExecutionPersistenceUseCases({
    snapshotStore: {
      async save(snapshot) {
        savedSnapshot = snapshot as unknown as Record<string, unknown>;
        return snapshot;
      },
      async getLatestBySessionId() {
        return null;
      },
      async listBySessionId() {
        return [];
      },
      async getByExecutionId() {
        return null;
      },
    },
  });

  const snapshot = await useCases.saveExecutionSnapshot({
    executionId: 'execution-ac1',
    sessionId: 'story-9-6-session',
    ownerUserId: 'story-9-6-owner',
    status: 'completed',
    ontologyVersionId: 'published-ontology-v1',
    planSnapshot: buildPlan('published-ontology-v1'),
    events: [],
    conclusionReadModel: buildConclusion(),
  });

  assert.equal(snapshot.ontologyVersionId, 'published-ontology-v1');
  assert.deepEqual(snapshot.ontologyVersionBinding, {
    ontologyVersionId: 'published-ontology-v1',
    source: 'inherited',
  });
  assert.ok(savedSnapshot);
  assert.equal(savedSnapshot['ontologyVersionId'], 'published-ontology-v1');
});

test('Story 9.6 AC1 | snapshot falls back to plan _groundedSource, not current ontology lookup', async () => {
  const { createAnalysisExecutionPersistenceUseCases } = await import(
    '@/application/analysis-execution/persistence-use-cases'
  );

  const useCases = createAnalysisExecutionPersistenceUseCases({
    snapshotStore: {
      async save(snapshot) {
        return snapshot;
      },
      async getLatestBySessionId() {
        return null;
      },
      async listBySessionId() {
        return [];
      },
      async getByExecutionId() {
        return null;
      },
    },
  });

  const snapshot = await useCases.saveExecutionSnapshot({
    executionId: 'execution-plan-source',
    sessionId: 'story-9-6-session',
    ownerUserId: 'story-9-6-owner',
    status: 'completed',
    planSnapshot: buildPlan('plan-grounded-v2'),
    events: [],
    conclusionReadModel: buildConclusion(),
  });

  assert.equal(snapshot.ontologyVersionId, 'plan-grounded-v2');
  assert.equal(snapshot.ontologyVersionBinding.source, 'inherited');
});

test('Story 9.6 AC2 | follow-up inherits ontology version from referenced execution snapshot', async () => {
  const { createAnalysisFollowUpUseCases } = await import(
    '@/application/follow-up/use-cases'
  );

  const useCases = createAnalysisFollowUpUseCases({
    followUpStore: {
      async create(followUp) {
        return followUp;
      },
      async getById() {
        return null;
      },
      async updateMergedContext() {
        return null;
      },
      async updatePlanState() {
        return null;
      },
      async attachResultExecution() {
        return null;
      },
      async listBySessionId() {
        return [];
      },
    },
  });

  const followUp = await useCases.createFollowUp({
    session: buildSession(),
    questionText: '那和车位缴费有关吗？',
    currentContextReadModel: {
      sessionId: 'story-9-6-session',
      version: 1,
      context: buildContext(),
      canUndo: false,
      originalQuestionText: '本月项目 A 收缴率为什么下降？',
    },
    latestSnapshot: buildSnapshot({ ontologyVersionId: 'published-ontology-v1' }),
  });

  assert.equal(followUp.ontologyVersionId, 'published-ontology-v1');
  assert.deepEqual(followUp.ontologyVersionBinding, {
    ontologyVersionId: 'published-ontology-v1',
    source: 'inherited',
  });
});

test('Story 9.6 AC2 | replan marks version as switched when grounded source changes', async () => {
  const { createAnalysisFollowUpUseCases } = await import(
    '@/application/follow-up/use-cases'
  );

  let updatePayload: Record<string, unknown> | null = null;
  const useCases = createAnalysisFollowUpUseCases({
    followUpStore: {
      async create(followUp) {
        return followUp;
      },
      async getById() {
        return null;
      },
      async updateMergedContext() {
        return null;
      },
      async updatePlanState(input) {
        updatePayload = input as unknown as Record<string, unknown>;
        return {
          ...buildFollowUp('published-ontology-v1'),
          ontologyVersionId: input.ontologyVersionId,
          ontologyVersionBinding: input.ontologyVersionBinding,
          planVersion: input.planVersion,
          currentPlanSnapshot: input.currentPlanSnapshot,
          previousPlanSnapshot: input.previousPlanSnapshot,
          currentPlanDiff: input.currentPlanDiff,
          updatedAt: input.updatedAt,
        };
      },
      async attachResultExecution() {
        return null;
      },
      async listBySessionId() {
        return [];
      },
    },
  });

  const updated = await useCases.updateFollowUpPlan({
    followUp: buildFollowUp('published-ontology-v1'),
    previousPlanSnapshot: buildPlan('published-ontology-v1'),
    nextPlanSnapshot: buildPlan('published-ontology-v2'),
    planDiff: {
      reason: '治理版本切换后重规划。',
      reusedSteps: [],
      invalidatedSteps: [],
      addedSteps: [],
    },
  });

  assert.ok(updatePayload);
  assert.equal(updatePayload['ontologyVersionId'], 'published-ontology-v2');
  assert.deepEqual(updated.ontologyVersionBinding, {
    ontologyVersionId: 'published-ontology-v2',
    source: 'switched',
  });
});

test('Story 9.6 Review D2 | replan marks legacy to governed version as switched', async () => {
  const { createAnalysisFollowUpUseCases } = await import(
    '@/application/follow-up/use-cases'
  );

  const useCases = createAnalysisFollowUpUseCases({
    followUpStore: {
      async create(followUp) {
        return followUp;
      },
      async getById() {
        return null;
      },
      async updateMergedContext() {
        return null;
      },
      async updatePlanState(input) {
        return {
          ...buildFollowUp(null),
          ontologyVersionId: input.ontologyVersionId,
          ontologyVersionBinding: input.ontologyVersionBinding,
          planVersion: input.planVersion,
          currentPlanSnapshot: input.currentPlanSnapshot,
          previousPlanSnapshot: input.previousPlanSnapshot,
          currentPlanDiff: input.currentPlanDiff,
          updatedAt: input.updatedAt,
        };
      },
      async attachResultExecution() {
        return null;
      },
      async listBySessionId() {
        return [];
      },
    },
  });

  const updated = await useCases.updateFollowUpPlan({
    followUp: buildFollowUp(null),
    previousPlanSnapshot: buildPlan('legacy-plan-source'),
    nextPlanSnapshot: buildPlan('published-ontology-v1'),
    planDiff: {
      reason: '旧轮次接入治理化本体版本。',
      reusedSteps: [],
      invalidatedSteps: [],
      addedSteps: [],
    },
  });

  assert.deepEqual(updated.ontologyVersionBinding, {
    ontologyVersionId: 'published-ontology-v1',
    source: 'switched',
  });
});

test('Story 9.6 Review D1 | display projection keeps snapshot version id but uses follow-up switched source', async () => {
  const versionBindingModule = await import('@/domain/ontology/version-binding');
  const { resolveOntologyVersionBindingForDisplay } = versionBindingModule;

  const projected = resolveOntologyVersionBindingForDisplay({
    snapshotBinding: {
      ontologyVersionId: 'published-ontology-v2',
      source: 'inherited',
    },
    followUpBinding: {
      ontologyVersionId: 'published-ontology-v2',
      source: 'switched',
    },
  });

  assert.deepEqual(projected, {
    ontologyVersionId: 'published-ontology-v2',
    source: 'switched',
  });
});

test('Story 9.6 Review D3 | snapshot persistence rejects unpublished ontology version bindings', async () => {
  const { createAnalysisExecutionPersistenceUseCases } = await import(
    '@/application/analysis-execution/persistence-use-cases'
  );

  const useCases = createAnalysisExecutionPersistenceUseCases({
    snapshotStore: {
      async save(snapshot) {
        return snapshot;
      },
      async getLatestBySessionId() {
        return null;
      },
      async listBySessionId() {
        return [];
      },
      async getByExecutionId() {
        return null;
      },
    },
    ontologyVersionStore: {
      async findById(id) {
        return {
          id,
          semver: '99.6.0-test',
          displayName: '未发布测试版本',
          status: 'approved',
          description: null,
          publishedAt: null,
          deprecatedAt: null,
          retiredAt: null,
          createdBy: 'story-9-6-test',
          createdAt: '2026-05-05T00:00:00.000Z',
          updatedAt: '2026-05-05T00:00:00.000Z',
        };
      },
    },
  });

  await assert.rejects(
    () =>
      useCases.saveExecutionSnapshot({
        executionId: 'execution-unpublished-version',
        sessionId: 'story-9-6-session',
        ownerUserId: 'story-9-6-owner',
        status: 'completed',
        ontologyVersionId: 'approved-but-unpublished',
        planSnapshot: buildPlan('approved-but-unpublished'),
        events: [],
        conclusionReadModel: buildConclusion(),
      }),
    /must reference an approved and published ontology version/,
  );
});

test('Story 9.6 Review D3 | follow-up creation rejects unpublished inherited ontology version bindings', async () => {
  const { createAnalysisFollowUpUseCases } = await import(
    '@/application/follow-up/use-cases'
  );

  const useCases = createAnalysisFollowUpUseCases({
    followUpStore: {
      async create(followUp) {
        return followUp;
      },
      async getById() {
        return null;
      },
      async updateMergedContext() {
        return null;
      },
      async updatePlanState() {
        return null;
      },
      async attachResultExecution() {
        return null;
      },
      async listBySessionId() {
        return [];
      },
    },
    ontologyVersionStore: {
      async findById(id) {
        return {
          id,
          semver: '99.6.0-test',
          displayName: '未发布测试版本',
          status: 'approved',
          description: null,
          publishedAt: null,
          deprecatedAt: null,
          retiredAt: null,
          createdBy: 'story-9-6-test',
          createdAt: '2026-05-05T00:00:00.000Z',
          updatedAt: '2026-05-05T00:00:00.000Z',
        };
      },
    },
  });

  await assert.rejects(
    () =>
      useCases.createFollowUp({
        session: buildSession(),
        questionText: '继续解释这个未发布版本的结论。',
        currentContextReadModel: {
          sessionId: 'story-9-6-session',
          version: 1,
          context: buildContext(),
          canUndo: false,
          originalQuestionText: '本月项目 A 收缴率为什么下降？',
        },
        latestSnapshot: buildSnapshot({
          ontologyVersionId: 'approved-but-unpublished',
        }),
      }),
    /must reference an approved and published ontology version/,
  );
});

test('Story 9.6 Review P2 | legacy ontology version badge is not duplicated', async () => {
  const displayModule = await import('@/shared/ontology/version-binding-display');
  const { formatOntologyVersionBindingBadge } = displayModule;

  assert.equal(
    formatOntologyVersionBindingBadge({
      ontologyVersionId: null,
      source: 'legacy/unknown',
    }),
    'Ontology 旧版本 / 未知',
  );
  assert.equal(
    formatOntologyVersionBindingBadge({
      ontologyVersionId: 'published-ontology-v1',
      source: 'inherited',
    }),
    'Ontology inherited：published-ontology-v1',
  );
});

test('Story 9.6 AC3 | history rounds expose ontology version badge metadata and legacy/unknown fallback', async () => {
  const { createAnalysisHistoryUseCases } = await import(
    '@/application/analysis-history/use-cases'
  );

  const history = createAnalysisHistoryUseCases().buildHistoryReadModel({
    session: buildSession(),
    sessionContext: buildContext(),
    followUps: [
      {
        ...buildFollowUp('published-ontology-v1'),
        id: 'follow-up-switched',
        resultExecutionId: 'execution-follow-up',
        ontologyVersionId: 'published-ontology-v2',
        ontologyVersionBinding: {
          ontologyVersionId: 'published-ontology-v2',
          source: 'switched' as const,
        },
      },
      {
        ...buildFollowUp(null),
        id: 'follow-up-legacy',
        resultExecutionId: null,
      },
    ],
    snapshots: [
      buildSnapshot({
        executionId: 'execution-root',
        ontologyVersionId: 'published-ontology-v1',
      }),
      buildSnapshot({
        executionId: 'execution-follow-up',
        followUpId: 'follow-up-switched',
        ontologyVersionId: 'published-ontology-v2',
      }),
    ],
    selectedRoundId: 'follow-up-legacy',
  });

  assert.deepEqual(history.rounds[0].ontologyVersionBinding, {
    ontologyVersionId: 'published-ontology-v1',
    source: 'inherited',
  });
  assert.deepEqual(history.rounds[1].ontologyVersionBinding, {
    ontologyVersionId: 'published-ontology-v2',
    source: 'switched',
  });
  assert.deepEqual(history.selectedRound?.ontologyVersionBinding, {
    ontologyVersionId: null,
    source: 'legacy/unknown',
  });
});

test('Story 9.6 AC1+AC2 | Postgres stores persist ontology version binding fields', async () => {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ??
    'postgresql://ontology_agent:ontology_agent_dev_password@127.0.0.1:55432/ontology_agent';

  const postgresClient = await import('@/infrastructure/postgres/client');
  const snapshotStoreModule = await import(
    '@/infrastructure/analysis-execution/postgres-analysis-execution-snapshot-store'
  );
  const followUpStoreModule = await import(
    '@/infrastructure/analysis-session/postgres-analysis-session-follow-up-store'
  );

  const { db, pool } = postgresClient.createPostgresDb();
  const snapshotStore =
    snapshotStoreModule.createPostgresAnalysisExecutionSnapshotStore(db);
  const followUpStore =
    followUpStoreModule.createPostgresAnalysisSessionFollowUpStore(db);
  const suffix = randomUUID();
  const sessionId = `story-9-6-pg-session-${suffix}`;
  const ownerUserId = `story-9-6-pg-owner-${suffix}`;
  const rootExecutionId = `story-9-6-pg-root-${suffix}`;
  const followUpExecutionId = `story-9-6-pg-follow-up-${suffix}`;
  const followUpId = `story-9-6-pg-follow-up-id-${suffix}`;

  try {
    await snapshotStore.save({
      ...buildSnapshot({
        executionId: rootExecutionId,
        ontologyVersionId: 'pg-ontology-v1',
      }),
      sessionId,
      ownerUserId,
    });

    await snapshotStore.save({
      ...buildSnapshot({
        executionId: followUpExecutionId,
        followUpId,
        ontologyVersionId: null,
      }),
      sessionId,
      ownerUserId,
    });

    await followUpStore.create({
      ...buildFollowUp('pg-ontology-v1'),
      id: followUpId,
      sessionId,
      ownerUserId,
      referencedExecutionId: rootExecutionId,
      resultExecutionId: followUpExecutionId,
    });

    const rootSnapshot = await snapshotStore.getByExecutionId(rootExecutionId);
    const legacySnapshot = await snapshotStore.getByExecutionId(followUpExecutionId);
    const followUp = await followUpStore.getById({ followUpId, ownerUserId });

    assert.equal(rootSnapshot?.ontologyVersionId, 'pg-ontology-v1');
    assert.deepEqual(rootSnapshot?.ontologyVersionBinding, {
      ontologyVersionId: 'pg-ontology-v1',
      source: 'inherited',
    });
    assert.deepEqual(legacySnapshot?.ontologyVersionBinding, {
      ontologyVersionId: null,
      source: 'legacy/unknown',
    });
    assert.deepEqual(followUp?.ontologyVersionBinding, {
      ontologyVersionId: 'pg-ontology-v1',
      source: 'inherited',
    });
  } finally {
    await pool.end();
  }
});

function buildFollowUp(ontologyVersionId: string | null) {
  const timestamp = '2026-05-05T00:00:00.000Z';

  return {
    id: 'follow-up-inherited',
    sessionId: 'story-9-6-session',
    ownerUserId: 'story-9-6-owner',
    questionText: '那和车位缴费有关吗？',
    parentFollowUpId: null,
    referencedExecutionId: 'execution-root',
    referencedConclusionTitle: '收缴率波动主要来自缴费节奏变化',
    referencedConclusionSummary: '本轮结论摘要。',
    resultExecutionId: null,
    ontologyVersionId,
    ontologyVersionBinding: ontologyVersionId
      ? { ontologyVersionId, source: 'inherited' as const }
      : { ontologyVersionId: null, source: 'legacy/unknown' as const },
    inheritedContext: buildContext(),
    mergedContext: buildContext(),
    planVersion: null,
    currentPlanSnapshot: null,
    previousPlanSnapshot: null,
    currentPlanDiff: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
