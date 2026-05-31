import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
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
  const { buildConversationViewModel } = vmModule;
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

test('AC1 | 用户消息始终包含原始问题文本和 badges', async () => {
  const result = await runTsSnippet(`
    ${IMPORTS}
    const vm = buildConversationViewModel({
      questionText: '查询丰台项目本年的物业费收缴率',
      intentLabel: '指标查询',
      ontologyVersion: 'v2.1.0',
      followUpLabel: '追问模式',
      projection: null,
      events: [],
      hasConnectionIssue: false,
    });
    console.log(JSON.stringify({
      questionText: vm.userMessage.questionText,
      badges: vm.userMessage.badges,
      metadata: vm.userMessage.metadata,
    }));
  `);

  assert.equal(result.questionText, '查询丰台项目本年的物业费收缴率');
  assert.equal(result.badges.length, 3);
  assert.equal(result.badges[0].label, '指标查询');
  assert.equal(result.badges[0].tone, 'info');
  assert.equal(result.badges[1].label, '追问模式');
  assert.equal(result.badges[1].tone, 'neutral');
  assert.equal(result.badges[2].label, 'v2.1.0');
  assert.equal(result.metadata.intentLabel, '指标查询');
});

test('AC2 | 无事件无 projection 时助手状态为 queued', async () => {
  const result = await runTsSnippet(`
    ${IMPORTS}
    const vm = buildConversationViewModel({
      questionText: '测试',
      projection: null,
      events: [],
      hasConnectionIssue: false,
    });
    console.log(JSON.stringify({
      status: vm.assistantMessage.status,
      headline: vm.assistantMessage.headline,
    }));
  `);

  assert.equal(result.status, 'queued');
  assert.equal(result.headline, '问题已提交，正在准备分析');
});

test('AC2 | projection completed 时助手状态为 completed', async () => {
  const events = [buildEvent({ sequence: 1, kind: 'execution-status', status: 'completed' })];
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
      status: vm.assistantMessage.status,
      headline: vm.assistantMessage.headline,
    }));
  `);

  assert.equal(result.status, 'completed');
  assert.equal(result.headline, '分析完成');
});

test('AC2 | projection failed 时助手状态为 failed', async () => {
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
    console.log(JSON.stringify({
      status: vm.assistantMessage.status,
      headline: vm.assistantMessage.headline,
    }));
  `);

  assert.equal(result.status, 'failed');
  assert.equal(result.headline, '分析过程中遇到问题');
});

test('AC2 | 连接中断时助手状态为 disconnected', async () => {
  const result = await runTsSnippet(`
    ${IMPORTS}
    const vm = buildConversationViewModel({
      questionText: '测试', projection: null, events: [], hasConnectionIssue: true,
    });
    console.log(JSON.stringify({
      status: vm.assistantMessage.status,
      headline: vm.assistantMessage.headline,
    }));
  `);

  assert.equal(result.status, 'disconnected');
  assert.equal(result.headline, '实时连接中断，结果可能仍在后台继续生成');
});

test('AC3 | 从事件 renderBlocks 中提取 tool-list 为 toolActivities', async () => {
  const events = [
    buildEvent({
      sequence: 1,
      renderBlocks: [
        {
          type: 'tool-list',
          title: '工具选择',
          items: [
            { toolName: 'cube.semantic-query', objective: '查询物业费数据', status: 'running' },
            { toolName: 'neo4j.graph-query', objective: '查询关联关系', status: 'completed' },
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
      count: vm.assistantMessage.toolActivities.length,
      activities: vm.assistantMessage.toolActivities,
    }));
  `);

  assert.equal(result.count, 2);
  assert.equal(result.activities[0].toolName, 'cube.semantic-query');
  assert.equal(result.activities[0].status, 'running');
  assert.equal(result.activities[1].toolName, 'neo4j.graph-query');
  assert.equal(result.activities[1].status, 'completed');
});

test('AC3 | 重复 tool 调用覆盖为最新状态（running → completed）', async () => {
  const events = [
    buildEvent({
      sequence: 1,
      renderBlocks: [
        {
          type: 'tool-list',
          title: '工具选择',
          items: [{ toolName: 'cube', objective: '查询', status: 'running' }],
        },
      ],
    }),
    buildEvent({
      id: 'evt-2',
      sequence: 2,
      renderBlocks: [
        {
          type: 'tool-list',
          title: '工具更新',
          items: [{ toolName: 'cube', objective: '查询', status: 'completed' }],
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
      count: vm.assistantMessage.toolActivities.length,
      status: vm.assistantMessage.toolActivities[0]?.status,
    }));
  `);

  assert.equal(result.count, 1);
  assert.equal(result.status, 'completed', '应覆盖为最新状态 completed，而非保留 running');
});

test('AC3 | tool-list 不出现在 result blocks 中', async () => {
  const events = [
    buildEvent({
      sequence: 1,
      renderBlocks: [
        {
          type: 'tool-list',
          title: '工具',
          items: [{ toolName: 'cube', objective: '查询', status: 'completed' }],
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
    const allKinds = [];
    if (vm.assistantMessage.result) {
      for (const b of vm.assistantMessage.result.blocks) allKinds.push(b.kind);
      for (const b of vm.assistantMessage.result.evidenceBlocks) allKinds.push(b.kind);
      for (const b of vm.assistantMessage.result.reasoningBlocks) allKinds.push(b.kind);
      for (const b of vm.assistantMessage.result.assumptionBlocks) allKinds.push(b.kind);
    }
    console.log(JSON.stringify({ hasToolList: allKinds.includes('tool-list') }));
  `);

  assert.equal(result.hasToolList, false);
});

test('AC4 | chart / table / kv-list 进入 result blocks', async () => {
  const events = [
    buildEvent({
      sequence: 1,
      kind: 'stage-result',
      renderBlocks: [
        { type: 'chart', title: '收缴率趋势', chartType: 'bar', series: [{ label: 's', points: [{ label: 'Q1', value: 80 }] }] },
        { type: 'table', title: '项目对比', columns: ['项目', '收缴率'], rows: [['丰台', '78%']] },
        { type: 'kv-list', title: '指标', items: [{ label: '收缴率', value: '78%' }] },
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
    const resultKinds = vm.assistantMessage.result
      ? vm.assistantMessage.result.blocks.map(b => b.kind) : [];
    console.log(JSON.stringify({ resultKinds, hasResult: !!vm.assistantMessage.result }));
  `);

  assert.ok(result.hasResult);
  assert.ok(result.resultKinds.includes('chart'));
  assert.ok(result.resultKinds.includes('table'));
  assert.ok(result.resultKinds.includes('kv-list'));
});

test('AC4 | evidence-card 进入 evidenceBlocks', async () => {
  const events = [
    buildEvent({
      sequence: 1,
      kind: 'stage-result',
      renderBlocks: [
        { type: 'evidence-card', title: '数据证据', summary: '关键数据摘要', evidence: [{ label: '来源', summary: 'Cube' }] },
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
    const evidenceKinds = vm.assistantMessage.result
      ? vm.assistantMessage.result.evidenceBlocks.map(b => b.kind) : [];
    console.log(JSON.stringify({ evidenceKinds, hasResult: !!vm.assistantMessage.result }));
  `);

  assert.ok(result.hasResult);
  assert.ok(result.evidenceKinds.includes('evidence-card'));
});

test('AC4 | reasoning-summary 进入 reasoningBlocks', async () => {
  const events = [
    buildEvent({
      sequence: 1,
      kind: 'stage-result',
      renderBlocks: [
        { type: 'markdown', title: '推理摘要', content: '收缴率下降主要受季节性因素影响。' },
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
    const reasoningKinds = vm.assistantMessage.result
      ? vm.assistantMessage.result.reasoningBlocks.map(b => b.kind) : [];
    console.log(JSON.stringify({ reasoningKinds, hasResult: !!vm.assistantMessage.result }));
  `);

  assert.ok(result.hasResult);
  assert.ok(result.reasoningKinds.includes('reasoning-summary'));
});

test('AC5 | step-timeline 进入 diagnostics.timelineBlocks，不在 result 中', async () => {
  const events = [
    buildEvent({
      sequence: 1, kind: 'step-lifecycle',
      step: { id: 'step-1', order: 1, title: '数据查询', status: 'completed', dependsOn: [] },
    }),
    buildEvent({
      id: 'evt-2', sequence: 2, kind: 'step-lifecycle',
      step: { id: 'step-2', order: 2, title: '原因分析', status: 'running', dependsOn: ['step-1'] },
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
    const diagKinds = vm.assistantMessage.diagnostics.timelineBlocks.map(b => b.kind);
    const resultKinds = vm.assistantMessage.result
      ? vm.assistantMessage.result.blocks.map(b => b.kind) : [];
    console.log(JSON.stringify({
      diagKinds,
      hasTimelineInResult: resultKinds.includes('timeline'),
      eventCount: vm.assistantMessage.diagnostics.eventCount,
      executionId: vm.assistantMessage.diagnostics.executionId,
    }));
  `);

  assert.ok(result.diagKinds.includes('timeline'));
  assert.equal(result.hasTimelineInResult, false);
  assert.equal(result.eventCount, 2);
  assert.equal(result.executionId, 'exec-1');
});

test('AC5 | resume-anchor 不出现在任何渲染分类中', async () => {
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
    const allKinds = [];
    if (vm.assistantMessage.result) {
      for (const b of vm.assistantMessage.result.blocks) allKinds.push(b.kind);
      for (const b of vm.assistantMessage.result.evidenceBlocks) allKinds.push(b.kind);
      for (const b of vm.assistantMessage.result.reasoningBlocks) allKinds.push(b.kind);
      for (const b of vm.assistantMessage.result.assumptionBlocks) allKinds.push(b.kind);
    }
    for (const b of vm.assistantMessage.diagnostics.timelineBlocks) allKinds.push(b.kind);
    for (const b of vm.assistantMessage.diagnostics.processBoardBlocks) allKinds.push(b.kind);
    for (const b of vm.assistantMessage.diagnostics.otherBlocks) allKinds.push(b.kind);
    console.log(JSON.stringify({ hasResumeAnchor: allKinds.includes('resume-anchor') }));
  `);

  assert.equal(result.hasResumeAnchor, false);
});

test('AC6 | 从事件 metadata 中提取步骤进度', async () => {
  const events = [buildEvent({ sequence: 1, metadata: { processedStepCount: 2, totalStepCount: 5 } })];
  const result = await runTsSnippet(`
    ${IMPORTS}
    const events = ${JSON.stringify(events)};
    const projection = buildAiRuntimeProjection({
      sessionId: 'session-1', executionId: 'exec-1', events, fallbackConclusion: null,
    });
    const vm = buildConversationViewModel({
      questionText: '测试', projection, events, hasConnectionIssue: false,
    });
    console.log(JSON.stringify({ progressLabel: vm.assistantMessage.progressLabel ?? null }));
  `);

  assert.equal(result.progressLabel, '2/5 步已完成');
});

test('AC4 | conclusion-card 存在时产生带 conclusion-summary 的 result section', async () => {
  const events = [buildEvent({ sequence: 1, kind: 'execution-status', status: 'completed' })];
  // 使用真实 RankedConclusionCause shape：confidence 是 number，evidence 是 {label, summary}[]
  const fallbackConclusion = {
    causes: [{
      id: 'cause-1',
      rank: 1,
      title: '物业费收缴率偏低',
      summary: '丰台项目本年物业费收缴率为 78%，低于集团 85% 的基准线。',
      confidence: 0.82,
      evidence: [
        { label: '收缴率', summary: '78%' },
        { label: '基准线', summary: '85%' },
      ],
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
      questionText: '查询丰台项目本年的物业费收缴率', projection, events, hasConnectionIssue: false,
    });
    console.log(JSON.stringify({
      hasResult: !!vm.assistantMessage.result,
      headline: vm.assistantMessage.result?.headline,
      firstBlockKind: vm.assistantMessage.result?.blocks[0]?.kind,
    }));
  `);

  assert.ok(result.hasResult);
  assert.equal(result.headline, '物业费收缴率偏低');
  assert.equal(result.firstBlockKind, 'conclusion-summary');
});

test('AC7 | 无结论时 result 为 null', async () => {
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
    console.log(JSON.stringify({ hasResult: !!vm.assistantMessage.result }));
  `);

  assert.equal(result.hasResult, false);
});

test('AC7 | 有事件但无 projection 时降级为 running', async () => {
  const events = [buildEvent({ sequence: 1 })];
  const result = await runTsSnippet(`
    ${IMPORTS}
    const events = ${JSON.stringify(events)};
    const vm = buildConversationViewModel({
      questionText: '测试', projection: null, events, hasConnectionIssue: false,
    });
    console.log(JSON.stringify({ status: vm.assistantMessage.status }));
  `);

  assert.equal(result.status, 'running');
});

test('AC8 | 终态（completed）优先于断流，不显示为 disconnected', async () => {
  const events = [buildEvent({ sequence: 1, kind: 'execution-status', status: 'completed' })];
  const result = await runTsSnippet(`
    ${IMPORTS}
    const events = ${JSON.stringify(events)};
    const projection = buildAiRuntimeProjection({
      sessionId: 'session-1', executionId: 'exec-1', events, fallbackConclusion: null,
    });
    const vm = buildConversationViewModel({
      questionText: '测试', projection, events, hasConnectionIssue: true,
    });
    console.log(JSON.stringify({ status: vm.assistantMessage.status }));
  `);

  assert.equal(result.status, 'completed', '已完成的任务不应被断流覆盖为 disconnected');
});

test('AC8 | 终态（failed）优先于断流', async () => {
  const events = [buildEvent({ sequence: 1, kind: 'execution-status', status: 'failed' })];
  const result = await runTsSnippet(`
    ${IMPORTS}
    const events = ${JSON.stringify(events)};
    const projection = buildAiRuntimeProjection({
      sessionId: 'session-1', executionId: 'exec-1', events, fallbackConclusion: null,
    });
    const vm = buildConversationViewModel({
      questionText: '测试', projection, events, hasConnectionIssue: true,
    });
    console.log(JSON.stringify({ status: vm.assistantMessage.status }));
  `);

  assert.equal(result.status, 'failed');
});

test('AC9 | execution-status 事件的 renderBlocks 不泄漏到 result blocks', async () => {
  const events = [
    buildEvent({
      sequence: 1,
      kind: 'execution-status',
      status: 'processing',
      renderBlocks: [
        { type: 'status', title: '执行状态', value: '执行中', tone: 'info' },
        { type: 'markdown', title: '阶段说明', content: '正在处理中' },
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
    const resultKinds = vm.assistantMessage.result
      ? vm.assistantMessage.result.blocks.map(b => b.kind) : [];
    console.log(JSON.stringify({ resultKinds, hasResult: !!vm.assistantMessage.result }));
  `);

  assert.equal(result.hasResult, false, 'execution-status 事件不应产生 result section');
});

test('AC9 | 阶段执行进度与当前步骤不泄漏到主结果区', async () => {
  const events = [
    buildEvent({
      sequence: 1,
      kind: 'stage-progress',
      status: 'processing',
      renderBlocks: [
        { type: 'status', title: '执行进度', value: '执行中', tone: 'info' },
        {
          type: 'kv-list',
          title: '当前步骤',
          items: [{ label: '步骤标题', value: '返回指标结果' }],
        },
      ],
    }),
    buildEvent({
      id: 'evt-2',
      sequence: 2,
      kind: 'stage-result',
      renderBlocks: [
        { type: 'status', title: '阶段状态', value: '已完成', tone: 'success' },
        {
          type: 'kv-list',
          title: '阶段结果',
          items: [{ label: '进度', value: '2/2' }],
        },
        {
          type: 'table',
          title: '指标结果',
          columns: ['项目', '值'],
          rows: [['丰和园小区项目', '78%']],
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
    const resultTitles = vm.assistantMessage.result
      ? vm.assistantMessage.result.blocks.map(b => b.title) : [];
    const diagnosticTitles = vm.assistantMessage.diagnostics.processBoardBlocks.map(b => b.title);
    console.log(JSON.stringify({ resultTitles, diagnosticTitles }));
  `);

  assert.deepEqual(result.resultTitles, ['指标结果']);
  assert.ok(result.diagnosticTitles.includes('执行进度'));
  assert.ok(result.diagnosticTitles.includes('当前步骤'));
  assert.ok(result.diagnosticTitles.includes('阶段状态'));
  assert.ok(result.diagnosticTitles.includes('阶段结果'));
});

test('AC10 | planAssumptions 进入 assumptionBlocks（假设与口径折叠区）', async () => {
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
    const assumptionKinds = vm.assistantMessage.result
      ? vm.assistantMessage.result.assumptionBlocks.map(b => b.kind) : [];
    const firstPayload = vm.assistantMessage.result
      ? vm.assistantMessage.result.assumptionBlocks[0]?.payload : null;
    console.log(JSON.stringify({
      hasResult: !!vm.assistantMessage.result,
      assumptionKinds,
      assumptionCount: assumptionKinds.length,
      assumptions: firstPayload?.assumptions ?? [],
    }));
  `);

  assert.ok(result.hasResult, '有 planAssumptions 时应产生 result section');
  assert.equal(result.assumptionCount, 1);
  assert.equal(result.assumptionKinds[0], 'assumption-card');
  assert.deepEqual(result.assumptions, ['数据周期为自然年', '仅考虑已入账费用']);
});

test('AC11 | 渲染失败的 block 进入 diagnostics.renderErrors 而非静默丢失', async () => {
  // 构造一个会导致 normalizeExecutionRenderBlock 抛异常的 block（缺少 type 字段）
  const events = [
    buildEvent({
      sequence: 1,
      kind: 'stage-result',
      renderBlocks: [
        { title: '坏块' },
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
    const resultKinds = vm.assistantMessage.result
      ? vm.assistantMessage.result.blocks.map(b => b.kind) : [];
    const renderError = vm.assistantMessage.diagnostics.renderErrors[0] ?? null;
    console.log(JSON.stringify({
      resultKinds,
      renderErrorCount: vm.assistantMessage.diagnostics.renderErrors.length,
      errorKind: renderError?.kind ?? null,
      originalBlockType: renderError?.payload?.originalBlockType ?? null,
    }));
  `);

  assert.equal(result.resultKinds.length, 0, '坏 block 不应伪装成正常结果');
  assert.equal(result.renderErrorCount, 1);
  assert.equal(result.errorKind, 'render-error');
  assert.equal(result.originalBlockType, 'unknown');
});

test('AC12 | 无 execution 时必须展示阻断原因与手动执行入口，不能只空等', async () => {
  const source = await readFile(
    'src/app/(workspace)/workspace/analysis/[sessionId]/page.tsx',
    'utf8',
  );

  assert.match(source, /analysis-pending-conversation/);
  assert.match(source, /analysis-execution-blocked/);
  assert.match(source, /手动执行当前计划/);
  assert.match(source, /查看执行计划与阻断原因/);
  assert.match(source, /AnalysisPendingRefreshGate/);
});
