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

  const trimmed = stdout.trim();
  if (!trimmed) return null;
  const lastLine = trimmed.split('\n').pop() ?? '';
  return JSON.parse(lastLine);
}

const IMPORTS = `
  import vmModule from './src/application/analysis-message-projection/conversation-view-model.ts';
  import mapperModule from './src/application/ai-runtime/runtime-projection-mapper.ts';
  import resultModule from './src/domain/analysis-result/models.ts';
  const { buildConversationViewModel } = vmModule;
  const { buildAiRuntimeProjection } = mapperModule;
  const { buildAnalysisConclusionReadModel } = resultModule;
`;

function buildEvent(overrides = {}) {
  return {
    id: overrides.id ?? `evt-${overrides.sequence ?? 1}`,
    sessionId: overrides.sessionId ?? 'session-1',
    executionId: overrides.executionId ?? 'exec-1',
    sequence: overrides.sequence ?? 1,
    timestamp: overrides.timestamp ?? '2026-01-01T00:00:00Z',
    kind: overrides.kind ?? 'stage-result',
    status: overrides.status,
    message: overrides.message,
    step: overrides.step ?? {
      id: 'inspect-metric-change',
      order: 2,
      title: '校验核心指标波动',
      status: 'completed',
    },
    stage: overrides.stage ?? null,
    renderBlocks: overrides.renderBlocks ?? [],
    metadata: overrides.metadata ?? {},
  };
}

test('Story 12.8 | 结论聚合保留指标图表和分析报告，不把纯过程阶段当原因', async () => {
  const metricTable = {
    type: 'table',
    title: '指标结果',
    columns: ['时间', '维度', '值'],
    rows: [
      ['2026-05', '丰和园小区项目', '4.9953'],
      ['2026-06', '丰和园小区项目', '27.4807'],
    ],
  };
  const report = {
    type: 'markdown',
    title: '结构化分析摘要',
    content: '6 月收缴率异常抬升，需要结合应收确认和工单履约继续核验。',
  };
  const events = [
    buildEvent({
      sequence: 1,
      step: {
        id: 'inspect-metric-change',
        order: 2,
        title: '校验核心指标波动',
        status: 'completed',
      },
      renderBlocks: [
        { type: 'status', title: '阶段状态', value: '已完成', tone: 'success' },
        metricTable,
      ],
    }),
    buildEvent({
      id: 'evt-2',
      sequence: 2,
      step: {
        id: 'synthesize-attribution',
        order: 4,
        title: '汇总归因判断',
        status: 'completed',
      },
      renderBlocks: [report],
      metadata: {
        conclusionSummary: '6 月项目收缴率异常抬升，优先核验应收口径。',
        conclusionText: '应收确认口径变化',
        conclusionConfidence: 0.82,
      },
    }),
  ];

  const result = await runTsSnippet(`
    ${IMPORTS}
    const readModel = buildAnalysisConclusionReadModel(${JSON.stringify(events)});
    console.log(JSON.stringify({
      causeIds: readModel.causes.map((cause) => cause.id),
      blockTitles: readModel.renderBlocks.map((block) => block.title),
    }));
  `);

  assert.deepEqual(result.causeIds, ['synthesize-attribution']);
  assert.ok(result.blockTitles.includes('原因排序'));
  assert.ok(result.blockTitles.includes('指标结果'));
  assert.ok(result.blockTitles.includes('结构化分析摘要'));
  assert.ok(!result.blockTitles.includes('阶段状态'));
});

test('Story 12.8 | derived conclusion 与 fallback conclusion 同时存在时不丢 fallback rich blocks', async () => {
  const events = [
    buildEvent({
      sequence: 1,
      step: {
        id: 'synthesize-attribution',
        order: 4,
        title: '汇总归因判断',
        status: 'completed',
      },
      renderBlocks: [],
      metadata: {
        conclusionSummary: '结论来自实时事件。',
        conclusionText: '应收确认口径变化',
      },
    }),
  ];
  const fallbackConclusion = {
    causes: [
      {
        id: 'fallback-cause',
        rank: 1,
        title: '历史持久化结论',
        summary: '历史持久化摘要',
        confidence: 0.7,
        evidence: [],
      },
    ],
    renderBlocks: [
      {
        type: 'chart',
        title: '按月收缴率趋势',
        chartType: 'line',
        series: [
          {
            name: '收缴率',
            points: [
              { label: '2026-05', value: 4.9953 },
              { label: '2026-06', value: 27.4807 },
            ],
          },
        ],
        unit: '%',
      },
    ],
  };

  const result = await runTsSnippet(`
    ${IMPORTS}
    const projection = buildAiRuntimeProjection({
      sessionId: 'session-1',
      executionId: 'exec-1',
      events: ${JSON.stringify(events)},
      fallbackConclusion: ${JSON.stringify(fallbackConclusion)},
    });
    const conclusion = projection.messages[0].parts.find((part) => part.kind === 'conclusion-card');
    console.log(JSON.stringify({
      causeIds: conclusion.readModel.causes.map((cause) => cause.id),
      blockTitles: conclusion.readModel.renderBlocks.map((block) => block.title),
    }));
  `);

  assert.deepEqual(result.causeIds, [
    'synthesize-attribution',
    'fallback-cause',
  ]);
  assert.deepEqual(result.blockTitles, ['原因排序', '按月收缴率趋势']);
});

test('Story 12.8 | 候选因素表进入诊断而不是主结果图表，避免与诊断抽屉重复', async () => {
  const events = [
    buildEvent({
      sequence: 1,
      step: {
        id: 'validate-candidate-factors',
        order: 3,
        title: '逐项验证候选因素',
        status: 'completed',
      },
      renderBlocks: [
        {
          type: 'table',
          title: '候选因素',
          columns: ['因素', '关联类型', '说明'],
          rows: [['应收余额变化', '应收关联', 'Project -> Receivable']],
        },
      ],
    }),
  ];

  const result = await runTsSnippet(`
    ${IMPORTS}
    const events = ${JSON.stringify(events)};
    const projection = buildAiRuntimeProjection({
      sessionId: 'session-1',
      executionId: 'exec-1',
      events,
      fallbackConclusion: null,
    });
    const vm = buildConversationViewModel({
      questionText: '分析候选因素',
      projection,
      events,
      hasConnectionIssue: false,
    });
    console.log(JSON.stringify({
      visualizationTitles: vm.assistantMessage.visualizations.map((item) => item.title),
      diagnosticLabels: vm.assistantMessage.hiddenDiagnostics.map((item) => item.label),
    }));
  `);

  assert.deepEqual(result.visualizationTitles, []);
  assert.ok(result.diagnosticLabels.includes('候选因素'));
});

test('Story 12.8 | 同一 evidence event 的多个 renderBlocks 保留不同 blockIndex', async () => {
  const events = [
    buildEvent({
      sequence: 1,
      renderBlocks: [
        {
          type: 'table',
          title: '指标结果',
          columns: ['时间', '值'],
          rows: [['2026-06', '27.4807']],
        },
        {
          type: 'markdown',
          title: '结构化分析摘要',
          content: '指标存在月度波动。',
        },
      ],
    }),
  ];

  const result = await runTsSnippet(`
    ${IMPORTS}
    const events = ${JSON.stringify(events)};
    const projection = buildAiRuntimeProjection({
      sessionId: 'session-1',
      executionId: 'exec-1',
      events,
      fallbackConclusion: null,
    });
    const vm = buildConversationViewModel({
      questionText: '查看指标结果',
      projection,
      events,
      hasConnectionIssue: false,
    });
    console.log(JSON.stringify({
      blockIndexes: vm.assistantMessage.result.blocks.map((block) => block.source.blockIndex),
    }));
  `);

  assert.deepEqual(result.blockIndexes, [0, 1]);
});

test('Story 12.8 | 只有持久化报告 rich blocks、没有原因排序时仍展示主结果', async () => {
  const events = [
    buildEvent({
      sequence: 1,
      kind: 'step-completed',
      step: {
        id: 'synthesize-attribution',
        order: 4,
        title: '汇总归因判断',
        status: 'completed',
      },
      renderBlocks: [],
    }),
  ];
  const fallbackConclusion = {
    causes: [],
    renderBlocks: [
      {
        type: 'table',
        title: '指标结果',
        columns: ['时间', '维度', '值'],
        rows: [['2026-06', '丰和园小区项目', '11.894']],
      },
      {
        type: 'markdown',
        title: '结构化分析摘要',
        content: '丰和园小区本年的物业费收缴率为 11.894%。',
      },
    ],
  };

  const result = await runTsSnippet(`
    ${IMPORTS}
    const projection = buildAiRuntimeProjection({
      sessionId: 'session-1',
      executionId: 'exec-1',
      events: ${JSON.stringify(events)},
      fallbackConclusion: ${JSON.stringify(fallbackConclusion)},
    });
    const vm = buildConversationViewModel({
      questionText: '丰和园小区本年的物业费收缴率是多少？',
      projection,
      events: ${JSON.stringify(events)},
      hasConnectionIssue: false,
    });
    console.log(JSON.stringify({
      status: vm.assistantMessage.status,
      resultTitles: vm.assistantMessage.result?.blocks.map((block) => block.title) ?? [],
      visualizationTitles: vm.assistantMessage.visualizations.map((item) => item.title),
      primaryAnswer: vm.assistantMessage.primaryAnswer,
    }));
  `);

  assert.equal(result.status, 'completed');
  assert.ok(result.resultTitles.includes('结构化分析摘要'));
  assert.ok(result.visualizationTitles.includes('指标结果'));
  assert.match(result.primaryAnswer, /11\.894/);
});

test('Story 12.8 | 没有 execution-status 终态但所有步骤完成时，投影状态应推断为 completed', async () => {
  const events = [
    buildEvent({
      sequence: 1,
      kind: 'step-completed',
      step: { id: 'step-1', order: 1, title: '确认分析口径', status: 'completed' },
      renderBlocks: [],
    }),
    buildEvent({
      id: 'evt-2',
      sequence: 2,
      kind: 'step-completed',
      step: { id: 'step-2', order: 2, title: '校验核心指标波动', status: 'completed' },
      renderBlocks: [],
    }),
  ];

  const result = await runTsSnippet(`
    ${IMPORTS}
    const projection = buildAiRuntimeProjection({
      sessionId: 'session-1',
      executionId: 'exec-1',
      events: ${JSON.stringify(events)},
      fallbackConclusion: null,
    });
    const vm = buildConversationViewModel({
      questionText: '查看结果',
      projection,
      events: ${JSON.stringify(events)},
      hasConnectionIssue: false,
    });
    console.log(JSON.stringify({
      projectionStatus: projection.status,
      assistantStatus: vm.assistantMessage.status,
      headline: vm.assistantMessage.headline,
    }));
  `);

  assert.equal(result.projectionStatus, 'completed');
  assert.equal(result.assistantStatus, 'completed');
  assert.equal(result.headline, '分析完成');
});
