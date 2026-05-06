import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function runTsSnippet(code, options = {}) {
  const { stdout } = await execFileAsync(
    'node',
    ['--import', 'tsx', '--input-type=module', '-e', code],
    {
      cwd: process.cwd(),
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        NODE_OPTIONS: [
          process.env.NODE_OPTIONS,
          options.reactServer === false ? '' : '--conditions=react-server',
        ]
          .filter(Boolean)
          .join(' '),
      },
    },
  );

  const trimmed = stdout.trim();
  if (!trimmed) return null;
  return JSON.parse(trimmed.split('\n').pop() ?? 'null');
}

const BASE_CONTEXT = {
  targetMetric: { value: '收费率', state: 'confirmed' },
  entity: { value: '华东项目', state: 'confirmed' },
  timeRange: { value: '近三个月', state: 'confirmed' },
  comparison: { value: '同比', state: 'confirmed' },
  constraints: [],
};

function buildSnapshot(id, ontologyVersionId = 'ontology-v1') {
  return {
    executionId: id,
    sessionId: 'session-9-6',
    ownerUserId: 'owner-9-6',
    followUpId: null,
    status: 'completed',
    ontologyVersionId,
    ontologyVersionSource: ontologyVersionId ? 'grounded-context' : 'legacy-unknown',
    planSnapshot: {
      mode: 'minimal',
      summary: '分析计划',
      steps: [
        {
          id: 'step-1',
          order: 1,
          title: '读取指标',
          objective: '读取指标',
          dependencyIds: [],
        },
      ],
    },
    stepResults: [],
    conclusionState: {
      causes: [
        {
          id: 'cause-1',
          rank: 1,
          title: '收费率下降',
          summary: '收费率下降与工单积压相关。',
          confidence: 0.82,
          evidence: [],
        },
      ],
      renderBlocks: [],
    },
    resultBlocks: [],
    mobileProjection: {
      summary: '收费率下降与工单积压相关。',
      status: 'completed',
      updatedAt: '2026-04-29T00:00:00.000Z',
    },
    failurePoint: null,
    createdAt: '2026-04-29T00:00:00.000Z',
    updatedAt: '2026-04-29T00:00:00.000Z',
  };
}

test('AC1 execution snapshot 保存时从 groundedContext 绑定 ontology version', async () => {
  const result = await runTsSnippet(`
    import persistenceModule from './src/application/analysis-execution/persistence-use-cases.ts';
    const { createAnalysisExecutionPersistenceUseCases } = persistenceModule;
    let savedSnapshot = null;
    const useCases = createAnalysisExecutionPersistenceUseCases({
      snapshotStore: {
        async save(snapshot) {
          savedSnapshot = snapshot;
          return snapshot;
        },
        async getLatestBySessionId() { return null; },
        async listBySessionId() { return []; },
        async getByExecutionId() { return null; },
      },
    });
    await useCases.saveExecutionSnapshot({
      executionId: 'exec-9-6-root',
      sessionId: 'session-9-6',
      ownerUserId: 'owner-9-6',
      status: 'completed',
      planSnapshot: {
        mode: 'minimal',
        summary: '治理化计划',
        _groundedSource: 'ontology-v1',
        _groundingStatus: 'success',
        steps: [{ id: 'step-1', order: 1, title: '读取指标', objective: '读取指标', dependencyIds: [] }],
      },
      groundedContext: {
        sessionId: 'session-9-6',
        ownerUserId: 'owner-9-6',
        version: 1,
        ontologyVersionId: 'ontology-v1',
        groundingStatus: 'success',
        entities: [],
        metrics: [],
        factors: [],
        timeSemantics: [],
        originalMergedContext: '收费率',
        groundedAt: '2026-04-29T00:00:00.000Z',
        groundingStrategy: 'published-runtime',
        diagnostics: {},
        createdAt: '2026-04-29T00:00:00.000Z',
      },
      events: [],
      conclusionReadModel: { causes: [], renderBlocks: [] },
    });
    console.log(JSON.stringify({
      ontologyVersionId: savedSnapshot?.ontologyVersionId ?? null,
      ontologyVersionSource: savedSnapshot?.ontologyVersionSource ?? null,
    }));
  `, { reactServer: false });

  assert.equal(result.ontologyVersionId, 'ontology-v1');
  assert.equal(result.ontologyVersionSource, 'grounded-context');
});

test('AC2 follow-up 创建继承基准 execution 的 ontology version，重规划跨版本时标记 switched', async () => {
  const result = await runTsSnippet(`
    import followUpModule from './src/application/follow-up/use-cases.ts';
    const { createAnalysisFollowUpUseCases } = followUpModule;
    const baseContext = ${JSON.stringify(BASE_CONTEXT)};
    const baseSnapshot = ${JSON.stringify(buildSnapshot('exec-base', 'ontology-v1'))};
    let storedFollowUp = null;
    const useCases = createAnalysisFollowUpUseCases({
      followUpStore: {
        async create(followUp) {
          storedFollowUp = followUp;
          return followUp;
        },
        async getById() { return storedFollowUp; },
        async updateMergedContext() { return null; },
        async updatePlanState(input) {
          storedFollowUp = {
            ...storedFollowUp,
            planVersion: input.planVersion,
            currentPlanSnapshot: input.currentPlanSnapshot,
            previousPlanSnapshot: input.previousPlanSnapshot,
            currentPlanDiff: input.currentPlanDiff,
            ontologyVersionId: input.ontologyVersionId,
            ontologyVersionSource: input.ontologyVersionSource,
            updatedAt: input.updatedAt,
          };
          return storedFollowUp;
        },
        async attachResultExecution() { return null; },
        async listBySessionId() { return []; },
      },
    });
    const followUp = await useCases.createFollowUp({
      session: {
        id: 'session-9-6',
        ownerUserId: 'owner-9-6',
        organizationId: 'org-9-6',
        projectIds: [],
        areaIds: [],
        questionText: '收费率为什么下降',
        savedContext: baseContext,
        status: 'active',
        createdAt: '2026-04-29T00:00:00.000Z',
        updatedAt: '2026-04-29T00:00:00.000Z',
      },
      questionText: '继续看工单因素',
      currentContextReadModel: {
        sessionId: 'session-9-6',
        version: 1,
        context: baseContext,
        canUndo: false,
        originalQuestionText: '收费率为什么下降',
      },
      latestSnapshot: baseSnapshot,
      baseExecutionSnapshot: baseSnapshot,
    });
    const updated = await useCases.updateFollowUpPlan({
      followUp,
      previousPlanSnapshot: baseSnapshot.planSnapshot,
      nextPlanSnapshot: {
        ...baseSnapshot.planSnapshot,
        _groundedSource: 'ontology-v2',
        _groundingStatus: 'success',
      },
      planDiff: {
        reason: '版本切换后重规划。',
        reusedSteps: [],
        invalidatedSteps: [],
        addedSteps: [],
      },
    });
    console.log(JSON.stringify({
      createdVersion: followUp.ontologyVersionId ?? null,
      createdSource: followUp.ontologyVersionSource ?? null,
      replannedVersion: updated.ontologyVersionId ?? null,
      replannedSource: updated.ontologyVersionSource ?? null,
    }));
  `, { reactServer: false });

  assert.equal(result.createdVersion, 'ontology-v1');
  assert.equal(result.createdSource, 'inherited');
  assert.equal(result.replannedVersion, 'ontology-v2');
  assert.equal(result.replannedSource, 'switched');
});

test('AC2 首次从 legacy/unknown 获得真实版本时标记 grounded-context', async () => {
  const result = await runTsSnippet(`
    import persistenceModelsModule from './src/domain/analysis-execution/persistence-models.ts';
    const { resolveOntologyVersionBindingSource } = persistenceModelsModule;
    console.log(JSON.stringify({
      nullToReal: resolveOntologyVersionBindingSource(null, 'ontology-v1'),
      sameVersion: resolveOntologyVersionBindingSource('ontology-v1', 'ontology-v1'),
      switched: resolveOntologyVersionBindingSource('ontology-v1', 'ontology-v2'),
      missing: resolveOntologyVersionBindingSource('ontology-v1', null),
    }));
  `, { reactServer: false });

  assert.equal(result.nullToReal, 'grounded-context');
  assert.equal(result.sameVersion, 'inherited');
  assert.equal(result.switched, 'switched');
  assert.equal(result.missing, 'legacy-unknown');
});

test('Review P2 grounding 从 store 层查询 published candidates，不依赖 approved 后过滤窗口', async () => {
  const result = await runTsSnippet(`
    import groundingModule from './src/application/ontology/grounding.ts';
    const { createOntologyGroundingUseCases } = groundingModule;
    const now = '2026-04-29T00:00:00.000Z';
    const publishedVersion = {
      id: 'published-runtime-version',
      semver: '1.0.0',
      displayName: 'Published Runtime',
      status: 'approved',
      description: null,
      publishedAt: now,
      deprecatedAt: null,
      retiredAt: null,
      createdBy: 'test',
      createdAt: now,
      updatedAt: now,
    };
    let approvedFallbackCalled = false;
    const useCases = createOntologyGroundingUseCases({
      versionStore: {
        async findById() { return null; },
        async findCurrentApproved() { return null; },
        async findCurrentPublished() { return null; },
        async listPublishedCandidates(limit) {
          return limit === 20 ? [publishedVersion] : [];
        },
        async listApprovedCandidates() {
          approvedFallbackCalled = true;
          return Array.from({ length: 101 }, (_, index) => ({
            ...publishedVersion,
            id: 'approved-unpublished-' + index,
            publishedAt: null,
            updatedAt: new Date(Date.parse(now) + index * 1000).toISOString(),
          }));
        },
      },
      entityStore: {
        async findByVersionId(versionId) {
          return versionId === publishedVersion.id
            ? [{
                id: 'entity-project',
                ontologyVersionId: publishedVersion.id,
                businessKey: 'project',
                displayName: '项目',
                description: null,
                status: 'approved',
                synonyms: [],
                parentBusinessKey: null,
                metadata: {},
                createdAt: now,
                updatedAt: now,
              }]
            : [];
        },
      },
      metricStore: { async findByVersionId() { return []; } },
      factorStore: { async findByVersionId() { return []; } },
      metricVariantStore: { async findByVersionId() { return []; } },
      timeSemanticStore: { async findByVersionId() { return []; } },
    });
    const grounded = await useCases.groundAnalysisContext({
      sessionId: 'session-review-p2',
      ownerUserId: 'owner-review-p2',
      analysisContext: {
        targetMetric: { value: '待补充目标指标', confidence: 0 },
        entity: { value: '项目', confidence: 1 },
        timeRange: { value: '待补充时间范围', confidence: 0 },
        comparison: { value: '无', confidence: 0 },
        constraints: [],
      },
    });
    console.log(JSON.stringify({
      ontologyVersionId: grounded.ontologyVersionId,
      approvedFallbackCalled,
    }));
  `, { reactServer: false });

  assert.equal(result.ontologyVersionId, 'published-runtime-version');
  assert.equal(result.approvedFallbackCalled, false);
});

test('AC3 history read model 与展示能按轮次暴露 inherited / switched / legacy ontology badge', async () => {
  const result = await runTsSnippet(`
    import React from 'react';
    import * as ReactDOMServer from 'react-dom/server';
    import historyModule from './src/application/analysis-history/use-cases.ts';
    import panelModule from './src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-history-panel.tsx';
    const { analysisHistoryUseCases } = historyModule;
    const { AnalysisHistoryPanel } = panelModule;
    const baseContext = ${JSON.stringify(BASE_CONTEXT)};
    const session = {
      id: 'session-9-6',
      ownerUserId: 'owner-9-6',
      organizationId: 'org-9-6',
      projectIds: [],
      areaIds: [],
      questionText: '收费率为什么下降',
      savedContext: baseContext,
      status: 'active',
      createdAt: '2026-04-29T00:00:00.000Z',
      updatedAt: '2026-04-29T00:00:00.000Z',
    };
    const snapshots = [
      ${JSON.stringify(buildSnapshot('exec-root', null))},
      { ...${JSON.stringify(buildSnapshot('exec-follow-1', 'ontology-v1'))}, followUpId: 'follow-1' },
      { ...${JSON.stringify(buildSnapshot('exec-follow-2', 'ontology-v2'))}, followUpId: 'follow-2' },
    ];
    const followUps = [
      {
        id: 'follow-1',
        sessionId: 'session-9-6',
        ownerUserId: 'owner-9-6',
        questionText: '继续看工单因素',
        parentFollowUpId: null,
        referencedExecutionId: 'exec-root',
        referencedConclusionTitle: '收费率下降',
        referencedConclusionSummary: '收费率下降与工单积压相关。',
        resultExecutionId: 'exec-follow-1',
        inheritedContext: baseContext,
        mergedContext: baseContext,
        ontologyVersionId: 'ontology-v1',
        ontologyVersionSource: 'inherited',
        planVersion: null,
        currentPlanSnapshot: null,
        previousPlanSnapshot: null,
        currentPlanDiff: null,
        createdAt: '2026-04-29T00:01:00.000Z',
        updatedAt: '2026-04-29T00:01:00.000Z',
      },
      {
        id: 'follow-2',
        sessionId: 'session-9-6',
        ownerUserId: 'owner-9-6',
        questionText: '按新版本再看一次',
        parentFollowUpId: 'follow-1',
        referencedExecutionId: 'exec-follow-1',
        referencedConclusionTitle: '收费率下降',
        referencedConclusionSummary: '收费率下降与工单积压相关。',
        resultExecutionId: 'exec-follow-2',
        inheritedContext: baseContext,
        mergedContext: baseContext,
        ontologyVersionId: 'ontology-v2',
        ontologyVersionSource: 'switched',
        planVersion: 2,
        currentPlanSnapshot: null,
        previousPlanSnapshot: null,
        currentPlanDiff: null,
        createdAt: '2026-04-29T00:02:00.000Z',
        updatedAt: '2026-04-29T00:02:00.000Z',
      },
    ];
    const readModel = analysisHistoryUseCases.buildHistoryReadModel({
      session,
      sessionContext: baseContext,
      followUps,
      snapshots,
      selectedRoundId: 'follow-2',
    });
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(AnalysisHistoryPanel, {
        sessionId: 'session-9-6',
        readModel,
      }),
    );
    console.log(JSON.stringify({
      roundVersions: readModel.rounds.map((round) => round.ontologyVersion),
      hasLegacyBadge: html.includes('legacy/unknown'),
      hasInheritedBadge: html.includes('inherited'),
      hasSwitchedBadge: html.includes('switched'),
      hasVersionId: html.includes('ontology-v2'),
    }));
  `, { reactServer: false });

  assert.deepEqual(
    result.roundVersions.map((version) => version?.source),
    ['legacy-unknown', 'inherited', 'switched'],
  );
  assert.equal(result.hasLegacyBadge, true);
  assert.equal(result.hasInheritedBadge, true);
  assert.equal(result.hasSwitchedBadge, true);
  assert.equal(result.hasVersionId, true);
});
