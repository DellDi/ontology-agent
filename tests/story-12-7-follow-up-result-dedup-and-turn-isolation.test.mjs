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
  import threadModule from './src/application/analysis-message-projection/conversation-thread-view-model.ts';
  import mapperModule from './src/application/ai-runtime/runtime-projection-mapper.ts';
  const { buildConversationViewModel } = vmModule;
  const { buildConversationThreadViewModel } = threadModule;
  const { buildAiRuntimeProjection } = mapperModule;
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
    step: overrides.step ?? null,
    stage: overrides.stage ?? null,
    renderBlocks: overrides.renderBlocks ?? [],
    metadata: overrides.metadata ?? {},
  };
}

test('Story 12.7 | 相同指标块重复进入投影时 metricCards 只展示一次', async () => {
  const duplicateMetricBlock = {
    type: 'kv-list',
    title: '指标结果',
    items: [
      { label: '项目收缴率', value: '4.9953', unit: '%' },
      { label: '本月异常增幅', value: '22.4854', unit: '%' },
    ],
  };
  const events = [
    buildEvent({
      sequence: 1,
      renderBlocks: [duplicateMetricBlock],
    }),
    buildEvent({
      id: 'evt-2',
      sequence: 2,
      renderBlocks: [duplicateMetricBlock],
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
      questionText: '按月份查看收缴率',
      projection,
      events,
      hasConnectionIssue: false,
    });
    console.log(JSON.stringify({
      metricCards: vm.assistantMessage.metricCards,
      resultBlockTitles: vm.assistantMessage.result.blocks.map((block) => block.title),
    }));
  `);

  assert.deepEqual(
    result.metricCards.map((card) => card.label),
    ['项目收缴率', '本月异常增幅'],
  );
  assert.equal(
    result.metricCards.filter((card) => card.label === '项目收缴率').length,
    1,
    '重复指标结果不应生成两张同名指标卡',
  );
});

test('Story 12.7 | 相同图表块重复进入投影时 visualizations 只展示一次', async () => {
  const duplicateChartBlock = {
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
  };
  const events = [
    buildEvent({
      sequence: 1,
      renderBlocks: [duplicateChartBlock],
    }),
    buildEvent({
      id: 'evt-2',
      sequence: 2,
      renderBlocks: [duplicateChartBlock],
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
      questionText: '按月份查看收缴率',
      projection,
      events,
      hasConnectionIssue: false,
    });
    console.log(JSON.stringify({
      visualizations: vm.assistantMessage.visualizations,
    }));
  `);

  assert.equal(result.visualizations.length, 1);
  assert.equal(result.visualizations[0].title, '按月收缴率趋势');
});

test('Story 12.7 | 多轮追问各自使用本轮候选因素和计划假设，不串到上一轮', async () => {
  const initialEvents = [
    buildEvent({
      executionId: 'exec-initial',
      sequence: 1,
      kind: 'execution-status',
      status: 'completed',
    }),
  ];
  const followUpEvents = [
    buildEvent({
      executionId: 'exec-follow-up',
      sequence: 1,
      kind: 'execution-status',
      status: 'completed',
    }),
  ];

  const result = await runTsSnippet(`
    ${IMPORTS}
    const initialEvents = ${JSON.stringify(initialEvents)};
    const followUpEvents = ${JSON.stringify(followUpEvents)};
    const initialProjection = buildAiRuntimeProjection({
      sessionId: 'session-1',
      executionId: 'exec-initial',
      events: initialEvents,
      fallbackConclusion: null,
    });
    const followUpProjection = buildAiRuntimeProjection({
      sessionId: 'session-1',
      executionId: 'exec-follow-up',
      events: followUpEvents,
      fallbackConclusion: null,
    });
    const thread = buildConversationThreadViewModel({
      activeTurnId: 'exec-follow-up',
      rounds: [
        {
          executionId: 'exec-initial',
          questionText: '查看年度收缴率',
          projection: initialProjection,
          events: initialEvents,
          planAssumptions: ['年度口径使用基础执行计划'],
          candidateFactors: [{ key: 'base-factor', label: '基础应收因素' }],
          conclusionCauseIds: ['base-factor'],
        },
        {
          executionId: 'exec-follow-up',
          questionText: '按月份展开',
          projection: followUpProjection,
          events: followUpEvents,
          planAssumptions: ['月份追问只使用月度口径'],
          candidateFactors: [{ key: 'monthly-factor', label: '月度收缴波动因素' }],
          conclusionCauseIds: [],
        },
      ],
    });
    console.log(JSON.stringify({
      turns: thread.turns.map((turn) => ({
        executionId: turn.executionId,
        factorLabels: turn.viewModel.assistantMessage.diagnostics.candidateValidation.validations.map((item) => item.factorLabel),
        includedCount: turn.viewModel.assistantMessage.diagnostics.candidateValidation.includedCount,
        assumptions: turn.viewModel.assistantMessage.assumptionSummary,
        isExpanded: turn.isExpanded,
      })),
    }));
  `);

  assert.deepEqual(result.turns[0].factorLabels, ['基础应收因素']);
  assert.deepEqual(result.turns[1].factorLabels, ['月度收缴波动因素']);
  assert.equal(result.turns[0].includedCount, 1);
  assert.equal(result.turns[1].includedCount, 0);
  assert.deepEqual(result.turns[0].assumptions, ['年度口径使用基础执行计划']);
  assert.deepEqual(result.turns[1].assumptions, ['月份追问只使用月度口径']);
  assert.equal(result.turns[0].isExpanded, false);
  assert.equal(result.turns[1].isExpanded, true);
});

test('Story 12.7 | 缺少候选因素时追问轮次保持空验证摘要，不借用其他轮次', async () => {
  const events = [
    buildEvent({
      executionId: 'exec-follow-up',
      sequence: 1,
      kind: 'execution-status',
      status: 'completed',
    }),
  ];

  const result = await runTsSnippet(`
    ${IMPORTS}
    const events = ${JSON.stringify(events)};
    const projection = buildAiRuntimeProjection({
      sessionId: 'session-1',
      executionId: 'exec-follow-up',
      events,
      fallbackConclusion: null,
    });
    const thread = buildConversationThreadViewModel({
      activeTurnId: 'exec-follow-up',
      rounds: [
        {
          executionId: 'exec-follow-up',
          questionText: '按月份展开',
          projection,
          events,
        },
      ],
    });
    const validation = thread.turns[0].viewModel.assistantMessage.diagnostics.candidateValidation;
    console.log(JSON.stringify(validation));
  `);

  assert.equal(result.totalFactors, 0);
  assert.deepEqual(result.validations, []);
});
