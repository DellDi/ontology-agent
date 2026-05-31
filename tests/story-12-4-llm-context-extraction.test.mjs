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

test('Story 12.4 | 有效 LLM 输出通过 Zod schema 校验', async () => {
  const result = await runTsSnippet(`
    import schemaModule from './src/application/analysis-context-extraction/schemas.ts';
    const { llmContextExtractionOutputSchema } = schemaModule;
    const valid = {
      targetMetric: { value: '收缴率', confidence: 0.9 },
      entity: { value: '丰和园小区', kind: 'community', confidence: 0.9 },
      timeRange: { value: '本年', confidence: 0.9 },
      comparison: { value: '无需比较', type: 'none', confidence: 0.9 },
      assumptions: [],
      needsClarification: false,
      overallConfidence: 0.9,
    };
    const r = llmContextExtractionOutputSchema.safeParse(valid);
    console.log(JSON.stringify({ ok: r.success }));
  `);

  assert.equal(result.ok, true);
});

test('Story 12.4 | 有效 LLM 输出（含可选字段）通过 Zod schema 校验', async () => {
  const result = await runTsSnippet(`
    import schemaModule from './src/application/analysis-context-extraction/schemas.ts';
    const { llmContextExtractionOutputSchema } = schemaModule;
    const valid = {
      targetMetric: { value: '收缴率', confidence: 0.9, candidates: ['收缴率', '回款率'] },
      entity: { value: 'A区域', kind: 'area', confidence: 0.8, candidates: ['A区域', 'B区域'] },
      timeRange: { value: '近三个月', normalized: '2026-03-01 to 2026-05-31', confidence: 0.9 },
      comparison: { value: '同比', type: 'yoy', confidence: 0.9 },
      filters: [{ field: 'project-name', operator: 'eq', value: '丰和园' }],
      assumptions: ['假设用户关注的是整体收缴率'],
      needsClarification: false,
      overallConfidence: 0.88,
    };
    const r = llmContextExtractionOutputSchema.safeParse(valid);
    console.log(JSON.stringify({ ok: r.success }));
  `);

  assert.equal(result.ok, true);
});

test('Story 12.4 | 无效 LLM 输出（缺少必填字段）未通过 Zod 校验', async () => {
  const result = await runTsSnippet(`
    import schemaModule from './src/application/analysis-context-extraction/schemas.ts';
    const { llmContextExtractionOutputSchema } = schemaModule;
    const invalid = {
      targetMetric: { value: '收缴率' },
    };
    const r = llmContextExtractionOutputSchema.safeParse(invalid);
    console.log(JSON.stringify({ ok: r.success }));
  `);

  assert.equal(result.ok, false);
});

test('Story 12.4 | 无效 LLM 输出（错误类型）未通过 Zod 校验', async () => {
  const result = await runTsSnippet(`
    import schemaModule from './src/application/analysis-context-extraction/schemas.ts';
    const { llmContextExtractionOutputSchema } = schemaModule;
    const invalid = {
      targetMetric: { value: '收缴率', confidence: 'not-a-number' },
      entity: { value: 'x', kind: 'project', confidence: 0.5 },
      timeRange: { value: '本年', confidence: 0.5 },
      comparison: { value: 'none', type: 'none', confidence: 0.5 },
      assumptions: [],
      needsClarification: false,
      overallConfidence: 0.5,
    };
    const r = llmContextExtractionOutputSchema.safeParse(invalid);
    console.log(JSON.stringify({ ok: r.success }));
  `);

  assert.equal(result.ok, false);
});

test('Story 12.4 | 无效 LLM 输出（confidence 越界）未通过 Zod 校验', async () => {
  const result = await runTsSnippet(`
    import schemaModule from './src/application/analysis-context-extraction/schemas.ts';
    const { llmContextExtractionOutputSchema } = schemaModule;
    const invalid = {
      targetMetric: { value: '收缴率', confidence: 1.5 },
      entity: { value: 'x', kind: 'project', confidence: 0.5 },
      timeRange: { value: '本年', confidence: 0.5 },
      comparison: { value: 'none', type: 'none', confidence: 0.5 },
      assumptions: [],
      needsClarification: false,
      overallConfidence: 0.5,
    };
    const r = llmContextExtractionOutputSchema.safeParse(invalid);
    console.log(JSON.stringify({ ok: r.success }));
  `);

  assert.equal(result.ok, false);
});

test('Story 12.4 | 输入 schema 拒绝空 questionText', async () => {
  const result = await runTsSnippet(`
    import schemaModule from './src/application/analysis-context-extraction/schemas.ts';
    const { llmContextExtractionInputSchema } = schemaModule;
    const r = llmContextExtractionInputSchema.safeParse({ questionText: '' });
    console.log(JSON.stringify({ ok: r.success }));
  `);

  assert.equal(result.ok, false);
});

test('Story 12.4 | 标准化："丰和园小区本年收缴率" → 正确的指标/实体/时间', async () => {
  const result = await runTsSnippet(`
    import normModule from './src/application/analysis-context-extraction/normalization.ts';
    const { normalizeLlmExtractionOutput } = normModule;
    const output = {
      targetMetric: { value: '收缴率', confidence: 0.9 },
      entity: { value: '丰和园小区', kind: 'community', confidence: 0.9 },
      timeRange: { value: '本年', confidence: 0.9 },
      comparison: { value: '无需比较', type: 'none', confidence: 0.9 },
      assumptions: [],
      needsClarification: false,
      overallConfidence: 0.9,
    };
    const { context } = normalizeLlmExtractionOutput(output, {
      metricDictionary: ['收缴率', '收费回款率'],
      projectNames: ['丰和园小区'],
      currentYear: 2026,
    });
    console.log(JSON.stringify({
      metric: context.targetMetric,
      entity: context.entity,
      timeRange: context.timeRange,
    }));
  `);

  assert.equal(result.metric.value, '收缴率');
  assert.equal(result.metric.state, 'confirmed');
  assert.equal(result.entity.value, '丰和园小区');
  assert.equal(result.entity.state, 'confirmed');
  assert.equal(result.timeRange.value, '2026年');
  assert.equal(result.timeRange.state, 'confirmed');
});

test('Story 12.4 | 实体匹配 projectNames → confirmed 并生成项目约束', async () => {
  const result = await runTsSnippet(`
    import normModule from './src/application/analysis-context-extraction/normalization.ts';
    const { normalizeLlmExtractionOutput } = normModule;
    const output = {
      targetMetric: { value: '收缴率', confidence: 0.9 },
      entity: { value: '丰和园小区项目', kind: 'project', confidence: 0.9 },
      timeRange: { value: '本年', confidence: 0.9 },
      comparison: { value: '无需比较', type: 'none', confidence: 0.9 },
      assumptions: [],
      needsClarification: false,
      overallConfidence: 0.9,
    };
    const { context } = normalizeLlmExtractionOutput(output, {
      projectNames: ['丰和园小区项目', '紫金苑小区项目'],
      currentYear: 2026,
    });
    console.log(JSON.stringify({
      entity: context.entity,
      constraints: context.constraints,
    }));
  `);

  assert.equal(result.entity.state, 'confirmed');
  assert.ok(
    result.constraints.some(
      (c) => c.label === '项目约束' && c.value === '丰和园小区项目',
    ),
    'constraints 应包含「项目约束: 丰和园小区项目」',
  );
});

test('Story 12.4 | 区域实体 → 区域约束', async () => {
  const result = await runTsSnippet(`
    import normModule from './src/application/analysis-context-extraction/normalization.ts';
    const { normalizeLlmExtractionOutput } = normModule;
    const output = {
      targetMetric: { value: '投诉量', confidence: 0.8 },
      entity: { value: 'A区域', kind: 'area', confidence: 0.9 },
      timeRange: { value: '近三个月', confidence: 0.9 },
      comparison: { value: '无需比较', type: 'none', confidence: 0.9 },
      assumptions: [],
      needsClarification: false,
      overallConfidence: 0.85,
    };
    const { context } = normalizeLlmExtractionOutput(output, { currentYear: 2026 });
    console.log(JSON.stringify({ constraints: context.constraints }));
  `);

  assert.ok(
    result.constraints.some(
      (c) => c.label === '区域约束' && c.value === 'A区域',
    ),
    'constraints 应包含「区域约束: A区域」',
  );
});

test('Story 12.4 | 未知指标（不在字典中）→ uncertain 并附带说明', async () => {
  const result = await runTsSnippet(`
    import normModule from './src/application/analysis-context-extraction/normalization.ts';
    const { normalizeLlmExtractionOutput } = normModule;
    const output = {
      targetMetric: { value: '未知识别指标', confidence: 0.5 },
      entity: { value: '丰和园小区', kind: 'community', confidence: 0.9 },
      timeRange: { value: '本年', confidence: 0.9 },
      comparison: { value: '无需比较', type: 'none', confidence: 0.9 },
      assumptions: [],
      needsClarification: false,
      overallConfidence: 0.7,
    };
    const { context } = normalizeLlmExtractionOutput(output, {
      metricDictionary: ['收缴率', '收费回款率'],
      projectNames: ['丰和园小区'],
      currentYear: 2026,
    });
    console.log(JSON.stringify({ metric: context.targetMetric }));
  `);

  assert.equal(result.metric.value, '未知识别指标');
  assert.equal(result.metric.state, 'uncertain');
  assert.ok(result.metric.note && result.metric.note.includes('未'), 'note 应包含"未"字样');
});

test('Story 12.4 | comparison type=none → "无需比较" 并附带说明', async () => {
  const result = await runTsSnippet(`
    import normModule from './src/application/analysis-context-extraction/normalization.ts';
    const { normalizeLlmExtractionOutput } = normModule;
    const output = {
      targetMetric: { value: '收缴率', confidence: 0.9 },
      entity: { value: '丰和园小区', kind: 'community', confidence: 0.9 },
      timeRange: { value: '本年', confidence: 0.9 },
      comparison: { value: '无', type: 'none', confidence: 0.9 },
      assumptions: [],
      needsClarification: false,
      overallConfidence: 0.9,
    };
    const { context } = normalizeLlmExtractionOutput(output, {
      projectNames: ['丰和园小区'],
      currentYear: 2026,
    });
    console.log(JSON.stringify({ comparison: context.comparison }));
  `);

  assert.equal(result.comparison.value, '无需比较');
  assert.equal(result.comparison.state, 'confirmed');
  assert.ok(result.comparison.note && result.comparison.note.length > 0);
});

test('Story 12.4 | assumptions 转换为 constraints 中的「假设」条目', async () => {
  const result = await runTsSnippet(`
    import normModule from './src/application/analysis-context-extraction/normalization.ts';
    const { normalizeLlmExtractionOutput } = normModule;
    const output = {
      targetMetric: { value: '收缴率', confidence: 0.9 },
      entity: { value: '丰和园小区', kind: 'community', confidence: 0.9 },
      timeRange: { value: '本年', confidence: 0.9 },
      comparison: { value: '无需比较', type: 'none', confidence: 0.9 },
      assumptions: ['假设用户关注的是整体收缴率', '假设不包含商业物业'],
      needsClarification: false,
      overallConfidence: 0.85,
    };
    const { context } = normalizeLlmExtractionOutput(output, {
      projectNames: ['丰和园小区'],
      currentYear: 2026,
    });
    console.log(JSON.stringify({ constraints: context.constraints }));
  `);

  const assumptions = result.constraints.filter((c) => c.label === '假设');
  assert.equal(assumptions.length, 2);
  assert.equal(assumptions[0].value, '假设用户关注的是整体收缴率');
  assert.equal(assumptions[1].value, '假设不包含商业物业');
});

test('Story 12.4 | 整体置信度为加权字段置信度', async () => {
  const result = await runTsSnippet(`
    import normModule from './src/application/analysis-context-extraction/normalization.ts';
    const { normalizeLlmExtractionOutput } = normModule;
    const output = {
      targetMetric: { value: '收缴率', confidence: 0.8 },
      entity: { value: '丰和园小区', kind: 'community', confidence: 0.6 },
      timeRange: { value: '本年', confidence: 1.0 },
      comparison: { value: '无需比较', type: 'none', confidence: 0.9 },
      assumptions: [],
      needsClarification: false,
      overallConfidence: 0.8,
    };
    const { confidence } = normalizeLlmExtractionOutput(output, {
      projectNames: ['丰和园小区'],
      currentYear: 2026,
    });
    console.log(JSON.stringify({ confidence }));
  `);

  // 0.8*0.3 + 0.6*0.3 + 1.0*0.2 + 0.9*0.2 = 0.24 + 0.18 + 0.2 + 0.18 = 0.8
  assert.ok(Math.abs(result.confidence - 0.8) < 1e-6, `置信度应为 0.8，实际 ${result.confidence}`);
});

test('Story 12.4 | 自动猜测决策：高置信度 → execute', async () => {
  const result = await runTsSnippet(`
    import strategyModule from './src/application/analysis-context-extraction/auto-guess-strategy.ts';
    const { resolveAutoGuessDecision } = strategyModule;
    const mockResult = {
      context: {
        targetMetric: { label: '目标指标', value: '收缴率', state: 'confirmed' },
        entity: { label: '实体对象', value: '丰和园小区项目', state: 'confirmed' },
        timeRange: { label: '时间范围', value: '2026年', state: 'confirmed' },
        comparison: { label: '比较方式', value: '无需比较', state: 'confirmed' },
        constraints: [],
      },
      source: 'llm',
      confidence: 0.85,
      assumptions: [],
      needsClarification: false,
      issues: [],
    };
    const d = resolveAutoGuessDecision(mockResult);
    console.log(JSON.stringify(d));
  `);

  assert.equal(result.action, 'execute');
  assert.ok(typeof result.reason === 'string' && result.reason.length > 0);
});

test('Story 12.4 | 自动猜测决策：中置信度 → execute-with-assumptions（附带 summary + assumptions）', async () => {
  const result = await runTsSnippet(`
    import strategyModule from './src/application/analysis-context-extraction/auto-guess-strategy.ts';
    const { resolveAutoGuessDecision } = strategyModule;
    const mockResult = {
      context: {
        targetMetric: { label: '目标指标', value: '收缴率', state: 'uncertain' },
        entity: { label: '实体对象', value: '丰和园', state: 'uncertain' },
        timeRange: { label: '时间范围', value: '本年', state: 'confirmed' },
        comparison: { label: '比较方式', value: '无需比较', state: 'confirmed' },
        constraints: [],
      },
      source: 'llm',
      confidence: 0.55,
      assumptions: ['假设为物业费收缴率'],
      needsClarification: false,
      issues: [],
    };
    const d = resolveAutoGuessDecision(mockResult);
    console.log(JSON.stringify(d));
  `);

  assert.equal(result.action, 'execute-with-assumptions');
  assert.ok(typeof result.summary === 'string' && result.summary.length > 0, 'summary 不能为空');
  assert.ok(result.summary.includes('收缴率'), 'summary 应包含指标名');
  assert.ok(Array.isArray(result.assumptions) && result.assumptions.length > 0);
});

test('Story 12.4 | 自动猜测决策：低置信度 → execute-with-assumptions（始终执行）', async () => {
  const result = await runTsSnippet(`
    import strategyModule from './src/application/analysis-context-extraction/auto-guess-strategy.ts';
    const { resolveAutoGuessDecision } = strategyModule;
    const mockResult = {
      context: {
        targetMetric: { label: '目标指标', value: '收缴率', state: 'confirmed' },
        entity: { label: '实体对象', value: '某项目', state: 'confirmed' },
        timeRange: { label: '时间范围', value: '2026年', state: 'confirmed' },
        comparison: { label: '比较方式', value: '无需比较', state: 'confirmed' },
        constraints: [],
      },
      source: 'llm',
      confidence: 0.2,
      assumptions: ['假设为本年数据'],
      needsClarification: false,
      issues: [],
    };
    const d = resolveAutoGuessDecision(mockResult);
    console.log(JSON.stringify(d));
  `);

  assert.equal(result.action, 'execute-with-assumptions');
  assert.ok(typeof result.reason === 'string' && result.reason.length > 0);
  assert.ok(typeof result.summary === 'string' && result.summary.length > 0);
  assert.ok(Array.isArray(result.assumptions));
});

test('Story 12.4 | 自动猜测决策：needsClarification=true 时仍执行但展示假设', async () => {
  const result = await runTsSnippet(`
    import strategyModule from './src/application/analysis-context-extraction/auto-guess-strategy.ts';
    const { resolveAutoGuessDecision } = strategyModule;
    const mockResult = {
      context: {
        targetMetric: { label: '目标指标', value: '收缴率', state: 'confirmed' },
        entity: { label: '实体对象', value: '丰和园小区项目', state: 'confirmed' },
        timeRange: { label: '时间范围', value: '2026年', state: 'confirmed' },
        comparison: { label: '比较方式', value: '无需比较', state: 'confirmed' },
        constraints: [],
      },
      source: 'llm',
      confidence: 0.9,
      assumptions: ['假设用户关注整体收缴率'],
      needsClarification: true,
      issues: [],
    };
    const d = resolveAutoGuessDecision(mockResult);
    console.log(JSON.stringify(d));
  `);

  assert.equal(result.action, 'execute-with-assumptions');
  assert.ok(result.reason.includes('澄清'), 'reason 应提及"澄清"');
  assert.ok(typeof result.summary === 'string' && result.summary.length > 0);
});

test('Story 12.4 | LLM 失败时回退到规则抽取（source=rule-fallback）', async () => {
  const result = await runTsSnippet(`
    import useCaseModule from './src/application/analysis-context-extraction/use-cases.ts';
    const { createContextExtractionUseCases } = useCaseModule;
    const failingPort = {
      async extract() { throw new Error('LLM 服务不可用'); },
    };
    const { extractContext } = createContextExtractionUseCases({ extractionPort: failingPort });
    const r = await extractContext({
      questionText: '丰和园小区项目本年的物业费收缴率是多少？',
    });
    console.log(JSON.stringify({
      source: r.source,
      metric: r.context.targetMetric.value,
      metricState: r.context.targetMetric.state,
      entity: r.context.entity.value,
      hasIssue: r.issues.length > 0,
      issueField: r.issues[0]?.field,
    }));
  `);

  assert.equal(result.source, 'rule-fallback');
  assert.equal(result.metric, '收缴率');
  assert.equal(result.metricState, 'confirmed');
  assert.equal(result.entity, '丰和园小区项目');
  assert.equal(result.hasIssue, true);
  assert.equal(result.issueField, 'llm');
});

test('Story 12.4 | 使用 mock port 集成测试完整流程（source=llm）', async () => {
  const result = await runTsSnippet(`
    import useCaseModule from './src/application/analysis-context-extraction/use-cases.ts';
    const { createContextExtractionUseCases } = useCaseModule;
    const mockPort = {
      async extract() {
        return {
          targetMetric: { value: '收缴率', confidence: 0.9 },
          entity: { value: '丰和园小区项目', kind: 'project', confidence: 0.9 },
          timeRange: { value: '本年', confidence: 0.9 },
          comparison: { value: '无需比较', type: 'none', confidence: 0.9 },
          assumptions: ['假设用户关注的是整体收缴率'],
          needsClarification: false,
          overallConfidence: 0.9,
        };
      },
    };
    const { extractContext } = createContextExtractionUseCases({ extractionPort: mockPort });
    const r = await extractContext({
      questionText: '丰和园小区项目本年的物业费收缴率是多少？',
      projectNames: ['丰和园小区项目'],
      metricDictionary: ['收缴率', '收费回款率'],
    });
    console.log(JSON.stringify({
      source: r.source,
      confidence: r.confidence,
      metricState: r.context.targetMetric.state,
      entityState: r.context.entity.state,
      timeRangeValue: r.context.timeRange.value,
      comparisonValue: r.context.comparison.value,
      assumptions: r.assumptions,
      needsClarification: r.needsClarification,
    }));
  `);

  assert.equal(result.source, 'llm');
  assert.ok(result.confidence > 0.7, `置信度应 > 0.7，实际 ${result.confidence}`);
  assert.equal(result.metricState, 'confirmed');
  assert.equal(result.entityState, 'confirmed');
  assert.equal(result.timeRangeValue, '2026年');
  assert.equal(result.comparisonValue, '无需比较');
  assert.deepEqual(result.assumptions, ['假设用户关注的是整体收缴率']);
  assert.equal(result.needsClarification, false);
});

test('Story 12.4 | 使用 mock port 时输入透传给端口', async () => {
  const result = await runTsSnippet(`
    import useCaseModule from './src/application/analysis-context-extraction/use-cases.ts';
    const { createContextExtractionUseCases } = useCaseModule;
    let receivedInput = null;
    const spyPort = {
      async extract(input) {
        receivedInput = input;
        return {
          targetMetric: { value: '收缴率', confidence: 0.9 },
          entity: { value: '丰和园', kind: 'project', confidence: 0.9 },
          timeRange: { value: '本年', confidence: 0.9 },
          comparison: { value: '无需比较', type: 'none', confidence: 0.9 },
          assumptions: [],
          needsClarification: false,
          overallConfidence: 0.9,
        };
      },
    };
    const { extractContext } = createContextExtractionUseCases({ extractionPort: spyPort });
    await extractContext({
      questionText: '测试问题',
      projectNames: ['丰和园'],
      metricDictionary: ['收缴率'],
      ontologyVersionSummary: 'v1.0',
    });
    console.log(JSON.stringify({ receivedInput }));
  `);

  assert.equal(result.receivedInput.questionText, '测试问题');
  assert.deepEqual(result.receivedInput.projectNames, ['丰和园']);
  assert.deepEqual(result.receivedInput.metricDictionary, ['收缴率']);
  assert.equal(result.receivedInput.ontologyVersionSummary, 'v1.0');
});

test('Story 12.4 | barrel index.ts 导出所有公共 API', async () => {
  const result = await runTsSnippet(`
    import barrel from './src/application/analysis-context-extraction/index.ts';
    const keys = Object.keys(barrel).sort();
    console.log(JSON.stringify({ keys }));
  `);

  assert.ok(result.keys.includes('llmContextExtractionOutputSchema'));
  assert.ok(result.keys.includes('llmContextExtractionInputSchema'));
  assert.ok(result.keys.includes('createContextExtractionUseCases'));
  assert.ok(result.keys.includes('normalizeLlmExtractionOutput'));
  assert.ok(result.keys.includes('resolveAutoGuessDecision'));
});
