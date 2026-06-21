import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function runTsSnippet(code) {
  const { stdout } = await execFileAsync(
    'node',
    ['--import', 'tsx', '--input-type=module', '-e', code],
    {
      cwd: process.cwd(),
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--conditions=react-server']
          .filter(Boolean)
          .join(' '),
      },
    },
  );

  return JSON.parse(stdout.trim().split('\n').pop() ?? '{}');
}

test('Story 3.2 | 项目名后直接跟“本年”时仍抽取真实项目实体', async () => {
  const result = await runTsSnippet(`
    import contextModule from './src/domain/analysis-context/models.ts';
    const { extractAnalysisContext } = contextModule;
    const context = extractAnalysisContext('丰和园小区项目本年的物业费收缴率是多少？');
    console.log(JSON.stringify({
      entity: context.entity,
      timeRange: context.timeRange,
      constraints: context.constraints,
    }));
  `);

  assert.equal(result.entity.value, '丰和园小区项目');
  assert.equal(result.entity.state, 'confirmed');
  assert.equal(result.timeRange.value, '今年');
  assert.deepEqual(result.constraints, [
    { label: '项目约束', value: '丰和园小区项目' },
  ]);
});

test('Story 3.2 | 小区名后直接跟“本年”时按项目名称归一化', async () => {
  const result = await runTsSnippet(`
    import contextModule from './src/domain/analysis-context/models.ts';
    import toolInputModule from './src/application/analysis-execution/tool-input-builder.ts';
    const { extractAnalysisContext } = contextModule;
    const { buildToolInputs } = toolInputModule;
    const questionText = '丰和园小区本年的物业费收缴率是多少？';
    const context = extractAnalysisContext(questionText);
    const inputs = buildToolInputs({
      sessionId: 's-1',
      ownerUserId: 'u-1',
      organizationId: '240',
      projectIds: ['10030'],
      areaIds: [],
      questionText,
      context,
      step: { id: 'return-metric-result', title: '返回指标结果', objective: '返回指标结果' },
      planSummary: '测试计划',
    });
    console.log(JSON.stringify({
      entity: context.entity,
      timeRange: context.timeRange,
      constraints: context.constraints,
      cubeQuery: inputs['cube.semantic-query'],
    }));
  `);

  assert.equal(result.entity.value, '丰和园小区项目');
  assert.equal(result.timeRange.value, '今年');
  assert.deepEqual(result.constraints, [
    { label: '项目约束', value: '丰和园小区项目' },
  ]);
  assert.deepEqual(result.cubeQuery.filters, [
    {
      dimension: 'project-name',
      values: ['丰和园小区项目'],
    },
  ]);
});

test('Story 3.2 | 项目名后直接跟显式年份时拆出项目和年份', async () => {
  const result = await runTsSnippet(`
    import contextModule from './src/domain/analysis-context/models.ts';
    const { extractAnalysisContext } = contextModule;
    const context = extractAnalysisContext('丰和园小区项目2026的物业费收缴率是多少？');
    console.log(JSON.stringify({
      entity: context.entity,
      timeRange: context.timeRange,
      comparison: context.comparison,
      constraints: context.constraints,
    }));
  `);

  assert.equal(result.entity.value, '丰和园小区项目');
  assert.equal(result.entity.state, 'confirmed');
  assert.equal(result.timeRange.value, '2026年');
  assert.equal(result.timeRange.state, 'confirmed');
  assert.equal(result.comparison.value, '无需比较');
  assert.equal(result.comparison.state, 'confirmed');
  assert.deepEqual(result.constraints, [
    { label: '项目约束', value: '丰和园小区项目' },
  ]);
});

test('Story 3.2 | “项目 moon”这类后置项目代号仍保持兼容', async () => {
  const result = await runTsSnippet(`
    import contextModule from './src/domain/analysis-context/models.ts';
    const { extractAnalysisContext } = contextModule;
    const context = extractAnalysisContext('为什么近三个月项目 moon 的收费回款率下降了？');
    console.log(JSON.stringify({
      entity: context.entity,
      timeRange: context.timeRange,
      constraints: context.constraints,
    }));
  `);

  assert.equal(result.entity.value, '项目 moon');
  assert.equal(result.timeRange.value, '近三个月');
  assert.ok(
    result.constraints.some(
      (constraint) =>
        constraint.label === '项目约束' && constraint.value === '项目 moon',
    ),
  );
});

test('Story 3.2 | 项目前的查询意图词不应污染实体名称', async () => {
  const result = await runTsSnippet(`
    import contextModule from './src/domain/analysis-context/models.ts';
    const { extractAnalysisContext } = contextModule;
    const context = extractAnalysisContext('查看一下六坑铺项目今年的应收金额');
    console.log(JSON.stringify({
      entity: context.entity,
      constraints: context.constraints,
    }));
  `);

  assert.equal(result.entity.value, '六坑铺项目');
  assert.equal(result.entity.state, 'confirmed');
  assert.deepEqual(result.constraints, [
    { label: '项目约束', value: '六坑铺项目' },
  ]);
});

test('Story 3.2 | 执行输入应把项目约束解析为真实项目 ID，避免整句 project-name 过滤', async () => {
  const result = await runTsSnippet(`
    import contextModule from './src/domain/analysis-context/models.ts';
    import toolInputModule from './src/application/analysis-execution/tool-input-builder.ts';
    const { extractAnalysisContext } = contextModule;
    const { buildToolInputs } = toolInputModule;
    const questionText = '查看一下六坑铺项目今年的应收金额';
    const context = extractAnalysisContext(questionText);
    const inputs = buildToolInputs({
      sessionId: 's-1',
      ownerUserId: 'u-1',
      organizationId: '240',
      projectIds: ['50040', '650120', '650130', 'other-project'],
      areaIds: [],
      questionText,
      context,
      projectCatalog: [
        { id: '50040', name: '六铺炕办公楼项目' },
        { id: '650120', name: '六铺炕员工餐厅' },
        { id: '650130', name: '六铺炕智慧餐厅' },
        { id: 'other-project', name: '其他项目' },
      ],
      step: { id: 'return-metric-result', title: '返回指标结果', objective: '返回指标结果' },
      planSummary: '测试计划',
    });
    console.log(JSON.stringify(inputs['cube.semantic-query']));
  `);

  assert.deepEqual(result.scope.projectIds, ['50040', '650120', '650130']);
  assert.deepEqual(result.groupBy, ['project-name']);
  assert.equal(result.filters, undefined);
});

test('Story 3.2 | 收缴率怎么样必须进入收费归因分析链路', async () => {
  const result = await runTsSnippet(`
    import intentModule from './src/domain/analysis-intent/models.ts';
    import factorModule from './src/domain/factor-expansion/models.ts';
    import planModule from './src/domain/analysis-plan/models.ts';

    const { recognizeIntentFromQuestion } = intentModule;
    const { expandCandidateFactors } = factorModule;
    const { buildAnalysisPlan } = planModule;
    const questionText = '六坑铺项目本年收缴率怎么样？';
    const context = {
      targetMetric: { label: '目标指标', value: '收缴率', state: 'confirmed' },
      entity: { label: '实体对象', value: '六铺炕办公楼项目', state: 'confirmed' },
      timeRange: { label: '时间范围', value: '本年', state: 'confirmed' },
      comparison: { label: '比较方式', value: '无需比较', state: 'confirmed' },
      constraints: [{ label: '项目约束', value: '六铺炕办公楼项目' }],
    };
    const intent = recognizeIntentFromQuestion(questionText);
    const factors = expandCandidateFactors({
      intentType: intent.type,
      questionText,
      context,
    });
    const plan = buildAnalysisPlan({
      intentType: intent.type,
      context,
      candidateFactors: factors.factors,
      shouldExpandFactors: factors.mode === 'expand',
    });

    console.log(JSON.stringify({
      intentType: intent.type,
      factorMode: factors.mode,
      factorLabels: factors.factors.map((factor) => factor.label),
      planMode: plan.mode,
      stepIds: plan.steps.map((step) => step.id),
    }));
  `);

  assert.equal(result.intentType, 'fee-analysis');
  assert.equal(result.factorMode, 'expand');
  assert.ok(result.factorLabels.includes('收费政策触达'));
  assert.equal(result.planMode, 'multi-step');
  assert.ok(result.stepIds.includes('synthesize-attribution'));
});

test('Story 3.2 | 明确项目约束必须下传到 Cube project-name filter', async () => {
  const result = await runTsSnippet(`
    import contextModule from './src/domain/analysis-context/models.ts';
    import toolInputModule from './src/application/analysis-execution/tool-input-builder.ts';
    const { extractAnalysisContext } = contextModule;
    const { buildToolInputs } = toolInputModule;
    const context = extractAnalysisContext('丰和园小区项目本年的物业费收缴率是多少？');
    const inputs = buildToolInputs({
      sessionId: 's-1',
      ownerUserId: 'u-1',
      organizationId: '240',
      projectIds: ['10030', '10040'],
      areaIds: [],
      questionText: '丰和园小区项目本年的物业费收缴率是多少？',
      context,
      step: { id: 'return-metric-result', title: '返回指标结果', objective: '返回指标结果' },
      planSummary: '测试计划',
    });
    console.log(JSON.stringify(inputs['cube.semantic-query']));
  `);

  assert.equal(result.metric, 'project-collection-rate');
  assert.equal(result.dateRange.dimension, 'receivable-accounting-period');
  assert.match(result.dateRange.from, /^\d{4}-01-01$/);
  assert.match(result.dateRange.to, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(result.filters, [
    {
      dimension: 'project-name',
      values: ['丰和园小区项目'],
    },
  ]);
});

test('Story 3.2 | 父级收缴率 grounding 必须落到可执行 Cube 项目口径指标', async () => {
  const result = await runTsSnippet(`
    import contextModule from './src/domain/analysis-context/models.ts';
    import toolInputModule from './src/application/analysis-execution/tool-input-builder.ts';
    const { extractAnalysisContext } = contextModule;
    const { buildToolInputs } = toolInputModule;
    const questionText = '丰和园小区项目2026的物业费收缴率是多少？';
    const context = extractAnalysisContext(questionText);
    const inputs = buildToolInputs({
      sessionId: 's-1',
      ownerUserId: 'u-1',
      organizationId: '240',
      projectIds: ['10030', '10040'],
      areaIds: [],
      questionText,
      context,
      groundedContext: {
        versionId: 'test-version',
        generatedAt: new Date().toISOString(),
        entities: [],
        metrics: [
          {
            input: '收缴率',
            status: 'success',
            canonicalDefinition: { businessKey: 'collection-rate' },
            candidates: [],
            confidence: 1,
          },
        ],
        factors: [],
        timeSemantics: [],
        planStepTemplates: [],
        evidenceTypes: [],
        warnings: [],
      },
      step: { id: 'return-metric-result', title: '返回指标结果', objective: '返回指标结果' },
      planSummary: '测试计划',
    });
    console.log(JSON.stringify(inputs['cube.semantic-query']));
  `);

  assert.equal(result.metric, 'project-collection-rate');
  assert.deepEqual(result.dateRange, {
    dimension: 'receivable-accounting-period',
    from: '2026-01-01',
    to: '2026-12-31',
  });
  assert.deepEqual(result.filters, [
    {
      dimension: 'project-name',
      values: ['丰和园小区项目'],
    },
  ]);
});

test('Story 3.2 | return-metric-result 步骤必须有 Cube 工具 fallback', async () => {
  const result = await runTsSnippet(`
    import executionModule from './src/application/analysis-execution/use-cases.ts';
    const { createAnalysisExecutionUseCases } = executionModule;
    const invoked = [];
    const useCases = createAnalysisExecutionUseCases({
      toolRegistryUseCases: {
        listToolDefinitions() {
          return [
            { name: 'cube.semantic-query', availability: 'ready' },
            { name: 'platform.capability-status', availability: 'ready' },
          ];
        },
        async invokeTool(input) {
          invoked.push(input.toolName);
          return {
            ok: true,
            toolName: input.toolName,
            output: { rows: [{ projectName: '六铺炕办公楼项目', value: 0.82 }] },
            durationMs: 12,
          };
        },
      },
      analysisAiUseCases: {
        async runTask() {
          return { ok: true, value: { strategy: '无匹配', tools: [] } };
        },
      },
    });
    const r = await useCases.executeStep({
      stepId: 'return-metric-result',
      stepTitle: '返回指标结果',
      stepObjective: '返回收缴率结果',
      questionText: '六坑铺项目的收缴率是多少？',
      planSummary: '测试计划',
      selectionContext: {
        userId: 'u-1',
        organizationId: '240',
        purpose: 'analysis-execution',
        sessionId: 's-1',
      },
      invocationContext: {
        correlationId: 'corr-1',
        source: 'worker',
        sessionId: 's-1',
        userId: 'u-1',
        organizationId: '240',
      },
      toolInputsByName: {
        'cube.semantic-query': {
          metric: 'project-collection-rate',
          scope: { organizationId: '240', projectIds: ['50040'] },
        },
      },
    });
    console.log(JSON.stringify({
      status: r.status,
      strategy: r.strategy,
      selectedTools: r.tools.map((tool) => tool.toolName),
      invoked,
    }));
  `);

  assert.equal(result.status, 'completed');
  assert.deepEqual(result.selectedTools, ['cube.semantic-query']);
  assert.deepEqual(result.invoked, ['cube.semantic-query']);
});

test('Story 3.2 | 归因汇总会为工单压力补齐投诉与满意度等因素证据指标', async () => {
  const result = await runTsSnippet(`
    import contextModule from './src/domain/analysis-context/models.ts';
    import toolInputModule from './src/application/analysis-execution/tool-input-builder.ts';
    const { extractAnalysisContext } = contextModule;
    const { buildToolInputs } = toolInputModule;
    const questionText = '丰和园小区项目2026年按月工单总量趋势如何？请展示图表和数据，并说明投诉和满意度是否可能影响服务压力。';
    const context = extractAnalysisContext(questionText);
    const inputs = buildToolInputs({
      sessionId: 's-1',
      ownerUserId: 'u-1',
      organizationId: '2857',
      projectIds: ['10030'],
      areaIds: [],
      questionText,
      context,
      step: { id: 'synthesize-attribution', title: '汇总归因判断', objective: '汇总前序证据' },
      planSummary: '测试计划',
    });
    console.log(JSON.stringify(inputs['cube.semantic-query']));
  `);

  assert.ok(Array.isArray(result));
  assert.deepEqual(
    result.map((query) => query.metric),
    [
      'service-order-count',
      'complaint-count',
      'average-satisfaction',
      'average-response-duration-hours',
      'average-close-duration-hours',
    ],
  );
  assert.equal(result[0].granularity, 'month');
  assert.equal(result[1].granularity, undefined);
  assert.equal(result[1].dateRange.dimension, 'created-at');
  assert.equal(result[2].dateRange.dimension, 'completed-at');
});
