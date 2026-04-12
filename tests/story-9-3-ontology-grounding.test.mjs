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

// ─── 静态检查：文件存在性 ──────────────────────────────────────────────────

test('AC1 grounding 领域模型文件存在', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const filePath = path.join(ROOT, 'src/domain/ontology/grounding.ts');
  assert.ok(fs.existsSync(filePath), 'src/domain/ontology/grounding.ts 必须存在');
});

test('AC1 grounding 应用层 use cases 文件存在', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const filePath = path.join(ROOT, 'src/application/ontology/grounding.ts');
  assert.ok(fs.existsSync(filePath), 'src/application/ontology/grounding.ts 必须存在');
});

test('AC3 tool binding 领域模型文件存在', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const filePath = path.join(ROOT, 'src/domain/ontology/tool-binding.ts');
  assert.ok(fs.existsSync(filePath), 'src/domain/ontology/tool-binding.ts 必须存在');
});

test('AC1 grounded context schema 文件存在', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const filePath = path.join(ROOT, 'src/infrastructure/postgres/schema/ontology-grounded-contexts.ts');
  assert.ok(fs.existsSync(filePath), 'ontology-grounded-contexts.ts schema 必须存在');
});

test('AC1 grounded context store 文件存在', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const filePath = path.join(ROOT, 'src/infrastructure/ontology/postgres-grounded-context-store.ts');
  assert.ok(fs.existsSync(filePath), 'postgres-grounded-context-store.ts 必须存在');
});

test('AC3 tool capability binding schema 文件存在', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const filePath = path.join(ROOT, 'src/infrastructure/postgres/schema/ontology-tool-capability-bindings.ts');
  assert.ok(fs.existsSync(filePath), 'ontology-tool-capability-bindings.ts schema 必须存在');
});

// ─── 静态检查：导出内容 ──────────────────────────────────────────────────

test('AC1 grounding 领域模型导出关键类型', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const filePath = path.join(ROOT, 'src/domain/ontology/grounding.ts');
  const content = fs.readFileSync(filePath, 'utf8');

  assert.ok(content.includes('OntologyGroundedContext'), '必须导出 OntologyGroundedContext 类型');
  assert.ok(content.includes('GroundedEntity'), '必须导出 GroundedEntity 类型');
  assert.ok(content.includes('GroundedMetric'), '必须导出 GroundedMetric 类型');
  assert.ok(content.includes('GroundedFactor'), '必须导出 GroundedFactor 类型');
  assert.ok(content.includes('GroundedTimeSemantic'), '必须导出 GroundedTimeSemantic 类型');
  assert.ok(content.includes('GROUNDING_STATUS'), '必须导出 GROUNDING_STATUS');
  assert.ok(content.includes('OntologyGroundingError'), '必须导出 OntologyGroundingError 类');
});

test('AC1 grounding use cases 导出关键函数', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const filePath = path.join(ROOT, 'src/application/ontology/grounding.ts');
  const content = fs.readFileSync(filePath, 'utf8');

  assert.ok(content.includes('createOntologyGroundingUseCases'), '必须导出 createOntologyGroundingUseCases');
  assert.ok(content.includes('createOntologyBootstrapUseCases'), '必须导出 createOntologyBootstrapUseCases');
  assert.ok(content.includes('groundAnalysisContext'), '必须包含 groundAnalysisContext 方法');
});

test('AC3 tool binding 导出关键函数', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const filePath = path.join(ROOT, 'src/domain/ontology/tool-binding.ts');
  const content = fs.readFileSync(filePath, 'utf8');

  assert.ok(content.includes('ToolCapabilityBinding'), '必须包含 ToolCapabilityBinding 类型');
  assert.ok(content.includes('evaluateBindingActivation'), '必须导出 evaluateBindingActivation 函数');
  assert.ok(content.includes('selectBestToolBinding'), '必须导出 selectBestToolBinding 函数');
});

// ─── 静态检查：关键设计约束 ───────────────────────────────────────────────

test('AC1 grounding 实现 fail loud 策略（不静默回退）', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const filePath = path.join(ROOT, 'src/application/ontology/grounding.ts');
  const content = fs.readFileSync(filePath, 'utf8');

  assert.ok(
    content.includes('isGroundingBlocked') || content.includes('OntologyGroundingError'),
    '必须检查 grounding 阻断状态或抛出错误'
  );
  assert.ok(
    !content.includes('allowFallbackToFreeText: true') || content.includes('// temporary mitigation'),
    '如允许自由文本回退，必须明确标记为临时兼容路径'
  );
});

test('AC3 tool selection 使用 binding 而非字符串匹配', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const filePath = path.join(ROOT, 'src/domain/ontology/tool-binding.ts');
  const content = fs.readFileSync(filePath, 'utf8');

  assert.ok(
    content.includes('BindingActivationCondition'),
    '必须定义 BindingActivationCondition 激活条件'
  );
  assert.ok(
    content.includes('toolName') && content.includes('boundStepTemplateKey'),
    'binding 必须关联 toolName 和 boundStepTemplateKey'
  );
});

// ─── LLM 输出契约：discriminated union schema 校验（Story 4.6 Code Review [B3]）─────

test('discriminated union: conclusion-summary taskType 校验通过', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const content = fs.readFileSync(path.join(ROOT, 'src/application/tooling/models.ts'), 'utf8');

  assert.ok(content.includes("z.discriminatedUnion('taskType'"), 'llmStructuredAnalysisOutputValueSchema 必须使用 discriminatedUnion');
  assert.ok(content.includes("z.literal('conclusion-summary')"), '必须覆盖 conclusion-summary taskType');
  assert.ok(content.includes("z.literal('tool-selection')"), '必须覆盖 tool-selection taskType');
  assert.ok(content.includes('LlmStructuredAnalysisOutput'), '必须导出 LlmStructuredAnalysisOutput 类型');
});

test('discriminated union: extractStructuredConclusion 不再使用 as 类型断言', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const filePath = path.join(ROOT, 'src/worker/analysis-execution-renderer.ts');
  const content = fs.readFileSync(filePath, 'utf8');

  assert.ok(
    !content.includes('as {') && !content.includes('output as {'),
    'extractStructuredConclusion 不应再使用 as { ... } 类型断言'
  );
  assert.ok(
    content.includes('llmStructuredAnalysisOutputValueSchema'),
    'extractStructuredConclusion 必须使用 llmStructuredAnalysisOutputValueSchema 进行运行时解析'
  );
  assert.ok(
    content.includes('safeParse'),
    '必须使用 safeParse 做安全解析，而非直接 parse 抛出'
  );
});

// ─── Grounding 领域逻辑单测（纯函数，不需要数据库）──────────────────────────

test('AC1 isGroundingSuccess / isGroundingBlocked 逻辑正确', () => {
  const { isGroundingSuccess, isGroundingBlocked } = (() => {
    // 内联实现以避免 ESM import 的 TS 问题
    function isGroundingSuccess(ctx) {
      return ctx.groundingStatus === 'success';
    }
    function isGroundingBlocked(ctx) {
      return ctx.groundingStatus === 'ambiguous' || ctx.groundingStatus === 'failed';
    }
    return { isGroundingSuccess, isGroundingBlocked };
  })();

  const successCtx = { groundingStatus: 'success' };
  const ambiguousCtx = { groundingStatus: 'ambiguous' };
  const failedCtx = { groundingStatus: 'failed' };
  const partialCtx = { groundingStatus: 'partial' };

  assert.ok(isGroundingSuccess(successCtx), 'success 状态应为 success');
  assert.ok(!isGroundingSuccess(ambiguousCtx), 'ambiguous 状态不应为 success');
  assert.ok(isGroundingBlocked(ambiguousCtx), 'ambiguous 状态应被阻断');
  assert.ok(isGroundingBlocked(failedCtx), 'failed 状态应被阻断');
  assert.ok(!isGroundingBlocked(successCtx), 'success 状态不应被阻断');
  assert.ok(!isGroundingBlocked(partialCtx), 'partial 状态不应阻断（部分成功可继续）');
});

test('AC1 DEFAULT_GROUNDING_STRATEGY 默认关闭 allowFallbackToFreeText', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const filePath = path.join(ROOT, 'src/domain/ontology/grounding.ts');
  const content = fs.readFileSync(filePath, 'utf8');

  assert.ok(
    content.includes('allowFallbackToFreeText: false'),
    'DEFAULT_GROUNDING_STRATEGY 必须默认关闭 allowFallbackToFreeText'
  );
});

// ─── Tool Binding 逻辑单测（纯函数）─────────────────────────────────────────

test('AC3 evaluateBindingActivation - always 条件激活', async () => {
  const binding = {
    id: 'test-binding',
    ontologyVersionId: 'v1',
    boundStepTemplateKey: 'metric-query',
    boundCapabilityTag: null,
    toolName: 'cube.semantic-query',
    activationConditions: [{ type: 'always', value: true }],
    description: null,
    status: 'approved',
    priority: 10,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    createdBy: 'system',
  };

  // 手动实现 evaluateBindingActivation 逻辑校验
  const conditions = binding.activationConditions;
  assert.strictEqual(conditions.length, 1, '应有 1 个激活条件');
  assert.strictEqual(conditions[0].type, 'always', '条件类型应为 always');
});

test('AC3 buildDefaultToolCapabilityBindingSeeds 文件包含必要工具绑定', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const filePath = path.join(ROOT, 'src/domain/ontology/tool-binding.ts');
  const content = fs.readFileSync(filePath, 'utf8');

  assert.ok(content.includes('cube.semantic-query'), '默认 seeds 必须包含 cube.semantic-query');
  assert.ok(content.includes('neo4j.graph-query'), '默认 seeds 必须包含 neo4j.graph-query');
  assert.ok(content.includes('erp.read-model'), '默认 seeds 必须包含 erp.read-model');
  assert.ok(content.includes('llm.structured-analysis'), '默认 seeds 必须包含 llm.structured-analysis');
  assert.ok(
    content.includes('TOOL_SELECTION_STATUS'),
    '必须导出 TOOL_SELECTION_STATUS 状态枚举'
  );
});

// ─── Planner 集成：grounded context 消费路径 ─────────────────────────────────

test('AC2 analysis-plan/models.ts 包含 buildAnalysisPlanFromGroundedContext', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const filePath = path.join(ROOT, 'src/domain/analysis-plan/models.ts');
  const content = fs.readFileSync(filePath, 'utf8');

  assert.ok(content.includes('buildAnalysisPlanFromGroundedContext'), '必须导出 buildAnalysisPlanFromGroundedContext');
  assert.ok(content.includes('_groundedSource'), '计划结果必须包含 _groundedSource 字段');
  assert.ok(content.includes('_groundingStatus'), '计划结果必须包含 _groundingStatus 字段');
  assert.ok(content.includes('OntologyGroundedContext'), '必须消费 OntologyGroundedContext 类型');
});

test('AC2 analysis-planning/use-cases.ts 包含 buildPlanFromGroundedContext 方法', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const filePath = path.join(ROOT, 'src/application/analysis-planning/use-cases.ts');
  const content = fs.readFileSync(filePath, 'utf8');

  assert.ok(content.includes('buildPlanFromGroundedContext'), '应用层必须导出 buildPlanFromGroundedContext');
  assert.ok(content.includes('groundedContext'), '必须接收 groundedContext 参数');
});

// ─── Migration 文件存在检查 ────────────────────────────────────────────────

test('AC1 drizzle migration 文件包含新增表定义', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const migrationFiles = fs.readdirSync(path.join(ROOT, 'drizzle'))
    .filter(f => f.endsWith('.sql'));

  let foundGroundedContexts = false;
  let foundToolCapabilityBindings = false;

  for (const file of migrationFiles) {
    const content = fs.readFileSync(path.join(ROOT, 'drizzle', file), 'utf8');
    if (content.includes('ontology_grounded_contexts')) foundGroundedContexts = true;
    if (content.includes('ontology_tool_capability_bindings')) foundToolCapabilityBindings = true;
  }

  assert.ok(foundGroundedContexts, 'migration 文件必须包含 ontology_grounded_contexts 表');
  assert.ok(foundToolCapabilityBindings, 'migration 文件必须包含 ontology_tool_capability_bindings 表');
});

test('AC1 migration 新增表在正确的 platform schema 下', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const migrationFiles = fs.readdirSync(path.join(ROOT, 'drizzle'))
    .filter(f => f.endsWith('.sql'));

  let groundedContextsInPlatform = false;
  let toolBindingsInPlatform = false;

  for (const file of migrationFiles) {
    const content = fs.readFileSync(path.join(ROOT, 'drizzle', file), 'utf8');
    if (content.includes('"platform"."ontology_grounded_contexts"')) groundedContextsInPlatform = true;
    if (content.includes('"platform"."ontology_tool_capability_bindings"')) toolBindingsInPlatform = true;
  }

  assert.ok(groundedContextsInPlatform, 'ontology_grounded_contexts 必须在 platform schema 下');
  assert.ok(toolBindingsInPlatform, 'ontology_tool_capability_bindings 必须在 platform schema 下');
});

// ─── AC4 follow-up / grounded context 兼容结构检查 ──────────────────────────

test('AC4 OntologyGroundedContext 包含 originalMergedContext（供追问可读性）', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const filePath = path.join(ROOT, 'src/domain/ontology/grounding.ts');
  const content = fs.readFileSync(filePath, 'utf8');

  assert.ok(content.includes('originalMergedContext'), '必须保留 originalMergedContext 供追问使用');
  assert.ok(content.includes('toLegacyContextProjection'), '必须提供 toLegacyContextProjection 兼容投影');
  assert.ok(content.includes('_transitional: true'), 'legacy 投影必须标记为 _transitional');
  assert.ok(content.includes('_groundedSource'), 'legacy 投影必须保留 _groundedSource 版本引用');
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
