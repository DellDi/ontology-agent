/**
 * Story 9.2: 指标口径、因素与时间语义治理化 — 集成测试
 *
 * 验证范围：
 * AC1: 系统优先从 ontology registry 读取正式治理定义
 * AC2: 治理覆盖 MetricVariant / TimeSemantic / CausalityEdge / EvidenceType
 * AC3: 收费类双口径 + 三类时间语义已进入正式治理模型
 * AC4: approved 生命周期约束——未 approved 定义不得进入默认运行时
 *
 * 测试类型：application / infrastructure 级集成测试（不依赖 next build）
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';

const execFileAsync = promisify(execFile);

const TEST_DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://ontology_agent:ontology_agent_dev_password@127.0.0.1:55432/ontology_agent';

async function runTsSnippet(code) {
  const { stdout } = await execFileAsync(
    'node',
    ['--import', 'tsx', '--input-type=module', '-e', code],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: TEST_DATABASE_URL,
      },
      timeout: 30_000,
    },
  );

  return JSON.parse(stdout.trim());
}

const TEST_VERSION_ID = `test-gov-${randomUUID()}`;
const TEST_SEMVER = '99.2.0-test';

// ---------------------------------------------------------------------------
// Setup: 创建测试版本并 approve
// ---------------------------------------------------------------------------

test('Setup: 创建 ontology version 并标记为 approved', async () => {
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
      semver: ${JSON.stringify(TEST_SEMVER)},
      displayName: 'Story 9.2 治理测试版本',
      description: '集成测试用版本',
      createdBy: 'story-9-2-test',
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
    console.log(JSON.stringify({ status: version.status }));
  `);

  assert.equal(result.status, 'approved', '测试版本应为 approved');
});

// ---------------------------------------------------------------------------
// AC2+AC3: 装载治理化 seed 数据
// ---------------------------------------------------------------------------

test('AC2+AC3 装载收费类双口径 metric variants', async () => {
  const result = await runTsSnippet(`
    import postgresClientModule from './src/infrastructure/postgres/client.ts';
    import metricVariantStoreModule from './src/infrastructure/ontology/postgres-ontology-metric-variant-store.ts';
    import seedModule from './src/domain/ontology/governance-seed.ts';
    const { createPostgresDb } = postgresClientModule;
    const { createPostgresOntologyMetricVariantStore } = metricVariantStoreModule;
    const { buildMetricVariantSeeds } = seedModule;

    const { db, pool } = createPostgresDb();
    const store = createPostgresOntologyMetricVariantStore(db);
    const now = new Date().toISOString();
    const seeds = buildMetricVariantSeeds(${JSON.stringify(TEST_VERSION_ID)}, now);
    const created = await store.bulkCreate(seeds);

    await pool.end();
    console.log(JSON.stringify({
      count: created.length,
      keys: created.map(v => v.businessKey).sort(),
      allApproved: created.every(v => v.status === 'approved'),
      hasProjectScope: created.some(v => v.semanticDiscriminator === 'project-scope'),
      hasTailArrearsScope: created.some(v => v.semanticDiscriminator === 'tail-arrears-scope'),
    }));
  `);

  assert.equal(result.count, 6, '应装载 6 个 metric variant（项目口径 3 + 尾欠口径 3）');
  assert.equal(result.allApproved, true, '所有 variant 状态应为 approved');
  assert.equal(result.hasProjectScope, true, '应有 project-scope 口径');
  assert.equal(result.hasTailArrearsScope, true, '应有 tail-arrears-scope 口径');
  assert.ok(result.keys.includes('project-collection-rate'), '应包含项目口径收缴率');
  assert.ok(result.keys.includes('tail-arrears-collection-rate'), '应包含尾欠口径收缴率');
});

test('AC3 装载三类时间语义', async () => {
  const result = await runTsSnippet(`
    import postgresClientModule from './src/infrastructure/postgres/client.ts';
    import timeSemanticStoreModule from './src/infrastructure/ontology/postgres-ontology-time-semantic-store.ts';
    import seedModule from './src/domain/ontology/governance-seed.ts';
    const { createPostgresDb } = postgresClientModule;
    const { createPostgresOntologyTimeSemanticStore } = timeSemanticStoreModule;
    const { buildTimeSemanticSeeds } = seedModule;

    const { db, pool } = createPostgresDb();
    const store = createPostgresOntologyTimeSemanticStore(db);
    const now = new Date().toISOString();
    const seeds = buildTimeSemanticSeeds(${JSON.stringify(TEST_VERSION_ID)}, now);
    const created = await store.bulkCreate(seeds);

    await pool.end();
    console.log(JSON.stringify({
      count: created.length,
      keys: created.map(v => v.businessKey).sort(),
      types: created.map(v => v.semanticType).sort(),
    }));
  `);

  assert.equal(result.count, 3, '应装载 3 个时间语义');
  assert.ok(result.keys.includes('receivable-accounting-period'), '应包含 receivable-accounting-period');
  assert.ok(result.keys.includes('billing-cycle-end-date'), '应包含 billing-cycle-end-date');
  assert.ok(result.keys.includes('payment-date'), '应包含 payment-date');
});

test('AC2 装载因果边定义', async () => {
  const result = await runTsSnippet(`
    import postgresClientModule from './src/infrastructure/postgres/client.ts';
    import causalityEdgeStoreModule from './src/infrastructure/ontology/postgres-ontology-causality-edge-store.ts';
    import seedModule from './src/domain/ontology/governance-seed.ts';
    const { createPostgresDb } = postgresClientModule;
    const { createPostgresOntologyCausalityEdgeStore } = causalityEdgeStoreModule;
    const { buildCausalityEdgeSeeds } = seedModule;

    const { db, pool } = createPostgresDb();
    const store = createPostgresOntologyCausalityEdgeStore(db);
    const now = new Date().toISOString();
    const seeds = buildCausalityEdgeSeeds(${JSON.stringify(TEST_VERSION_ID)}, now);
    const created = await store.bulkCreate(seeds);

    const attributionPaths = await store.findAttributionPaths(${JSON.stringify(TEST_VERSION_ID)});

    await pool.end();
    console.log(JSON.stringify({
      count: created.length,
      attributionCount: attributionPaths.length,
      allHaveAttribution: created.every(e => e.isAttributionPathEnabled),
    }));
  `);

  assert.equal(result.count, 4, '应装载 4 条因果边');
  assert.ok(result.attributionCount > 0, '应有可归因路径');
  assert.equal(result.allHaveAttribution, true, '所有 seed 因果边均启用归因路径');
});

test('AC2 装载证据类型定义', async () => {
  const result = await runTsSnippet(`
    import postgresClientModule from './src/infrastructure/postgres/client.ts';
    import evidenceTypeStoreModule from './src/infrastructure/ontology/postgres-ontology-evidence-type-definition-store.ts';
    import seedModule from './src/domain/ontology/governance-seed.ts';
    const { createPostgresDb } = postgresClientModule;
    const { createPostgresOntologyEvidenceTypeDefinitionStore } = evidenceTypeStoreModule;
    const { buildEvidenceTypeSeeds } = seedModule;

    const { db, pool } = createPostgresDb();
    const store = createPostgresOntologyEvidenceTypeDefinitionStore(db);
    const now = new Date().toISOString();
    const seeds = buildEvidenceTypeSeeds(${JSON.stringify(TEST_VERSION_ID)}, now);
    const created = await store.bulkCreate(seeds);

    await pool.end();
    console.log(JSON.stringify({
      count: created.length,
      keys: created.map(v => v.businessKey).sort(),
      categories: [...new Set(created.map(v => v.evidenceCategory))].sort(),
    }));
  `);

  assert.equal(result.count, 4, '应装载 4 种证据类型');
  assert.ok(result.keys.includes('table-evidence'), '应包含表格证据');
  assert.ok(result.keys.includes('graph-evidence'), '应包含图谱证据');
  assert.ok(result.keys.includes('erp-fact-evidence'), '应包含 ERP 事实证据');
  assert.ok(result.keys.includes('model-summary-evidence'), '应包含模型摘要证据');
});

// ---------------------------------------------------------------------------
// AC1: 按版本读取全量治理定义
// ---------------------------------------------------------------------------

test('AC1 getGovernanceDefinitionsByVersion 读取全量治理定义', async () => {
  const result = await runTsSnippet(`
    import postgresClientModule from './src/infrastructure/postgres/client.ts';
    import entityStoreModule from './src/infrastructure/ontology/postgres-ontology-entity-definition-store.ts';
    import metricStoreModule from './src/infrastructure/ontology/postgres-ontology-metric-definition-store.ts';
    import factorStoreModule from './src/infrastructure/ontology/postgres-ontology-factor-definition-store.ts';
    import planStepStoreModule from './src/infrastructure/ontology/postgres-ontology-plan-step-template-store.ts';
    import metricVariantStoreModule from './src/infrastructure/ontology/postgres-ontology-metric-variant-store.ts';
    import timeSemanticStoreModule from './src/infrastructure/ontology/postgres-ontology-time-semantic-store.ts';
    import causalityEdgeStoreModule from './src/infrastructure/ontology/postgres-ontology-causality-edge-store.ts';
    import evidenceTypeStoreModule from './src/infrastructure/ontology/postgres-ontology-evidence-type-definition-store.ts';
    import useCasesModule from './src/application/ontology/use-cases.ts';
    const { createPostgresDb } = postgresClientModule;
    const { createPostgresOntologyEntityDefinitionStore } = entityStoreModule;
    const { createPostgresOntologyMetricDefinitionStore } = metricStoreModule;
    const { createPostgresOntologyFactorDefinitionStore } = factorStoreModule;
    const { createPostgresOntologyPlanStepTemplateStore } = planStepStoreModule;
    const { createPostgresOntologyMetricVariantStore } = metricVariantStoreModule;
    const { createPostgresOntologyTimeSemanticStore } = timeSemanticStoreModule;
    const { createPostgresOntologyCausalityEdgeStore } = causalityEdgeStoreModule;
    const { createPostgresOntologyEvidenceTypeDefinitionStore } = evidenceTypeStoreModule;
    const { getGovernanceDefinitionsByVersion } = useCasesModule;

    const { db, pool } = createPostgresDb();
    const deps = {
      entityStore: createPostgresOntologyEntityDefinitionStore(db),
      metricStore: createPostgresOntologyMetricDefinitionStore(db),
      factorStore: createPostgresOntologyFactorDefinitionStore(db),
      planStepStore: createPostgresOntologyPlanStepTemplateStore(db),
      metricVariantStore: createPostgresOntologyMetricVariantStore(db),
      timeSemanticStore: createPostgresOntologyTimeSemanticStore(db),
      causalityEdgeStore: createPostgresOntologyCausalityEdgeStore(db),
      evidenceTypeStore: createPostgresOntologyEvidenceTypeDefinitionStore(db),
    };

    const defs = await getGovernanceDefinitionsByVersion(deps, ${JSON.stringify(TEST_VERSION_ID)});

    await pool.end();
    console.log(JSON.stringify({
      metricVariantCount: defs.metricVariants.length,
      timeSemanticCount: defs.timeSemantics.length,
      causalityEdgeCount: defs.causalityEdges.length,
      evidenceTypeCount: defs.evidenceTypes.length,
    }));
  `);

  assert.equal(result.metricVariantCount, 6, '应读到 6 个 metric variants');
  assert.equal(result.timeSemanticCount, 3, '应读到 3 个 time semantics');
  assert.equal(result.causalityEdgeCount, 4, '应读到 4 个 causality edges');
  assert.equal(result.evidenceTypeCount, 4, '应读到 4 个 evidence types');
});

// ---------------------------------------------------------------------------
// AC4: approved 生命周期约束——未 approved 不进入运行时
// ---------------------------------------------------------------------------

test('AC4 draft 定义不会进入 getApprovedGovernanceDefinitions', async () => {
  const result = await runTsSnippet(`
    import postgresClientModule from './src/infrastructure/postgres/client.ts';
    import versionStoreModule from './src/infrastructure/ontology/postgres-ontology-version-store.ts';
    import metricVariantStoreModule from './src/infrastructure/ontology/postgres-ontology-metric-variant-store.ts';
    import timeSemanticStoreModule from './src/infrastructure/ontology/postgres-ontology-time-semantic-store.ts';
    import causalityEdgeStoreModule from './src/infrastructure/ontology/postgres-ontology-causality-edge-store.ts';
    import evidenceTypeStoreModule from './src/infrastructure/ontology/postgres-ontology-evidence-type-definition-store.ts';
    import entityStoreModule from './src/infrastructure/ontology/postgres-ontology-entity-definition-store.ts';
    import metricStoreModule from './src/infrastructure/ontology/postgres-ontology-metric-definition-store.ts';
    import factorStoreModule from './src/infrastructure/ontology/postgres-ontology-factor-definition-store.ts';
    import planStepStoreModule from './src/infrastructure/ontology/postgres-ontology-plan-step-template-store.ts';
    import useCasesModule from './src/application/ontology/use-cases.ts';
    const { createPostgresDb } = postgresClientModule;
    const { createPostgresOntologyVersionStore } = versionStoreModule;
    const { createPostgresOntologyMetricVariantStore } = metricVariantStoreModule;
    const { createPostgresOntologyTimeSemanticStore } = timeSemanticStoreModule;
    const { createPostgresOntologyCausalityEdgeStore } = causalityEdgeStoreModule;
    const { createPostgresOntologyEvidenceTypeDefinitionStore } = evidenceTypeStoreModule;
    const { createPostgresOntologyEntityDefinitionStore } = entityStoreModule;
    const { createPostgresOntologyMetricDefinitionStore } = metricStoreModule;
    const { createPostgresOntologyFactorDefinitionStore } = factorStoreModule;
    const { createPostgresOntologyPlanStepTemplateStore } = planStepStoreModule;
    const { getApprovedGovernanceDefinitions } = useCasesModule;

    const { db, pool } = createPostgresDb();
    const versionStore = createPostgresOntologyVersionStore(db);
    const metricVariantStore = createPostgresOntologyMetricVariantStore(db);

    // 在已有的 approved 版本上插入一个 draft variant
    const now = new Date().toISOString();
    await metricVariantStore.bulkCreate([{
      id: 'draft-variant-test-' + Date.now(),
      ontologyVersionId: ${JSON.stringify(TEST_VERSION_ID)},
      parentMetricDefinitionId: 'collection-rate',
      businessKey: 'draft-test-variant',
      displayName: '测试 draft variant',
      description: null,
      status: 'draft',
      semanticDiscriminator: 'test',
      cubeViewMapping: {},
      filterTemplate: null,
      metadata: {},
      createdAt: now,
      updatedAt: now,
    }]);

    const deps = {
      versionStore,
      entityStore: createPostgresOntologyEntityDefinitionStore(db),
      metricStore: createPostgresOntologyMetricDefinitionStore(db),
      factorStore: createPostgresOntologyFactorDefinitionStore(db),
      planStepStore: createPostgresOntologyPlanStepTemplateStore(db),
      metricVariantStore,
      timeSemanticStore: createPostgresOntologyTimeSemanticStore(db),
      causalityEdgeStore: createPostgresOntologyCausalityEdgeStore(db),
      evidenceTypeStore: createPostgresOntologyEvidenceTypeDefinitionStore(db),
    };

    const result = await getApprovedGovernanceDefinitions(deps);

    await pool.end();

    if (!result) {
      console.log(JSON.stringify({ found: false }));
    } else {
      const hasDraftVariant = result.definitions.metricVariants.some(
        v => v.businessKey === 'draft-test-variant'
      );
      console.log(JSON.stringify({
        found: true,
        versionStatus: result.version.status,
        metricVariantCount: result.definitions.metricVariants.length,
        hasDraftVariant,
      }));
    }
  `);

  assert.equal(result.found, true, '应找到 approved 版本');
  assert.equal(result.hasDraftVariant, false, 'draft variant 不得出现在 approved 过滤结果中');
  assert.equal(result.metricVariantCount, 6, 'approved variants 仍为 6（不含 draft）');
});

// ---------------------------------------------------------------------------
// AC3: Cube 映射关系验证
// ---------------------------------------------------------------------------

test('AC3 metric variant 的 cubeViewMapping 包含正确的 Cube 映射', async () => {
  const result = await runTsSnippet(`
    import postgresClientModule from './src/infrastructure/postgres/client.ts';
    import metricVariantStoreModule from './src/infrastructure/ontology/postgres-ontology-metric-variant-store.ts';
    const { createPostgresDb } = postgresClientModule;
    const { createPostgresOntologyMetricVariantStore } = metricVariantStoreModule;

    const { db, pool } = createPostgresDb();
    const store = createPostgresOntologyMetricVariantStore(db);

    const projectRate = await store.findByVersionAndKey(
      ${JSON.stringify(TEST_VERSION_ID)},
      'project-collection-rate',
    );
    const tailRate = await store.findByVersionAndKey(
      ${JSON.stringify(TEST_VERSION_ID)},
      'tail-arrears-collection-rate',
    );

    await pool.end();
    console.log(JSON.stringify({
      projectRateHasFormula: !!projectRate?.cubeViewMapping?.formula,
      projectRateNumerator: projectRate?.cubeViewMapping?.numeratorMetricKey ?? null,
      tailRateHasFormula: !!tailRate?.cubeViewMapping?.formula,
      tailRateDenominator: tailRate?.cubeViewMapping?.denominatorMetricKey ?? null,
    }));
  `);

  assert.equal(result.projectRateHasFormula, true, '项目口径收缴率应包含 formula');
  assert.equal(result.projectRateNumerator, 'project-paid-amount', 'numerator 应为 project-paid-amount');
  assert.equal(result.tailRateHasFormula, true, '尾欠口径收缴率应包含 formula');
  assert.equal(result.tailRateDenominator, 'tail-arrears-receivable-amount', 'denominator 应为 tail-arrears-receivable-amount');
});

test('AC3 time semantic 的 cubeTimeDimensionMapping 包含正确的 Cube 映射', async () => {
  const result = await runTsSnippet(`
    import postgresClientModule from './src/infrastructure/postgres/client.ts';
    import timeSemanticStoreModule from './src/infrastructure/ontology/postgres-ontology-time-semantic-store.ts';
    const { createPostgresDb } = postgresClientModule;
    const { createPostgresOntologyTimeSemanticStore } = timeSemanticStoreModule;

    const { db, pool } = createPostgresDb();
    const store = createPostgresOntologyTimeSemanticStore(db);

    const rap = await store.findByVersionAndKey(
      ${JSON.stringify(TEST_VERSION_ID)},
      'receivable-accounting-period',
    );
    const paymentDate = await store.findByVersionAndKey(
      ${JSON.stringify(TEST_VERSION_ID)},
      'payment-date',
    );

    await pool.end();
    console.log(JSON.stringify({
      rapCubeDimension: rap?.cubeTimeDimensionMapping?.cubeDimension ?? null,
      rapDefaultGranularity: rap?.defaultGranularity ?? null,
      paymentCubeDimension: paymentDate?.cubeTimeDimensionMapping?.cubeDimension ?? null,
      paymentDefaultGranularity: paymentDate?.defaultGranularity ?? null,
    }));
  `);

  assert.equal(result.rapCubeDimension, 'FinanceReceivables.receivableAccountingPeriod', '应收账期对应正确 Cube dimension');
  assert.equal(result.rapDefaultGranularity, 'year', '应收账期默认粒度应为 year');
  assert.equal(result.paymentCubeDimension, 'FinancePayments.paymentDate', '缴款日期对应正确 Cube dimension');
  assert.equal(result.paymentDefaultGranularity, 'month', '缴款日期默认粒度应为 month');
});

// ---------------------------------------------------------------------------
// AC4: 运行时映射层优先消费 approved governance definitions
// ---------------------------------------------------------------------------

test('AC4 旧运行时映射层优先消费最新 approved governance definitions', async () => {
  const result = await runTsSnippet(`
    import postgresClientModule from './src/infrastructure/postgres/client.ts';
    import versionStoreModule from './src/infrastructure/ontology/postgres-ontology-version-store.ts';
    import metricVariantStoreModule from './src/infrastructure/ontology/postgres-ontology-metric-variant-store.ts';
    import timeSemanticStoreModule from './src/infrastructure/ontology/postgres-ontology-time-semantic-store.ts';
    import entityStoreModule from './src/infrastructure/ontology/postgres-ontology-entity-definition-store.ts';
    import metricStoreModule from './src/infrastructure/ontology/postgres-ontology-metric-definition-store.ts';
    import factorStoreModule from './src/infrastructure/ontology/postgres-ontology-factor-definition-store.ts';
    import planStepStoreModule from './src/infrastructure/ontology/postgres-ontology-plan-step-template-store.ts';
    import causalityEdgeStoreModule from './src/infrastructure/ontology/postgres-ontology-causality-edge-store.ts';
    import evidenceTypeStoreModule from './src/infrastructure/ontology/postgres-ontology-evidence-type-definition-store.ts';
    import useCasesModule from './src/application/ontology/use-cases.ts';
    import seedModule from './src/domain/ontology/governance-seed.ts';
    import metricCatalogModule from './src/infrastructure/cube/metric-catalog.ts';
    const { createPostgresDb } = postgresClientModule;
    const { createPostgresOntologyVersionStore } = versionStoreModule;
    const { createPostgresOntologyMetricVariantStore } = metricVariantStoreModule;
    const { createPostgresOntologyTimeSemanticStore } = timeSemanticStoreModule;
    const { createPostgresOntologyEntityDefinitionStore } = entityStoreModule;
    const { createPostgresOntologyMetricDefinitionStore } = metricStoreModule;
    const { createPostgresOntologyFactorDefinitionStore } = factorStoreModule;
    const { createPostgresOntologyPlanStepTemplateStore } = planStepStoreModule;
    const { createPostgresOntologyCausalityEdgeStore } = causalityEdgeStoreModule;
    const { createPostgresOntologyEvidenceTypeDefinitionStore } = evidenceTypeStoreModule;
    const { createOntologyVersion, loadGovernanceDefinitions, getApprovedGovernanceDefinitions } = useCasesModule;
    const { buildMetricVariantSeeds, buildTimeSemanticSeeds } = seedModule;
    const { buildGovernedSemanticMetrics, mergeGovernedSemanticMetrics, getSemanticMetricDefinition } = metricCatalogModule;

    const { db, pool } = createPostgresDb();
    const versionStore = createPostgresOntologyVersionStore(db);
    const metricVariantStore = createPostgresOntologyMetricVariantStore(db);
    const timeSemanticStore = createPostgresOntologyTimeSemanticStore(db);

    const newerVersionId = 'test-gov-runtime-' + Date.now();
    const createdAt = '2099-01-01T00:00:00.000Z';
    const publishedAt = '2099-01-01T00:05:00.000Z';

    await createOntologyVersion({ versionStore }, {
      id: newerVersionId,
      semver: '99.2.1-runtime',
      displayName: 'Story 9.2 运行时 catalog 测试版本',
      description: '验证最新 approved 版本会覆盖 legacy catalog',
      createdBy: 'story-9-2-test',
      createdAt,
      updatedAt: createdAt,
    });

    await versionStore.updateStatus(
      newerVersionId,
      'approved',
      publishedAt,
      { publishedAt },
    );

    const metricVariants = buildMetricVariantSeeds(newerVersionId, createdAt).map((item) =>
      item.businessKey === 'project-collection-rate'
        ? {
            ...item,
            displayName: '治理版项目口径收缴率',
            description: '以治理版本覆盖 legacy metric catalog 的显示名与定义。',
            metadata: {
              ...item.metadata,
              sourceFact: '治理版应收主题 + 缴款主题（项目口径）',
            },
          }
        : item,
    );

    await loadGovernanceDefinitions(
      { metricVariantStore, timeSemanticStore, causalityEdgeStore: { bulkCreate: async () => [] }, evidenceTypeStore: { bulkCreate: async () => [] } },
      {
        ontologyVersionId: newerVersionId,
        metricVariants,
        timeSemantics: buildTimeSemanticSeeds(newerVersionId, createdAt),
        causalityEdges: [],
        evidenceTypes: [],
      },
    );

    const approved = await getApprovedGovernanceDefinitions({
      versionStore,
      entityStore: createPostgresOntologyEntityDefinitionStore(db),
      metricStore: createPostgresOntologyMetricDefinitionStore(db),
      factorStore: createPostgresOntologyFactorDefinitionStore(db),
      planStepStore: createPostgresOntologyPlanStepTemplateStore(db),
      metricVariantStore,
      timeSemanticStore,
      causalityEdgeStore: createPostgresOntologyCausalityEdgeStore(db),
      evidenceTypeStore: createPostgresOntologyEvidenceTypeDefinitionStore(db),
    });

    const catalog = approved
      ? mergeGovernedSemanticMetrics(buildGovernedSemanticMetrics(approved.definitions))
      : [];
    const governed = getSemanticMetricDefinition('project-collection-rate', catalog);
    const serviceOrder = getSemanticMetricDefinition('service-order-count', catalog);

    await pool.end();
    console.log(JSON.stringify({
      projectTitle: governed?.title ?? null,
      projectDefinition: governed?.businessDefinition ?? null,
      projectSourceFact: governed?.sourceFact ?? null,
      serviceOrderTitle: serviceOrder?.title ?? null,
      catalogSize: catalog.length,
    }));
  `);

  assert.equal(result.projectTitle, '治理版项目口径收缴率', '运行时 catalog 应优先消费 approved governance 定义');
  assert.match(result.projectDefinition, /覆盖 legacy metric catalog/);
  assert.equal(result.projectSourceFact, '治理版应收主题 + 缴款主题（项目口径）');
  assert.equal(result.serviceOrderTitle, '工单总量', '未治理化的工单指标仍应保留 transitional path');
  assert.ok(result.catalogSize >= 11, '运行时 catalog 应保留完整可用指标集合');
});

// ---------------------------------------------------------------------------
// AC4: 架构约束——新 store 不直接依赖 Neo4j / Cube
// ---------------------------------------------------------------------------

test('AC4 治理 store 源码不直接 import Neo4j 或 Cube adapter', async () => {
  const result = await runTsSnippet(`
    import { readFile } from 'node:fs/promises';

    const files = [
      './src/infrastructure/ontology/postgres-ontology-metric-variant-store.ts',
      './src/infrastructure/ontology/postgres-ontology-time-semantic-store.ts',
      './src/infrastructure/ontology/postgres-ontology-causality-edge-store.ts',
      './src/infrastructure/ontology/postgres-ontology-evidence-type-definition-store.ts',
    ];

    const sources = await Promise.all(files.map((file) => readFile(file, 'utf8')));
    const allSources = sources.join('\\n');

    const usesNeo4jImport =
      /from ['"][^'"]*neo4j[^'"]*['"]/.test(allSources) ||
      /neo4j-driver/.test(allSources);
    const usesCubeImport =
      /from ['"][^'"]*cube[^'"]*['"]/.test(allSources) ||
      /cubejs/.test(allSources);

    console.log(JSON.stringify({ usesNeo4jImport, usesCubeImport }));
  `);

  assert.equal(result.usesNeo4jImport, false, 'Governance store 不得直接 import Neo4j');
  assert.equal(result.usesCubeImport, false, 'Governance store 不得直接 import Cube');
});

// ---------------------------------------------------------------------------
// Domain model: filterApprovedOnly 单元验证
// ---------------------------------------------------------------------------

test('AC4 filterApprovedOnly 函数正确过滤', async () => {
  const result = await runTsSnippet(`
    import modelsModule from './src/domain/ontology/models.ts';
    const { filterApprovedOnly } = modelsModule;

    const items = [
      { status: 'draft', key: 'a' },
      { status: 'approved', key: 'b' },
      { status: 'review', key: 'c' },
      { status: 'approved', key: 'd' },
      { status: 'deprecated', key: 'e' },
      { status: 'retired', key: 'f' },
    ];

    const filtered = filterApprovedOnly(items);
    console.log(JSON.stringify({
      count: filtered.length,
      keys: filtered.map(i => i.key),
    }));
  `);

  assert.equal(result.count, 2, '只应保留 approved 状态的项');
  assert.deepEqual(result.keys, ['b', 'd'], '过滤结果应为 key b 和 d');
});
