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
