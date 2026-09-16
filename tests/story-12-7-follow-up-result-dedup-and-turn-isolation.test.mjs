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
  import turnsModule from './src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-chat-turns.ts';
  import mapperModule from './src/application/ai-runtime/runtime-projection-mapper.ts';
  const { buildConversationViewModel } = vmModule;
  const { buildChatTurns } = turnsModule;
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

test('Story 12.7 | 多轮对话各自携带本轮结论态，不串到上一轮', async () => {
  const aggregate = {
    history: [
      {
        id: 'round-1', kind: 'initial', questionText: '查看年度收缴率',
        followUpId: null, executionId: 'exec-initial', status: 'completed',
        ontologyVersionId: null, ontologyVersionBindingSource: null,
        planSnapshot: null,
        conclusionState: {
          causes: [{ title: '年度结论', summary: '年度口径摘要' }],
          renderBlocks: [],
          suggestedQuestions: ['按月份展开'],
        },
        createdAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 'round-2', kind: 'follow-up', questionText: '按月份展开',
        followUpId: 'fu-1', executionId: 'exec-follow-up', status: 'completed',
        ontologyVersionId: null, ontologyVersionBindingSource: null,
        planSnapshot: null,
        conclusionState: {
          causes: [{ title: '月度结论', summary: '月度口径摘要' }],
          renderBlocks: [],
          suggestedActions: [{ label: '创建排查工单', rationale: '失败集中' }],
        },
        createdAt: '2026-01-02T00:00:00Z',
      },
    ],
    followUps: [
      { id: 'fu-1', questionText: '按月份展开', resultExecutionId: 'exec-follow-up' },
    ],
  };

  const result = await runTsSnippet(`
    ${IMPORTS}
    const aggregate = ${JSON.stringify(aggregate)};
    const turns = buildChatTurns(aggregate, 'exec-follow-up');
    console.log(JSON.stringify(turns.map((turn) => ({
      key: turn.key,
      live: turn.live,
      firstCauseTitle: turn.conclusionState?.causes[0]?.title ?? null,
      suggestedQuestions: turn.conclusionState?.suggestedQuestions ?? [],
      suggestedActions: turn.conclusionState?.suggestedActions ?? [],
    }))));
  `);

  assert.equal(result.length, 2);
  assert.equal(result[0].firstCauseTitle, '年度结论');
  assert.equal(result[1].firstCauseTitle, '月度结论');
  assert.deepEqual(result[0].suggestedQuestions, ['按月份展开']);
  assert.deepEqual(result[1].suggestedQuestions, []);
  assert.deepEqual(result[0].suggestedActions, []);
  assert.deepEqual(result[1].suggestedActions, [
    { label: '创建排查工单', rationale: '失败集中' },
  ]);
  assert.equal(result[0].live, false);
  assert.equal(result[1].live, true);
});

test('Story 12.7 | 无结论态的轮次保持空内容，不借用其他轮次', async () => {
  const aggregate = {
    history: [
      {
        id: 'round-1', kind: 'initial', questionText: '初始问题',
        followUpId: null, executionId: 'exec-1', status: 'failed',
        ontologyVersionId: null, ontologyVersionBindingSource: null,
        planSnapshot: null, conclusionState: null,
        createdAt: '2026-01-01T00:00:00Z',
      },
    ],
    followUps: [
      { id: 'fu-pending', questionText: '新消息', resultExecutionId: null },
    ],
  };

  const result = await runTsSnippet(`
    ${IMPORTS}
    const aggregate = ${JSON.stringify(aggregate)};
    const turns = buildChatTurns(aggregate, 'exec-1');
    console.log(JSON.stringify(turns.map((turn) => ({
      key: turn.key,
      status: turn.status,
      conclusionState: turn.conclusionState,
    }))));
  `);

  assert.equal(result[0].status, 'failed');
  assert.equal(result[0].conclusionState, null);
  assert.equal(result[1].status, 'pending');
  assert.equal(result[1].conclusionState, null);
});
