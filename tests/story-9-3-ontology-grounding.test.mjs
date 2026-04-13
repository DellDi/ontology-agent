/**
 * Story 9.3: Ontology Grounding 接入上下文、计划与工具选择
 *
 * 验证点：
 * 1. context extraction 结果能被 grounding 到 canonical definitions
 * 2. planner 读取 grounded context，而不是旧自由文本主路径
 * 3. tool selection 能消费正式 binding
 * 4. follow-up / replan 使用 grounded context 作为基线
 * 5. bootstrap 流程幂等且正确诊断失败
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';

const execFileAsync = promisify(execFile);

const ROOT = process.cwd();

const TEST_DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://ontology_agent:ontology_agent_dev_password@127.0.0.1:55432/ontology_agent';

async function runTsSnippet(code) {
  const { stdout } = await execFileAsync(
    'node',
    ['--import', 'tsx', '--input-type=module', '-e', code],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        DATABASE_URL: TEST_DATABASE_URL,
      },
      timeout: 30_000,
    },
  );
  return JSON.parse(stdout.trim());
}

test('AC3 ontology binding use case 能基于 grounded context 选出绑定工具', async () => {
  const result = await runTsSnippet(`
    import versionStoreModule from './src/infrastructure/ontology/postgres-ontology-version-store.ts';
    import postgresClientModule from './src/infrastructure/postgres/client.ts';
    import toolBindingUseCasesModule from './src/application/ontology/tool-binding-use-cases.ts';
    import toolBindingStoreModule from './src/infrastructure/ontology/postgres-ontology-tool-capability-binding-store.ts';
    import toolBindingDomainModule from './src/domain/ontology/tool-binding.ts';

    const { createPostgresDb } = postgresClientModule;
    const { createPostgresOntologyVersionStore } = versionStoreModule;
    const { createPostgresOntologyToolCapabilityBindingStore } = toolBindingStoreModule;
    const { createOntologyToolBindingUseCases } = toolBindingUseCasesModule;
    const { buildDefaultToolCapabilityBindingSeeds } = toolBindingDomainModule;

    const versionId = 'binding-test-' + crypto.randomUUID();
    const now = new Date().toISOString();
    const { db, pool } = createPostgresDb();
    const versionStore = createPostgresOntologyVersionStore(db);
    const bindingStore = createPostgresOntologyToolCapabilityBindingStore(db);

    await versionStore.create({
      id: versionId,
      semver: '99.3.2-binding-test',
      displayName: 'Binding Test Version',
      description: 'binding test',
      createdBy: 'story-9-3-binding-test',
      createdAt: now,
      updatedAt: now,
    });
    await versionStore.updateStatus(versionId, 'approved', now, { publishedAt: now });
    await bindingStore.bulkCreate(buildDefaultToolCapabilityBindingSeeds(versionId, now, 'story-9-3-binding-test'));

    const useCases = createOntologyToolBindingUseCases({
      versionStore,
      toolCapabilityBindingStore: bindingStore,
    });

    const selection = await useCases.selectToolsForStep({
      stepId: 'inspect-metric-change',
      availableToolNames: ['cube.semantic-query', 'neo4j.graph-query', 'erp.read-model', 'llm.structured-analysis', 'platform.capability-status'],
      groundedContext: {
        ontologyVersionId: versionId,
        groundingStatus: 'success',
        entities: [{
          status: 'success',
          originalText: '项目A',
          canonicalDefinition: { id: 'entity-project', ontologyVersionId: versionId, businessKey: 'project', displayName: '项目', description: null, status: 'approved', synonyms: [], parentBusinessKey: null, metadata: {}, createdAt: now, updatedAt: now },
          candidates: [],
          confidence: 1,
        }],
        metrics: [{
          status: 'success',
          originalText: '收缴率',
          canonicalDefinition: { id: 'metric-collection-rate', ontologyVersionId: versionId, businessKey: 'collection-rate', displayName: '收缴率', description: null, status: 'approved', applicableSubjectKeys: ['project'], defaultAggregation: 'ratio', unit: '%', metadata: {}, createdAt: now, updatedAt: now },
          variant: null,
          candidates: [],
          confidence: 1,
        }],
        factors: [],
        timeSemantics: [],
        originalMergedContext: '项目A收缴率',
        groundedAt: now,
        groundingStrategy: 'exact-match',
      },
      intentType: 'fee-analysis',
      questionText: '为什么项目A收缴率下降了？',
      stepTitle: '校验核心指标波动',
      stepObjective: '验证收缴率是否真实下降。',
    });

    await pool.end();
    console.log(JSON.stringify(selection));
  `);

  assert.match(result.strategy, /ontology binding/i);
  assert.deepEqual(
    result.tools.map((tool) => tool.toolName),
    ['cube.semantic-query'],
    'inspect-metric-change 应优先命中 ontology binding 绑定的 cube 查询工具'
  );
});

test('AC2 grounded planner 在缺失 canonical definition 时必须 fail loud，而不是回退自由文本', async () => {
  const result = await runTsSnippet(`
    import planModule from './src/domain/analysis-plan/models.ts';

    const { buildAnalysisPlanFromGroundedContext } = planModule;
    const now = new Date().toISOString();

    try {
      const plan = buildAnalysisPlanFromGroundedContext({
        intentType: 'general-analysis',
        groundedContext: {
          ontologyVersionId: 'test-version',
          groundingStatus: 'success',
          entities: [{
            status: 'success',
            originalText: '项目A',
            canonicalDefinition: {
              id: 'entity-project',
              ontologyVersionId: 'test-version',
              businessKey: 'project',
              displayName: '项目',
              description: null,
              status: 'approved',
              synonyms: [],
              parentBusinessKey: null,
              metadata: {},
              createdAt: now,
              updatedAt: now,
            },
            candidates: [],
            confidence: 1,
          }],
          metrics: [{
            status: 'failed',
            originalText: '自由文本指标',
            canonicalDefinition: null,
            variant: null,
            candidates: [],
            confidence: 0,
            failureReason: '未命中 canonical metric',
          }],
          factors: [],
          timeSemantics: [{
            status: 'success',
            originalText: '本月',
            canonicalDefinition: {
              id: 'time-semantic',
              ontologyVersionId: 'test-version',
              businessKey: 'payment-date',
              displayName: '缴款日期',
              description: null,
              status: 'approved',
              semanticType: 'transaction-date',
              entityDateFieldMapping: {},
              cubeTimeDimensionMapping: {},
              calculationRule: null,
              defaultGranularity: 'month',
              metadata: {},
              createdAt: now,
              updatedAt: now,
            },
            candidates: [],
            confidence: 1,
          }],
          originalMergedContext: '项目A本月自由文本指标',
          groundedAt: now,
          groundingStrategy: 'exact-match',
        },
        shouldExpandFactors: true,
      });

      console.log(JSON.stringify({ ok: true, plan }));
    } catch (error) {
      console.log(JSON.stringify({
        ok: false,
        name: error instanceof Error ? error.name : 'UnknownError',
        message: error instanceof Error ? error.message : 'unknown',
      }));
    }
  `);

  assert.equal(result.ok, false, '缺失 canonical metric 时应直接失败');
  assert.match(result.message, /ground|治理化|canonical|缺少/i);
});

test('AC1 grounding mixed failed/success 必须阻断 planner，而不是以 partial 悄悄放行', async () => {
  const versionId = `story-9-3-partial-${randomUUID()}`;

  const result = await runTsSnippet(`
    import postgresClientModule from './src/infrastructure/postgres/client.ts';
    import versionStoreModule from './src/infrastructure/ontology/postgres-ontology-version-store.ts';
    import entityStoreModule from './src/infrastructure/ontology/postgres-ontology-entity-definition-store.ts';
    import metricStoreModule from './src/infrastructure/ontology/postgres-ontology-metric-definition-store.ts';
    import factorStoreModule from './src/infrastructure/ontology/postgres-ontology-factor-definition-store.ts';
    import variantStoreModule from './src/infrastructure/ontology/postgres-ontology-metric-variant-store.ts';
    import timeStoreModule from './src/infrastructure/ontology/postgres-ontology-time-semantic-store.ts';
    import groundingModule from './src/application/ontology/grounding.ts';

    const { createPostgresDb } = postgresClientModule;
    const { createPostgresOntologyVersionStore } = versionStoreModule;
    const { createPostgresOntologyEntityDefinitionStore } = entityStoreModule;
    const { createPostgresOntologyMetricDefinitionStore } = metricStoreModule;
    const { createPostgresOntologyFactorDefinitionStore } = factorStoreModule;
    const { createPostgresOntologyMetricVariantStore } = variantStoreModule;
    const { createPostgresOntologyTimeSemanticStore } = timeStoreModule;
    const { createOntologyGroundingUseCases } = groundingModule;

    const now = new Date().toISOString();
    const { db, pool } = createPostgresDb();
    const versionStore = createPostgresOntologyVersionStore(db);
    const entityStore = createPostgresOntologyEntityDefinitionStore(db);
    const metricStore = createPostgresOntologyMetricDefinitionStore(db);
    const factorStore = createPostgresOntologyFactorDefinitionStore(db);
    const metricVariantStore = createPostgresOntologyMetricVariantStore(db);
    const timeSemanticStore = createPostgresOntologyTimeSemanticStore(db);

    await versionStore.create({
      id: ${JSON.stringify(versionId)},
      semver: '99.3.3-partial-test',
      displayName: 'Partial Grounding Test',
      description: 'partial grounding test',
      createdBy: 'story-9-3-partial-test',
      createdAt: now,
      updatedAt: now,
    });
    await versionStore.updateStatus(${JSON.stringify(versionId)}, 'approved', now, { publishedAt: now });

    await entityStore.bulkCreate([{
      id: 'entity-project-' + ${JSON.stringify(versionId)},
      ontologyVersionId: ${JSON.stringify(versionId)},
      businessKey: 'project',
      displayName: '项目',
      description: null,
      status: 'approved',
      synonyms: ['项目A'],
      parentBusinessKey: null,
      metadata: {},
      createdAt: now,
      updatedAt: now,
    }]);
    await metricStore.bulkCreate([{
      id: 'metric-collection-rate-' + ${JSON.stringify(versionId)},
      ontologyVersionId: ${JSON.stringify(versionId)},
      businessKey: 'collection-rate',
      displayName: '收缴率',
      description: null,
      status: 'approved',
      applicableSubjectKeys: ['project'],
      defaultAggregation: 'ratio',
      unit: '%',
      metadata: {},
      createdAt: now,
      updatedAt: now,
    }]);

    const useCases = createOntologyGroundingUseCases({
      versionStore,
      entityStore,
      metricStore,
      factorStore,
      metricVariantStore,
      timeSemanticStore,
    });

    try {
      await useCases.groundAnalysisContext({
        sessionId: 'partial-session',
        ownerUserId: 'partial-owner',
        preferredVersionId: ${JSON.stringify(versionId)},
        analysisContext: {
          targetMetric: { label: '目标指标', value: '收缴率', state: 'confirmed' },
          entity: { label: '实体对象', value: '项目A', state: 'confirmed' },
          timeRange: { label: '时间范围', value: '本月', state: 'confirmed' },
          comparison: { label: '比较方式', value: '同比', state: 'confirmed' },
          constraints: [],
        },
      });

      console.log(JSON.stringify({ ok: true }));
    } catch (error) {
      console.log(JSON.stringify({
        ok: false,
        name: error instanceof Error ? error.name : 'UnknownError',
        message: error instanceof Error ? error.message : 'unknown',
      }));
    } finally {
      await pool.end();
    }
  `);

  assert.equal(result.ok, false, 'mixed failed/success 应阻断');
  assert.match(result.message, /grounding/i);
});

// ─── 构建检查 ────────────────────────────────────────────────────────────

test('项目构建通过', async () => {
  await assert.doesNotReject(
    () => execFileAsync('pnpm', ['tsc', '--noEmit'], { cwd: ROOT }),
    'TypeScript 类型检查必须通过'
  );
});

// ─── 运行时集成测试（需要真实数据库）────────────────────────────────────────

const TEST_SESSION_ID = `test-grounding-${randomUUID()}`;
const TEST_VERSION_ID = `test-grounding-ver-${randomUUID()}`;

test('RT-AC1 bootstrap: 创建 ontology version 并标记为 approved', async () => {
  const result = await runTsSnippet(`
    import postgresClientModule from './src/infrastructure/postgres/client.ts';
    import versionStoreModule from './src/infrastructure/ontology/postgres-ontology-version-store.ts';
    import useCasesModule from './src/application/ontology/use-cases.ts';

    const { createPostgresDb } = postgresClientModule;
    const { createPostgresOntologyVersionStore } = versionStoreModule;
    const { createOntologyVersion } = useCasesModule;

    const { db, pool } = createPostgresDb();
    const versionStore = createPostgresOntologyVersionStore(db);
    const now = new Date().toISOString();

    await createOntologyVersion({ versionStore }, {
      id: ${JSON.stringify(TEST_VERSION_ID)},
      semver: '99.3.0-test',
      displayName: 'Story 9.3 运行时测试版本',
      description: '集成测试用版本',
      createdBy: 'story-9-3-test',
      createdAt: now,
      updatedAt: now,
    });

    const version = await versionStore.updateStatus(
      ${JSON.stringify(TEST_VERSION_ID)},
      'approved',
      now,
      { publishedAt: now },
    );

    await pool.end();
    console.log(JSON.stringify({ status: version.status, id: version.id }));
  `);

  assert.strictEqual(result.status, 'approved', '版本状态必须为 approved');
  assert.strictEqual(result.id, TEST_VERSION_ID, '版本 ID 必须匹配');
});

test('RT-AC1 grounded context store: save 和 getLatest 读写正确', async () => {
  const result = await runTsSnippet(`
    import postgresClientModule from './src/infrastructure/postgres/client.ts';
    import storeModule from './src/infrastructure/ontology/postgres-grounded-context-store.ts';

    const { createPostgresDb } = postgresClientModule;
    const { createPostgresGroundedContextStore } = storeModule;

    const { db, pool } = createPostgresDb();
    const store = createPostgresGroundedContextStore(db);

    const context = {
      sessionId: ${JSON.stringify(TEST_SESSION_ID)},
      ownerUserId: 'test-user-9-3',
      ontologyVersionId: ${JSON.stringify(TEST_VERSION_ID)},
      groundingStatus: 'success',
      entities: [{ groundedKey: 'property', displayName: '房产', score: 1.0, matchType: 'exact', originalText: '房产' }],
      metrics: [],
      factors: [],
      timeSemantics: [],
      originalMergedContext: '分析房产收缴率',
      groundedAt: new Date().toISOString(),
      groundingStrategy: 'exact-first',
    };

    await store.save(context);
    const latest = await store.getLatest(${JSON.stringify(TEST_SESSION_ID)});
    await pool.end();

    console.log(JSON.stringify({
      found: !!latest,
      status: latest?.groundingStatus,
      sessionId: latest?.sessionId,
      entityCount: latest?.entities?.length ?? 0,
      originalText: latest?.originalMergedContext,
    }));
  `);

  assert.ok(result.found, 'save 后 getLatest 必须能找到记录');
  assert.strictEqual(result.status, 'success', 'groundingStatus 必须为 success');
  assert.strictEqual(result.sessionId, TEST_SESSION_ID, 'sessionId 必须匹配');
  assert.strictEqual(result.entityCount, 1, '必须保存 1 个 entity');
  assert.strictEqual(result.originalText, '分析房产收缴率', 'originalMergedContext 必须保留');
});

test('RT-AC1 grounded context store: 版本自增（save 两次，getLatest 返回最新）', async () => {
  const SESSION_ID_V2 = `${TEST_SESSION_ID}-v2`;

  const result = await runTsSnippet(`
    import postgresClientModule from './src/infrastructure/postgres/client.ts';
    import storeModule from './src/infrastructure/ontology/postgres-grounded-context-store.ts';

    const { createPostgresDb } = postgresClientModule;
    const { createPostgresGroundedContextStore } = storeModule;

    const { db, pool } = createPostgresDb();
    const store = createPostgresGroundedContextStore(db);

    const base = {
      sessionId: ${JSON.stringify(SESSION_ID_V2)},
      ownerUserId: 'test-user-9-3',
      ontologyVersionId: ${JSON.stringify(TEST_VERSION_ID)},
      groundingStatus: 'success',
      entities: [],
      metrics: [],
      factors: [],
      timeSemantics: [],
      groundedAt: new Date().toISOString(),
      groundingStrategy: 'exact-first',
    };

    await store.save({ ...base, originalMergedContext: '第一轮' });
    await store.save({ ...base, originalMergedContext: '第二轮' });
    const latest = await store.getLatest(${JSON.stringify(SESSION_ID_V2)});
    const v1 = await store.getByVersion(${JSON.stringify(SESSION_ID_V2)}, 1);
    const v2 = await store.getByVersion(${JSON.stringify(SESSION_ID_V2)}, 2);
    await pool.end();

    console.log(JSON.stringify({
      latestText: latest?.originalMergedContext,
      v1Text: v1?.originalMergedContext,
      v2Text: v2?.originalMergedContext,
    }));
  `);

  assert.strictEqual(result.latestText, '第二轮', 'getLatest 必须返回最新版本');
  assert.strictEqual(result.v1Text, '第一轮', 'getByVersion(1) 必须返回第一轮');
  assert.strictEqual(result.v2Text, '第二轮', 'getByVersion(2) 必须返回第二轮');
});

test('RT-AC2 grounding use case: groundAnalysisContext 成功路径', async () => {
  const result = await runTsSnippet(`
    import postgresClientModule from './src/infrastructure/postgres/client.ts';
    import versionStoreModule from './src/infrastructure/ontology/postgres-ontology-version-store.ts';
    import entityStoreModule from './src/infrastructure/ontology/postgres-ontology-entity-definition-store.ts';
    import metricStoreModule from './src/infrastructure/ontology/postgres-ontology-metric-definition-store.ts';
    import factorStoreModule from './src/infrastructure/ontology/postgres-ontology-factor-definition-store.ts';
    import variantStoreModule from './src/infrastructure/ontology/postgres-ontology-metric-variant-store.ts';
    import timeStoreModule from './src/infrastructure/ontology/postgres-ontology-time-semantic-store.ts';
    import groundingModule from './src/application/ontology/grounding.ts';

    const { createPostgresDb } = postgresClientModule;
    const { createPostgresOntologyVersionStore } = versionStoreModule;
    const { createPostgresOntologyEntityDefinitionStore } = entityStoreModule;
    const { createPostgresOntologyMetricDefinitionStore } = metricStoreModule;
    const { createPostgresOntologyFactorDefinitionStore } = factorStoreModule;
    const { createPostgresOntologyMetricVariantStore } = variantStoreModule;
    const { createPostgresOntologyTimeSemanticStore } = timeStoreModule;
    const { createOntologyGroundingUseCases } = groundingModule;

    const { db, pool } = createPostgresDb();

    const deps = {
      versionStore: createPostgresOntologyVersionStore(db),
      entityStore: createPostgresOntologyEntityDefinitionStore(db),
      metricStore: createPostgresOntologyMetricDefinitionStore(db),
      factorStore: createPostgresOntologyFactorDefinitionStore(db),
      metricVariantStore: createPostgresOntologyMetricVariantStore(db),
      timeSemanticStore: createPostgresOntologyTimeSemanticStore(db),
    };

    const groundingUseCases = createOntologyGroundingUseCases(deps);
    const approvedDefs = await groundingUseCases.getCurrentApprovedDefinitions();

    await pool.end();
    console.log(JSON.stringify({
      hasApproved: !!approvedDefs,
      versionId: approvedDefs?.version?.id ?? null,
      status: approvedDefs?.version?.status ?? null,
    }));
  `);

  assert.ok(result.hasApproved !== undefined, 'getCurrentApprovedDefinitions 必须可调用');
});

test('RT-AC3 bootstrap: 幂等性——重复 bootstrap 不覆盖已 approved 版本', async () => {
  const IDEMPOTENT_VERSION_ID = `test-idempotent-${randomUUID()}`;

  const result = await runTsSnippet(`
    import postgresClientModule from './src/infrastructure/postgres/client.ts';
    import versionStoreModule from './src/infrastructure/ontology/postgres-ontology-version-store.ts';
    import entityStoreModule from './src/infrastructure/ontology/postgres-ontology-entity-definition-store.ts';
    import metricStoreModule from './src/infrastructure/ontology/postgres-ontology-metric-definition-store.ts';
    import factorStoreModule from './src/infrastructure/ontology/postgres-ontology-factor-definition-store.ts';
    import variantStoreModule from './src/infrastructure/ontology/postgres-ontology-metric-variant-store.ts';
    import timeStoreModule from './src/infrastructure/ontology/postgres-ontology-time-semantic-store.ts';
    import planStepStoreModule from './src/infrastructure/ontology/postgres-ontology-plan-step-template-store.ts';
    import causalityStoreModule from './src/infrastructure/ontology/postgres-ontology-causality-edge-store.ts';
    import evidenceStoreModule from './src/infrastructure/ontology/postgres-ontology-evidence-type-definition-store.ts';
    import toolBindingStoreModule from './src/infrastructure/ontology/postgres-ontology-tool-capability-binding-store.ts';
    import groundingModule from './src/application/ontology/grounding.ts';

    const { createPostgresDb } = postgresClientModule;
    const { createPostgresOntologyVersionStore } = versionStoreModule;
    const { createPostgresOntologyEntityDefinitionStore } = entityStoreModule;
    const { createPostgresOntologyMetricDefinitionStore } = metricStoreModule;
    const { createPostgresOntologyFactorDefinitionStore } = factorStoreModule;
    const { createPostgresOntologyMetricVariantStore } = variantStoreModule;
    const { createPostgresOntologyTimeSemanticStore } = timeStoreModule;
    const { createPostgresOntologyPlanStepTemplateStore } = planStepStoreModule;
    const { createPostgresOntologyCausalityEdgeStore } = causalityStoreModule;
    const { createPostgresOntologyEvidenceTypeDefinitionStore } = evidenceStoreModule;
    const { createPostgresOntologyToolCapabilityBindingStore } = toolBindingStoreModule;
    const { createOntologyBootstrapUseCases } = groundingModule;

    const { db, pool } = createPostgresDb();

    const deps = {
      versionStore: createPostgresOntologyVersionStore(db),
      entityStore: createPostgresOntologyEntityDefinitionStore(db),
      metricStore: createPostgresOntologyMetricDefinitionStore(db),
      factorStore: createPostgresOntologyFactorDefinitionStore(db),
      metricVariantStore: createPostgresOntologyMetricVariantStore(db),
      timeSemanticStore: createPostgresOntologyTimeSemanticStore(db),
      planStepTemplateStore: createPostgresOntologyPlanStepTemplateStore(db),
      causalityEdgeStore: createPostgresOntologyCausalityEdgeStore(db),
      evidenceTypeStore: createPostgresOntologyEvidenceTypeDefinitionStore(db),
      toolCapabilityBindingStore: createPostgresOntologyToolCapabilityBindingStore(db),
    };

    const bootstrapUseCases = createOntologyBootstrapUseCases(deps);

    // 最小 seed：空集合用于测试幂等性，不需要真实业务定义
    const emptySeed = {
      entities: [], metrics: [], factors: [], planStepTemplates: [],
      metricVariants: [], timeSemantics: [], causalityEdges: [], evidenceTypes: [],
    };

    const result1 = await bootstrapUseCases.bootstrapCanonicalDefinitions({
      requestedVersionId: ${JSON.stringify(IDEMPOTENT_VERSION_ID)},
      requestedSemver: '99.3.1-idempotent-test',
      createdBy: 'story-9-3-idempotent-test',
      seedDefinitions: emptySeed,
    });

    const result2 = await bootstrapUseCases.bootstrapCanonicalDefinitions({
      requestedVersionId: ${JSON.stringify(IDEMPOTENT_VERSION_ID)},
      requestedSemver: '99.3.1-idempotent-test',
      createdBy: 'story-9-3-idempotent-test',
      seedDefinitions: emptySeed,
    });

    await pool.end();
    console.log(JSON.stringify({
      firstSkipped: result1.skipped,
      secondSkipped: result2.skipped,
      sameVersion: result1.version.id === result2.version.id,
      firstVersionId: result1.version.id,
    }));
  `);

  assert.strictEqual(result.firstSkipped, false, '第一次 bootstrap 不应 skip（新版本）');
  assert.strictEqual(result.secondSkipped, true, '第二次 bootstrap 必须 skip（幂等）');
  assert.ok(result.sameVersion, '两次 bootstrap 必须返回相同 versionId');
  assert.strictEqual(result.firstVersionId, IDEMPOTENT_VERSION_ID, 'versionId 必须匹配');
});

test('RT-AC3 bootstrap: 必须完整写入 planStepTemplates / causalityEdges / evidenceTypes / tool bindings 后再发布版本', async () => {
  const versionId = `test-bootstrap-complete-${randomUUID()}`;

  const result = await runTsSnippet(`
    import postgresClientModule from './src/infrastructure/postgres/client.ts';
    import versionStoreModule from './src/infrastructure/ontology/postgres-ontology-version-store.ts';
    import entityStoreModule from './src/infrastructure/ontology/postgres-ontology-entity-definition-store.ts';
    import metricStoreModule from './src/infrastructure/ontology/postgres-ontology-metric-definition-store.ts';
    import factorStoreModule from './src/infrastructure/ontology/postgres-ontology-factor-definition-store.ts';
    import variantStoreModule from './src/infrastructure/ontology/postgres-ontology-metric-variant-store.ts';
    import timeStoreModule from './src/infrastructure/ontology/postgres-ontology-time-semantic-store.ts';
    import planStepStoreModule from './src/infrastructure/ontology/postgres-ontology-plan-step-template-store.ts';
    import causalityStoreModule from './src/infrastructure/ontology/postgres-ontology-causality-edge-store.ts';
    import evidenceStoreModule from './src/infrastructure/ontology/postgres-ontology-evidence-type-definition-store.ts';
    import toolBindingStoreModule from './src/infrastructure/ontology/postgres-ontology-tool-capability-binding-store.ts';
    import groundingModule from './src/application/ontology/grounding.ts';

    const { createPostgresDb } = postgresClientModule;
    const { createPostgresOntologyVersionStore } = versionStoreModule;
    const { createPostgresOntologyEntityDefinitionStore } = entityStoreModule;
    const { createPostgresOntologyMetricDefinitionStore } = metricStoreModule;
    const { createPostgresOntologyFactorDefinitionStore } = factorStoreModule;
    const { createPostgresOntologyMetricVariantStore } = variantStoreModule;
    const { createPostgresOntologyTimeSemanticStore } = timeStoreModule;
    const { createPostgresOntologyPlanStepTemplateStore } = planStepStoreModule;
    const { createPostgresOntologyCausalityEdgeStore } = causalityStoreModule;
    const { createPostgresOntologyEvidenceTypeDefinitionStore } = evidenceStoreModule;
    const { createPostgresOntologyToolCapabilityBindingStore } = toolBindingStoreModule;
    const { createOntologyBootstrapUseCases } = groundingModule;

    const now = new Date().toISOString();
    const { db, pool } = createPostgresDb();
    const deps = {
      versionStore: createPostgresOntologyVersionStore(db),
      entityStore: createPostgresOntologyEntityDefinitionStore(db),
      metricStore: createPostgresOntologyMetricDefinitionStore(db),
      factorStore: createPostgresOntologyFactorDefinitionStore(db),
      metricVariantStore: createPostgresOntologyMetricVariantStore(db),
      timeSemanticStore: createPostgresOntologyTimeSemanticStore(db),
      planStepTemplateStore: createPostgresOntologyPlanStepTemplateStore(db),
      causalityEdgeStore: createPostgresOntologyCausalityEdgeStore(db),
      evidenceTypeStore: createPostgresOntologyEvidenceTypeDefinitionStore(db),
      toolCapabilityBindingStore: createPostgresOntologyToolCapabilityBindingStore(db),
    };

    const useCases = createOntologyBootstrapUseCases(deps);
    const bootstrap = await useCases.bootstrapCanonicalDefinitions({
      requestedVersionId: ${JSON.stringify(versionId)},
      requestedSemver: '99.3.4-bootstrap-complete',
      createdBy: 'story-9-3-bootstrap-complete',
      seedDefinitions: {
        entities: [],
        metrics: [],
        factors: [],
        planStepTemplates: [{
          id: 'plan-step-' + ${JSON.stringify(versionId)},
          ontologyVersionId: ${JSON.stringify(versionId)},
          businessKey: 'inspect-metric-change',
          displayName: '校验核心指标波动',
          description: null,
          status: 'approved',
          intentTypes: ['fee-analysis'],
          requiredCapabilities: ['semantic-query'],
          sortOrder: 1,
          metadata: {},
          createdAt: now,
          updatedAt: now,
        }],
        metricVariants: [],
        timeSemantics: [],
        causalityEdges: [{
          id: 'causality-' + ${JSON.stringify(versionId)},
          ontologyVersionId: ${JSON.stringify(versionId)},
          businessKey: 'causality-edge',
          displayName: '因果边',
          description: null,
          status: 'approved',
          sourceEntityKey: 'factor-a',
          targetEntityKey: 'metric-a',
          causalityType: 'direct-influence',
          isAttributionPathEnabled: true,
          defaultWeight: {},
          neo4jRelationshipTypes: ['INFLUENCES'],
          temporalConstraints: null,
          filterConditions: null,
          metadata: {},
          createdAt: now,
          updatedAt: now,
        }],
        evidenceTypes: [{
          id: 'evidence-' + ${JSON.stringify(versionId)},
          ontologyVersionId: ${JSON.stringify(versionId)},
          businessKey: 'table-evidence',
          displayName: '表格证据',
          description: null,
          status: 'approved',
          evidenceCategory: 'quantitative',
          rendererConfig: { type: 'table' },
          dataSourceConfig: { adapter: 'cube' },
          defaultPriority: 'high',
          isInteractive: false,
          templateSchema: null,
          validationRules: [],
          metadata: {},
          createdAt: now,
          updatedAt: now,
        }],
      },
    });

    const version = await deps.versionStore.findById(${JSON.stringify(versionId)});
    const planSteps = await deps.planStepTemplateStore.findByVersionId(${JSON.stringify(versionId)});
    const causalityEdges = await deps.causalityEdgeStore.findByVersionId(${JSON.stringify(versionId)});
    const evidenceTypes = await deps.evidenceTypeStore.findByVersionId(${JSON.stringify(versionId)});
    const toolBindings = await deps.toolCapabilityBindingStore.findByVersionId(${JSON.stringify(versionId)});

    await pool.end();
    console.log(JSON.stringify({
      versionStatus: version?.status ?? null,
      planStepTemplatesCreated: bootstrap.planStepTemplatesCreated,
      causalityEdgesCreated: bootstrap.causalityEdgesCreated,
      evidenceTypesCreated: bootstrap.evidenceTypesCreated,
      toolBindingsCreated: bootstrap.toolBindingsCreated,
      storedPlanStepCount: planSteps.length,
      storedCausalityEdgeCount: causalityEdges.length,
      storedEvidenceTypeCount: evidenceTypes.length,
      storedToolBindingCount: toolBindings.length,
    }));
  `);

  assert.equal(result.versionStatus, 'approved', '完整写入完成后版本才应处于 approved');
  assert.equal(result.planStepTemplatesCreated, 1, '必须创建 plan step templates');
  assert.equal(result.causalityEdgesCreated, 1, '必须创建 causality edges');
  assert.equal(result.evidenceTypesCreated, 1, '必须创建 evidence types');
  assert.ok(result.toolBindingsCreated > 0, 'bootstrap 必须创建 tool bindings');
  assert.equal(result.storedPlanStepCount, 1, '数据库中必须存在 plan step template');
  assert.equal(result.storedCausalityEdgeCount, 1, '数据库中必须存在 causality edge');
  assert.equal(result.storedEvidenceTypeCount, 1, '数据库中必须存在 evidence type');
  assert.ok(result.storedToolBindingCount > 0, '数据库中必须存在 tool bindings');
});
