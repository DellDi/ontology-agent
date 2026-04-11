/**
 * Story 9.1: 最小本体注册表与版本模型 — 集成测试
 *
 * 验证范围：
 * AC1: 从正式 platform 表读取版本化 ontology definitions
 * AC2: 版本生命周期状态（draft / review / approved / deprecated / retired）
 * AC3: 最小 registry 覆盖实体、指标、候选因素、计划步骤模板
 * AC4: Canonical store 在 Postgres platform schema，通过 application use case 访问
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
    },
  );

  return JSON.parse(stdout.trim());
}

const TEST_VERSION_ID = `test-ontv-${randomUUID()}`;
const TEST_SEMVER = '99.0.0-test';

test('AC2 创建 ontology version 初始状态为 draft', async () => {
  const result = await runTsSnippet(`
    import postgresClientModule from './src/infrastructure/postgres/client.ts';
    import versionStoreModule from './src/infrastructure/ontology/postgres-ontology-version-store.ts';
    import useCasesModule from './src/application/ontology/use-cases.ts';
    const { createPostgresDb } = postgresClientModule;
    const { createPostgresOntologyVersionStore } = versionStoreModule;
    const { createOntologyVersion } = useCasesModule;

    const { db, pool } = createPostgresDb();
    const versionStore = createPostgresOntologyVersionStore(db);

    const version = await createOntologyVersion({ versionStore }, {
      id: ${JSON.stringify(TEST_VERSION_ID)},
      semver: ${JSON.stringify(TEST_SEMVER)},
      displayName: 'Story 9.1 测试版本',
      description: '集成测试用版本，可安全清理',
      createdBy: 'story-9-1-test',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await pool.end();
    console.log(JSON.stringify(version));
  `);

  assert.equal(result.id, TEST_VERSION_ID, '版本 ID 应与输入一致');
  assert.equal(result.semver, TEST_SEMVER, 'semver 应与输入一致');
  assert.equal(result.status, 'draft', '新创建版本状态必须为 draft');
  assert.equal(result.publishedAt, null, 'draft 版本 publishedAt 应为 null');
  assert.ok(result.createdAt, 'createdAt 应存在');
});

test('AC2 通过 findById 能读取已创建的版本', async () => {
  const result = await runTsSnippet(`
    import postgresClientModule from './src/infrastructure/postgres/client.ts';
    import versionStoreModule from './src/infrastructure/ontology/postgres-ontology-version-store.ts';
    import useCasesModule from './src/application/ontology/use-cases.ts';
    const { createPostgresDb } = postgresClientModule;
    const { createPostgresOntologyVersionStore } = versionStoreModule;
    const { getOntologyVersionById } = useCasesModule;

    const { db, pool } = createPostgresDb();
    const versionStore = createPostgresOntologyVersionStore(db);

    const version = await getOntologyVersionById({ versionStore }, ${JSON.stringify(TEST_VERSION_ID)});

    await pool.end();
    console.log(JSON.stringify(version));
  `);

  assert.ok(result !== null, '应能查到版本');
  assert.equal(result.id, TEST_VERSION_ID, '版本 ID 匹配');
  assert.equal(result.status, 'draft', '状态应为 draft');
});

test('AC2 版本状态流转：draft -> approved，publishedAt 被记录', async () => {
  const result = await runTsSnippet(`
    import postgresClientModule from './src/infrastructure/postgres/client.ts';
    import versionStoreModule from './src/infrastructure/ontology/postgres-ontology-version-store.ts';
    const { createPostgresDb } = postgresClientModule;
    const { createPostgresOntologyVersionStore } = versionStoreModule;

    const { db, pool } = createPostgresDb();
    const versionStore = createPostgresOntologyVersionStore(db);

    const publishedAt = new Date().toISOString();
    const version = await versionStore.updateStatus(
      ${JSON.stringify(TEST_VERSION_ID)},
      'approved',
      publishedAt,
      { publishedAt },
    );

    await pool.end();
    console.log(JSON.stringify(version));
  `);

  assert.equal(result.status, 'approved', '状态应更新为 approved');
  assert.ok(result.publishedAt, 'publishedAt 应被写入');
});

test('AC2 findCurrentApproved 可读取当前生效版本', async () => {
  const result = await runTsSnippet(`
    import postgresClientModule from './src/infrastructure/postgres/client.ts';
    import versionStoreModule from './src/infrastructure/ontology/postgres-ontology-version-store.ts';
    import useCasesModule from './src/application/ontology/use-cases.ts';
    const { createPostgresDb } = postgresClientModule;
    const { createPostgresOntologyVersionStore } = versionStoreModule;
    const { getCurrentApprovedVersion } = useCasesModule;

    const { db, pool } = createPostgresDb();
    const versionStore = createPostgresOntologyVersionStore(db);

    const version = await getCurrentApprovedVersion({ versionStore });

    await pool.end();
    console.log(JSON.stringify(version));
  `);

  assert.ok(result !== null, '至少应有一个 approved 版本');
  assert.equal(result.status, 'approved', '返回的版本状态必须为 approved');
});

test('AC3 装载最小 definitions（实体、指标、因素、计划步骤）', async () => {
  const now = new Date().toISOString();

  const result = await runTsSnippet(`
    import postgresClientModule from './src/infrastructure/postgres/client.ts';
    import entityStoreModule from './src/infrastructure/ontology/postgres-ontology-entity-definition-store.ts';
    import metricStoreModule from './src/infrastructure/ontology/postgres-ontology-metric-definition-store.ts';
    import factorStoreModule from './src/infrastructure/ontology/postgres-ontology-factor-definition-store.ts';
    import planStepStoreModule from './src/infrastructure/ontology/postgres-ontology-plan-step-template-store.ts';
    import useCasesModule from './src/application/ontology/use-cases.ts';
    const { createPostgresDb } = postgresClientModule;
    const { createPostgresOntologyEntityDefinitionStore } = entityStoreModule;
    const { createPostgresOntologyMetricDefinitionStore } = metricStoreModule;
    const { createPostgresOntologyFactorDefinitionStore } = factorStoreModule;
    const { createPostgresOntologyPlanStepTemplateStore } = planStepStoreModule;
    const { loadOntologyDefinitions } = useCasesModule;

    const versionId = ${JSON.stringify(TEST_VERSION_ID)};
    const now = ${JSON.stringify(now)};

    const { db, pool } = createPostgresDb();
    const entityStore = createPostgresOntologyEntityDefinitionStore(db);
    const metricStore = createPostgresOntologyMetricDefinitionStore(db);
    const factorStore = createPostgresOntologyFactorDefinitionStore(db);
    const planStepStore = createPostgresOntologyPlanStepTemplateStore(db);

    const result = await loadOntologyDefinitions(
      { entityStore, metricStore, factorStore, planStepStore },
      {
        ontologyVersionId: versionId,
        entities: [
          {
            id: versionId + ':entity:project',
            ontologyVersionId: versionId,
            businessKey: 'project',
            displayName: '项目',
            description: '物业管理项目',
            status: 'approved',
            synonyms: ['楼盘', '小区'],
            parentBusinessKey: null,
            metadata: {},
            createdAt: now,
            updatedAt: now,
          },
        ],
        metrics: [
          {
            id: versionId + ':metric:collection-rate',
            ontologyVersionId: versionId,
            businessKey: 'project-collection-rate',
            displayName: '项目口径收缴率',
            description: '项目口径年收缴率',
            status: 'approved',
            applicableSubjectKeys: ['project'],
            defaultAggregation: 'ratio',
            unit: '%',
            metadata: {},
            createdAt: now,
            updatedAt: now,
          },
        ],
        factors: [
          {
            id: versionId + ':factor:fee-policy-reach',
            ontologyVersionId: versionId,
            businessKey: 'fee-policy-reach',
            displayName: '收费政策触达',
            description: '收费政策触达情况',
            status: 'approved',
            category: '收费结构',
            relatedMetricKeys: ['project-collection-rate'],
            metadata: {},
            createdAt: now,
            updatedAt: now,
          },
        ],
        planStepTemplates: [
          {
            id: versionId + ':plan-step:confirm-query-scope',
            ontologyVersionId: versionId,
            businessKey: 'confirm-query-scope',
            displayName: '确认查询口径',
            description: '确认目标指标查询口径',
            status: 'approved',
            intentTypes: ['fee-analysis'],
            requiredCapabilities: ['semantic-query'],
            sortOrder: 1,
            metadata: {},
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
    );

    await pool.end();
    console.log(JSON.stringify({
      entityCount: result.entities.length,
      metricCount: result.metrics.length,
      factorCount: result.factors.length,
      planStepCount: result.planStepTemplates.length,
    }));
  `);

  assert.equal(result.entityCount, 1, '应装载 1 个实体定义');
  assert.equal(result.metricCount, 1, '应装载 1 个指标定义');
  assert.equal(result.factorCount, 1, '应装载 1 个候选因素定义');
  assert.equal(result.planStepCount, 1, '应装载 1 个计划步骤模板');
});

test('AC1 按版本 ID 读取全量 definitions（通过 application use case）', async () => {
  const result = await runTsSnippet(`
    import postgresClientModule from './src/infrastructure/postgres/client.ts';
    import entityStoreModule from './src/infrastructure/ontology/postgres-ontology-entity-definition-store.ts';
    import metricStoreModule from './src/infrastructure/ontology/postgres-ontology-metric-definition-store.ts';
    import factorStoreModule from './src/infrastructure/ontology/postgres-ontology-factor-definition-store.ts';
    import planStepStoreModule from './src/infrastructure/ontology/postgres-ontology-plan-step-template-store.ts';
    import useCasesModule from './src/application/ontology/use-cases.ts';
    const { createPostgresDb } = postgresClientModule;
    const { createPostgresOntologyEntityDefinitionStore } = entityStoreModule;
    const { createPostgresOntologyMetricDefinitionStore } = metricStoreModule;
    const { createPostgresOntologyFactorDefinitionStore } = factorStoreModule;
    const { createPostgresOntologyPlanStepTemplateStore } = planStepStoreModule;
    const { getDefinitionsByVersion } = useCasesModule;

    const { db, pool } = createPostgresDb();
    const deps = {
      entityStore: createPostgresOntologyEntityDefinitionStore(db),
      metricStore: createPostgresOntologyMetricDefinitionStore(db),
      factorStore: createPostgresOntologyFactorDefinitionStore(db),
      planStepStore: createPostgresOntologyPlanStepTemplateStore(db),
    };

    const defs = await getDefinitionsByVersion(deps, ${JSON.stringify(TEST_VERSION_ID)});

    await pool.end();
    console.log(JSON.stringify({
      entityCount: defs.entities.length,
      metricCount: defs.metrics.length,
      factorCount: defs.factors.length,
      planStepCount: defs.planStepTemplates.length,
      firstEntityKey: defs.entities[0]?.businessKey ?? null,
      firstMetricKey: defs.metrics[0]?.businessKey ?? null,
      firstFactorCategory: defs.factors[0]?.category ?? null,
      firstStepOrder: defs.planStepTemplates[0]?.sortOrder ?? null,
    }));
  `);

  assert.ok(result.entityCount >= 1, '应读到至少 1 个实体定义');
  assert.ok(result.metricCount >= 1, '应读到至少 1 个指标定义');
  assert.ok(result.factorCount >= 1, '应读到至少 1 个候选因素定义');
  assert.ok(result.planStepCount >= 1, '应读到至少 1 个计划步骤模板');
  assert.equal(result.firstEntityKey, 'project', '第一个实体 businessKey 应为 project');
  assert.equal(
    result.firstMetricKey,
    'project-collection-rate',
    '第一个指标 businessKey 应为 project-collection-rate',
  );
  assert.equal(result.firstFactorCategory, '收费结构', '因素类别应为收费结构');
  assert.equal(result.firstStepOrder, 1, '计划步骤 sortOrder 应为 1');
});

test('AC3+AC4 findByVersionAndKey 精确按 businessKey 读取定义', async () => {
  const result = await runTsSnippet(`
    import postgresClientModule from './src/infrastructure/postgres/client.ts';
    import entityStoreModule from './src/infrastructure/ontology/postgres-ontology-entity-definition-store.ts';
    const { createPostgresDb } = postgresClientModule;
    const { createPostgresOntologyEntityDefinitionStore } = entityStoreModule;

    const { db, pool } = createPostgresDb();
    const entityStore = createPostgresOntologyEntityDefinitionStore(db);

    const entity = await entityStore.findByVersionAndKey(
      ${JSON.stringify(TEST_VERSION_ID)},
      'project',
    );

    await pool.end();
    console.log(JSON.stringify(entity));
  `);

  assert.ok(result !== null, '应能按 businessKey 精确查到定义');
  assert.equal(result.businessKey, 'project', 'businessKey 应为 project');
  assert.equal(result.status, 'approved', '状态应为 approved');
  assert.deepEqual(result.synonyms, ['楼盘', '小区'], '同义词应正确读取');
});

test('AC1+AC4 getCurrentApprovedDefinitions 通过 application use case 获取当前生效版本及定义', async () => {
  const result = await runTsSnippet(`
    import postgresClientModule from './src/infrastructure/postgres/client.ts';
    import versionStoreModule from './src/infrastructure/ontology/postgres-ontology-version-store.ts';
    import entityStoreModule from './src/infrastructure/ontology/postgres-ontology-entity-definition-store.ts';
    import metricStoreModule from './src/infrastructure/ontology/postgres-ontology-metric-definition-store.ts';
    import factorStoreModule from './src/infrastructure/ontology/postgres-ontology-factor-definition-store.ts';
    import planStepStoreModule from './src/infrastructure/ontology/postgres-ontology-plan-step-template-store.ts';
    import useCasesModule from './src/application/ontology/use-cases.ts';
    const { createPostgresDb } = postgresClientModule;
    const { createPostgresOntologyVersionStore } = versionStoreModule;
    const { createPostgresOntologyEntityDefinitionStore } = entityStoreModule;
    const { createPostgresOntologyMetricDefinitionStore } = metricStoreModule;
    const { createPostgresOntologyFactorDefinitionStore } = factorStoreModule;
    const { createPostgresOntologyPlanStepTemplateStore } = planStepStoreModule;
    const { getCurrentApprovedDefinitions } = useCasesModule;

    const { db, pool } = createPostgresDb();
    const deps = {
      versionStore: createPostgresOntologyVersionStore(db),
      entityStore: createPostgresOntologyEntityDefinitionStore(db),
      metricStore: createPostgresOntologyMetricDefinitionStore(db),
      factorStore: createPostgresOntologyFactorDefinitionStore(db),
      planStepStore: createPostgresOntologyPlanStepTemplateStore(db),
    };

    const result = await getCurrentApprovedDefinitions(deps);

    await pool.end();

    if (!result) {
      console.log(JSON.stringify({ found: false }));
    } else {
      console.log(JSON.stringify({
        found: true,
        versionStatus: result.version.status,
        entityCount: result.definitions.entities.length,
        metricCount: result.definitions.metrics.length,
        factorCount: result.definitions.factors.length,
        planStepCount: result.definitions.planStepTemplates.length,
      }));
    }
  `);

  assert.equal(result.found, true, '应存在已 approved 的 ontology version');
  assert.equal(result.versionStatus, 'approved', '版本状态应为 approved');
  assert.ok(result.entityCount >= 1, '应有实体定义');
  assert.ok(result.metricCount >= 1, '应有指标定义');
  assert.ok(result.factorCount >= 1, '应有候选因素定义');
  assert.ok(result.planStepCount >= 1, '应有计划步骤模板');
});

test('AC2 版本状态流转：approved -> deprecated，deprecatedAt 被记录', async () => {
  const result = await runTsSnippet(`
    import postgresClientModule from './src/infrastructure/postgres/client.ts';
    import versionStoreModule from './src/infrastructure/ontology/postgres-ontology-version-store.ts';
    const { createPostgresDb } = postgresClientModule;
    const { createPostgresOntologyVersionStore } = versionStoreModule;

    const { db, pool } = createPostgresDb();
    const versionStore = createPostgresOntologyVersionStore(db);

    const deprecatedAt = new Date().toISOString();
    const version = await versionStore.updateStatus(
      ${JSON.stringify(TEST_VERSION_ID)},
      'deprecated',
      deprecatedAt,
      { deprecatedAt },
    );

    await pool.end();
    console.log(JSON.stringify(version));
  `);

  assert.equal(result.status, 'deprecated', '状态应更新为 deprecated');
  assert.ok(result.deprecatedAt, 'deprecatedAt 应被写入');
});

test('AC2 DEFINITION_LIFECYCLE_STATES 枚举完整性验证', async () => {
  const result = await runTsSnippet(`
    import ontologyModels from './src/domain/ontology/models.ts';
    const { DEFINITION_LIFECYCLE_STATES } = ontologyModels;
    console.log(JSON.stringify([...DEFINITION_LIFECYCLE_STATES]));
  `);

  const expected = ['draft', 'review', 'approved', 'deprecated', 'retired'];
  assert.deepEqual(result, expected, '生命周期枚举必须覆盖所有规定状态');
});

test('AC4 Neo4j / Cube 不是 canonical ontology 事实源（架构约束文档验证）', async () => {
  const result = await runTsSnippet(`
    import versionStoreModule from './src/infrastructure/ontology/postgres-ontology-version-store.ts';
    import entityStoreModule from './src/infrastructure/ontology/postgres-ontology-entity-definition-store.ts';
    import metricStoreModule from './src/infrastructure/ontology/postgres-ontology-metric-definition-store.ts';
    import factorStoreModule from './src/infrastructure/ontology/postgres-ontology-factor-definition-store.ts';
    import planStepStoreModule from './src/infrastructure/ontology/postgres-ontology-plan-step-template-store.ts';
    const { createPostgresOntologyVersionStore } = versionStoreModule;
    const { createPostgresOntologyEntityDefinitionStore } = entityStoreModule;
    const { createPostgresOntologyMetricDefinitionStore } = metricStoreModule;
    const { createPostgresOntologyFactorDefinitionStore } = factorStoreModule;
    const { createPostgresOntologyPlanStepTemplateStore } = planStepStoreModule;

    const versionStoreSource = createPostgresOntologyVersionStore.toString();
    const entityStoreSource = createPostgresOntologyEntityDefinitionStore.toString();
    const metricStoreSource = createPostgresOntologyMetricDefinitionStore.toString();
    const factorStoreSource = createPostgresOntologyFactorDefinitionStore.toString();
    const planStepStoreSource = createPostgresOntologyPlanStepTemplateStore.toString();

    const allSources = [versionStoreSource, entityStoreSource, metricStoreSource, factorStoreSource, planStepStoreSource].join('\\n');

    const usesNeo4j = allSources.includes('neo4j') || allSources.includes('Neo4j');
    const usesCube = allSources.includes('Cube') || allSources.includes('cubejs');

    console.log(JSON.stringify({ usesNeo4j, usesCube }));
  `);

  assert.equal(result.usesNeo4j, false, 'Ontology registry store 不得直接依赖 Neo4j');
  assert.equal(result.usesCube, false, 'Ontology registry store 不得直接依赖 Cube');
});
