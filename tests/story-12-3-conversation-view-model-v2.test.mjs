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
  const { buildConversationViewModel, translateToolName, translateStepStatus } = vmModule;
  const { buildAiRuntimeProjection } = mapperModule;
`;

function buildEvent(overrides = {}) {
  return {
    id: overrides.id ?? `evt-${overrides.sequence ?? 1}`,
    sessionId: overrides.sessionId ?? 'session-1',
    executionId: overrides.executionId ?? 'exec-1',
    sequence: overrides.sequence ?? 1,
    timestamp: overrides.timestamp ?? '2026-01-01T00:00:00Z',
    kind: overrides.kind ?? 'step-lifecycle',
    status: overrides.status,
    message: overrides.message,
    step: overrides.step ?? null,
    stage: overrides.stage ?? null,
    renderBlocks: overrides.renderBlocks ?? [],
    metadata: overrides.metadata ?? {},
  };
}

// ---------------------------------------------------------------------------
// AC1: translateToolName 翻译层
// ---------------------------------------------------------------------------

test('AC1 | translateToolName 把内部工具名翻译为业务语言', async () => {
  const result = await runTsSnippet(`
    ${IMPORTS}
    console.log(JSON.stringify({
      cube: translateToolName('cube.semantic-query'),
      neo4j: translateToolName('neo4j.graph-query'),
      llm: translateToolName('llm.structured-analysis'),
      erp: translateToolName('erp-read'),
      unknown: translateToolName('some-unknown-tool'),
    }));
  `);

  assert.equal(result.cube, '数据查询');
  assert.equal(result.neo4j, '关系分析');
  assert.equal(result.llm, '智能分析');
  assert.equal(result.erp, '业务数据读取');
  assert.equal(result.unknown, 'some-unknown-tool', '未知工具名保持原样');
});

test('AC1 | translateStepStatus 翻译事件 kind 为业务标签', async () => {
  const result = await runTsSnippet(`
    ${IMPORTS}
    console.log(JSON.stringify({
      exec: translateStepStatus('execution-status'),
      step: translateStepStatus('step-lifecycle'),
      stage: translateStepStatus('stage-result'),
      unknown: translateStepStatus('other-kind'),
    }));
  `);

  assert.equal(result.exec, '执行状态');
  assert.equal(result.step, '步骤进度');
  assert.equal(result.stage, '阶段结果');
  assert.equal(result.unknown, 'other-kind', '未知 kind 保持原样');
});

// ---------------------------------------------------------------------------
// AC2: primaryAnswer 提取
// ---------------------------------------------------------------------------

test('AC2 | 有结论时 primaryAnswer 来自 conclusion summary', async () => {
  const events = [buildEvent({ sequence: 1, kind: 'execution-status', status: 'completed' })];
  const fallbackConclusion = {
    causes: [{
      id: 'cause-1',
      rank: 1,
      title: '物业费收缴率偏低',
      summary: '丰台项目本年物业费收缴率为 78%，低于集团 85% 的基准线。',
      confidence: 0.82,
      evidence: [{ label: '收缴率', summary: '78%' }],
    }],
    renderBlocks: [],
  };
  const result = await runTsSnippet(`
    ${IMPORTS}
    const events = ${JSON.stringify(events)};
    const fallbackConclusion = ${JSON.stringify(fallbackConclusion)};
    const projection = buildAiRuntimeProjection({
      sessionId: 'session-1', executionId: 'exec-1', events, fallbackConclusion,
    });
    const vm = buildConversationViewModel({
      questionText: '查询物业费收缴率', projection, events, hasConnectionIssue: false,
    });
    console.log(JSON.stringify({ primaryAnswer: vm.assistantMessage.primaryAnswer }));
  `);

  assert.ok(
    result.primaryAnswer.includes('78%'),
    `primaryAnswer 应包含业务数据：${result.primaryAnswer}`,
  );
});

test('AC2 | 无结论无推理时 primaryAnswer 为空字符串', async () => {
  const events = [buildEvent({ sequence: 1, kind: 'execution-status', status: 'processing' })];
  const result = await runTsSnippet(`
    ${IMPORTS}
    const events = ${JSON.stringify(events)};
    const projection = buildAiRuntimeProjection({
      sessionId: 'session-1', executionId: 'exec-1', events, fallbackConclusion: null,
    });
    const vm = buildConversationViewModel({
      questionText: '测试', projection, events, hasConnectionIssue: false,
    });
    console.log(JSON.stringify({ primaryAnswer: vm.assistantMessage.primaryAnswer }));
  `);

  assert.equal(result.primaryAnswer, '');
});

// ---------------------------------------------------------------------------
// AC3: metricCards 提取
// ---------------------------------------------------------------------------

test('AC3 | 从 kv-list 块中提取 metricCards', async () => {
  const events = [
    buildEvent({
      sequence: 1,
      kind: 'stage-result',
      renderBlocks: [
        {
          type: 'kv-list',
          title: '关键指标',
          items: [
            { label: '物业费收缴率', value: '78%' },
            { label: '欠费金额', value: '¥128,000' },
          ],
        },
      ],
    }),
  ];
  const result = await runTsSnippet(`
    ${IMPORTS}
    const events = ${JSON.stringify(events)};
    const projection = buildAiRuntimeProjection({
      sessionId: 'session-1', executionId: 'exec-1', events, fallbackConclusion: null,
    });
    const vm = buildConversationViewModel({
      questionText: '查询物业费', projection, events, hasConnectionIssue: false,
    });
    console.log(JSON.stringify({
      count: vm.assistantMessage.metricCards.length,
      cards: vm.assistantMessage.metricCards,
    }));
  `);

  assert.equal(result.count, 2);
  assert.equal(result.cards[0].label, '物业费收缴率');
  assert.equal(result.cards[0].value, '78%');
  assert.equal(result.cards[1].label, '欠费金额');
  assert.equal(result.cards[1].value, '¥128,000');
});

test('AC3 | 从 metric chart 中提取 metricCards', async () => {
  const events = [
    buildEvent({
      sequence: 1,
      kind: 'stage-result',
      renderBlocks: [
        {
          type: 'chart',
          title: '收缴率',
          chartType: 'metric',
          series: [{ name: '收缴率', points: [{ label: 'current', value: 78 }] }],
          unit: '%',
        },
      ],
    }),
  ];
  const result = await runTsSnippet(`
    ${IMPORTS}
    const events = ${JSON.stringify(events)};
    const projection = buildAiRuntimeProjection({
      sessionId: 'session-1', executionId: 'exec-1', events, fallbackConclusion: null,
    });
    const vm = buildConversationViewModel({
      questionText: '收缴率', projection, events, hasConnectionIssue: false,
    });
    console.log(JSON.stringify({
      count: vm.assistantMessage.metricCards.length,
      firstLabel: vm.assistantMessage.metricCards[0]?.label,
      firstValue: vm.assistantMessage.metricCards[0]?.value,
      firstUnit: vm.assistantMessage.metricCards[0]?.unit,
    }));
  `);

  assert.equal(result.count, 1);
  assert.equal(result.firstLabel, '收缴率');
  assert.equal(result.firstValue, '78');
  assert.equal(result.firstUnit, '%');
});

// ---------------------------------------------------------------------------
// AC4: visualizations 提取
// ---------------------------------------------------------------------------

test('AC4 | chart / graph / table 块提取为 visualizations', async () => {
  const events = [
    buildEvent({
      sequence: 1,
      kind: 'stage-result',
      renderBlocks: [
        {
          type: 'chart',
          title: '收缴率趋势',
          chartType: 'bar',
          series: [{ name: '收缴率', points: [{ label: 'Q1', value: 80 }] }],
        },
        {
          type: 'table',
          title: '项目对比',
          columns: ['项目', '收缴率'],
          rows: [['丰台', '78%']],
        },
        {
          type: 'graph',
          title: '关联关系',
          nodes: [{ id: 'n1', label: '项目' }],
          edges: [{ source: 'n1', target: 'n1', label: 'self' }],
        },
      ],
    }),
  ];
  const result = await runTsSnippet(`
    ${IMPORTS}
    const events = ${JSON.stringify(events)};
    const projection = buildAiRuntimeProjection({
      sessionId: 'session-1', executionId: 'exec-1', events, fallbackConclusion: null,
    });
    const vm = buildConversationViewModel({
      questionText: '分析', projection, events, hasConnectionIssue: false,
    });
    console.log(JSON.stringify({
      count: vm.assistantMessage.visualizations.length,
      types: vm.assistantMessage.visualizations.map(v => v.type),
      titles: vm.assistantMessage.visualizations.map(v => v.title),
    }));
  `);

  assert.equal(result.count, 3);
  assert.deepEqual(result.types, ['chart', 'table', 'graph']);
  assert.ok(result.titles.includes('收缴率趋势'));
  assert.ok(result.titles.includes('项目对比'));
  assert.ok(result.titles.includes('关联关系'));
});

test('AC4 | metric chart 不出现在 visualizations 中', async () => {
  const events = [
    buildEvent({
      sequence: 1,
      kind: 'stage-result',
      renderBlocks: [
        {
          type: 'chart',
          title: '收缴率',
          chartType: 'metric',
          series: [{ name: '收缴率', points: [{ label: 'current', value: 78 }] }],
        },
      ],
    }),
  ];
  const result = await runTsSnippet(`
    ${IMPORTS}
    const events = ${JSON.stringify(events)};
    const projection = buildAiRuntimeProjection({
      sessionId: 'session-1', executionId: 'exec-1', events, fallbackConclusion: null,
    });
    const vm = buildConversationViewModel({
      questionText: '收缴率', projection, events, hasConnectionIssue: false,
    });
    console.log(JSON.stringify({
      vizCount: vm.assistantMessage.visualizations.length,
      metricCount: vm.assistantMessage.metricCards.length,
    }));
  `);

  assert.equal(result.vizCount, 0, 'metric chart 不应进入 visualizations');
  assert.equal(result.metricCount, 1, 'metric chart 应进入 metricCards');
});

// ---------------------------------------------------------------------------
// AC5: toolTimeline 结构
// ---------------------------------------------------------------------------

test('AC5 | 从 step-timeline 提取 toolTimeline，包含 subSteps', async () => {
  const events = [
    buildEvent({
      sequence: 1,
      kind: 'step-lifecycle',
      step: { id: 'step-1', order: 1, title: '查询物业费数据', status: 'completed', dependsOn: [] },
      renderBlocks: [
        {
          type: 'tool-list',
          title: '工具',
          items: [
            { toolName: 'cube.semantic-query', objective: '查询物业费', status: 'completed' },
          ],
        },
      ],
    }),
    buildEvent({
      id: 'evt-2',
      sequence: 2,
      kind: 'step-lifecycle',
      step: { id: 'step-2', order: 2, title: '原因分析', status: 'running', dependsOn: ['step-1'] },
      renderBlocks: [
        {
          type: 'tool-list',
          title: '工具',
          items: [
            { toolName: 'llm.structured-analysis', objective: '分析收缴率偏低原因', status: 'running' },
          ],
        },
      ],
    }),
  ];
  const result = await runTsSnippet(`
    ${IMPORTS}
    const events = ${JSON.stringify(events)};
    const projection = buildAiRuntimeProjection({
      sessionId: 'session-1', executionId: 'exec-1', events, fallbackConclusion: null,
    });
    const vm = buildConversationViewModel({
      questionText: '分析', projection, events, hasConnectionIssue: false,
    });
    console.log(JSON.stringify({
      count: vm.assistantMessage.toolTimeline.length,
      timeline: vm.assistantMessage.toolTimeline,
    }));
  `);

  assert.equal(result.count, 2);
  assert.equal(result.timeline[0].stepId, 'step-1');
  assert.equal(result.timeline[0].stepName, '查询物业费数据');
  assert.equal(result.timeline[0].status, 'completed');
  assert.equal(result.timeline[0].subSteps.length, 1);
  assert.equal(result.timeline[0].subSteps[0].toolName, 'cube.semantic-query');

  assert.equal(result.timeline[1].stepId, 'step-2');
  assert.equal(result.timeline[1].stepName, '原因分析');
  assert.equal(result.timeline[1].status, 'running');
  assert.equal(result.timeline[1].subSteps.length, 1);
  assert.equal(result.timeline[1].subSteps[0].toolName, 'llm.structured-analysis');
});

test('AC5 | 无 step-timeline 时 toolTimeline 退化为汇总', async () => {
  const events = [
    buildEvent({
      sequence: 1,
      kind: 'stage-result',
      renderBlocks: [
        {
          type: 'tool-list',
          title: '工具',
          items: [
            { toolName: 'cube.semantic-query', objective: '查询', status: 'completed' },
          ],
        },
      ],
    }),
  ];
  const result = await runTsSnippet(`
    ${IMPORTS}
    const events = ${JSON.stringify(events)};
    const projection = buildAiRuntimeProjection({
      sessionId: 'session-1', executionId: 'exec-1', events, fallbackConclusion: null,
    });
    const vm = buildConversationViewModel({
      questionText: '测试', projection, events, hasConnectionIssue: false,
    });
    console.log(JSON.stringify({
      count: vm.assistantMessage.toolTimeline.length,
      firstStepName: vm.assistantMessage.toolTimeline[0]?.stepName,
      subCount: vm.assistantMessage.toolTimeline[0]?.subSteps.length,
    }));
  `);

  assert.equal(result.count, 1);
  assert.equal(result.firstStepName, '分析步骤');
  assert.equal(result.subCount, 1);
});

// ---------------------------------------------------------------------------
// AC6: hiddenDiagnostics
// ---------------------------------------------------------------------------

test('AC6 | 诊断块进入 hiddenDiagnostics 列表', async () => {
  const events = [
    buildEvent({
      sequence: 1,
      kind: 'stage-progress',
      status: 'processing',
      renderBlocks: [
        { type: 'status', title: '执行进度', value: '执行中', tone: 'info' },
      ],
    }),
  ];
  const result = await runTsSnippet(`
    ${IMPORTS}
    const events = ${JSON.stringify(events)};
    const projection = buildAiRuntimeProjection({
      sessionId: 'session-1', executionId: 'exec-1', events, fallbackConclusion: null,
    });
    const vm = buildConversationViewModel({
      questionText: '测试', projection, events, hasConnectionIssue: false,
    });
    console.log(JSON.stringify({
      count: vm.assistantMessage.hiddenDiagnostics.length,
      labels: vm.assistantMessage.hiddenDiagnostics.map(d => d.label),
    }));
  `);

  assert.ok(result.count > 0, '应有 hiddenDiagnostics');
  assert.ok(result.labels.includes('执行进度'));
});

// ---------------------------------------------------------------------------
// AC7: assumptionSummary
// ---------------------------------------------------------------------------

test('AC7 | planAssumptions 直接映射为 assumptionSummary', async () => {
  const events = [buildEvent({ sequence: 1, kind: 'execution-status', status: 'processing' })];
  const result = await runTsSnippet(`
    ${IMPORTS}
    const events = ${JSON.stringify(events)};
    const projection = buildAiRuntimeProjection({
      sessionId: 'session-1', executionId: 'exec-1', events, fallbackConclusion: null,
    });
    const vm = buildConversationViewModel({
      questionText: '测试', projection, events, hasConnectionIssue: false,
      planAssumptions: ['数据周期为自然年', '仅考虑已入账费用'],
    });
    console.log(JSON.stringify({
      assumptionSummary: vm.assistantMessage.assumptionSummary,
    }));
  `);

  assert.deepEqual(result.assumptionSummary, [
    '数据周期为自然年',
    '仅考虑已入账费用',
  ]);
});

test('AC7 | 无 planAssumptions 时 assumptionSummary 为空数组', async () => {
  const events = [buildEvent({ sequence: 1, kind: 'execution-status', status: 'processing' })];
  const result = await runTsSnippet(`
    ${IMPORTS}
    const events = ${JSON.stringify(events)};
    const projection = buildAiRuntimeProjection({
      sessionId: 'session-1', executionId: 'exec-1', events, fallbackConclusion: null,
    });
    const vm = buildConversationViewModel({
      questionText: '测试', projection, events, hasConnectionIssue: false,
    });
    console.log(JSON.stringify({
      assumptionSummary: vm.assistantMessage.assumptionSummary,
    }));
  `);

  assert.deepEqual(result.assumptionSummary, []);
});

// ---------------------------------------------------------------------------
// AC8: 业务语言（无工程术语泄漏）
// ---------------------------------------------------------------------------

test('AC8 | queued headline 不含 "worker" / "任务" 等工程术语', async () => {
  const result = await runTsSnippet(`
    ${IMPORTS}
    const vm = buildConversationViewModel({
      questionText: '测试', projection: null, events: [], hasConnectionIssue: false,
    });
    console.log(JSON.stringify({ headline: vm.assistantMessage.headline }));
  `);

  assert.ok(!result.headline.includes('worker'), 'headline 不应包含 worker');
  assert.ok(!result.headline.includes('任务'), 'headline 不应包含 任务');
});

test('AC8 | failed headline 使用业务语言', async () => {
  const events = [buildEvent({ sequence: 1, kind: 'execution-status', status: 'failed' })];
  const result = await runTsSnippet(`
    ${IMPORTS}
    const events = ${JSON.stringify(events)};
    const projection = buildAiRuntimeProjection({
      sessionId: 'session-1', executionId: 'exec-1', events, fallbackConclusion: null,
    });
    const vm = buildConversationViewModel({
      questionText: '测试', projection, events, hasConnectionIssue: false,
    });
    console.log(JSON.stringify({ headline: vm.assistantMessage.headline }));
  `);

  assert.equal(result.headline, '分析过程中遇到问题');
  assert.ok(!result.headline.includes('执行'), 'headline 不应包含 执行');
});

// ---------------------------------------------------------------------------
// AC9: 无 projection 时 toolTimeline 也能正确构建
// ---------------------------------------------------------------------------

test('AC9 | 无 projection 时 fallback 路径也填充 toolTimeline 与 assumptionSummary', async () => {
  const events = [
    buildEvent({
      sequence: 1,
      kind: 'step-lifecycle',
      step: { id: 'step-1', order: 1, title: '数据查询', status: 'completed', dependsOn: [] },
    }),
  ];
  const result = await runTsSnippet(`
    ${IMPORTS}
    const events = ${JSON.stringify(events)};
    const vm = buildConversationViewModel({
      questionText: '测试', projection: null, events, hasConnectionIssue: false,
      planAssumptions: ['假设A'],
    });
    console.log(JSON.stringify({
      timelineCount: vm.assistantMessage.toolTimeline.length,
      assumptionSummary: vm.assistantMessage.assumptionSummary,
      primaryAnswer: vm.assistantMessage.primaryAnswer,
      metricCards: vm.assistantMessage.metricCards,
      visualizations: vm.assistantMessage.visualizations,
    }));
  `);

  assert.ok(result.timelineCount >= 1, '应至少有一个时间线条目');
  assert.deepEqual(result.assumptionSummary, ['假设A']);
  assert.equal(result.primaryAnswer, '');
  assert.deepEqual(result.metricCards, []);
  assert.deepEqual(result.visualizations, []);
});
