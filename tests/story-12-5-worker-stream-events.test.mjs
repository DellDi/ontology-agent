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

const RENDERER_IMPORTS = `
  import rendererModule from './src/worker/analysis-execution-renderer.ts';
  const {
    buildStepStartedEvent,
    buildToolStartedEvent,
    buildToolCompletedEvent,
    buildToolFailedEvent,
    buildStepCompletedEvent,
    computeDurationMs,
  } = rendererModule;
`;

const VM_IMPORTS = `
  import vmModule from './src/application/analysis-message-projection/conversation-view-model.ts';
  const {
    buildConversationViewModel,
    translateToolName,
    translateStepStatus,
    formatDurationMs,
  } = vmModule;
`;

const TRANSLATIONS_IMPORTS = `
  import translationsModule from './src/application/analysis-message-projection/tool-name-translations.ts';
  const {
    TOOL_NAME_TRANSLATIONS,
    translateToolName,
  } = translationsModule;
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
    tool: overrides.tool ?? null,
    renderBlocks: overrides.renderBlocks ?? [],
    metadata: overrides.metadata ?? {},
  };
}

// ---------------------------------------------------------------------------
// AC1: 新事件构建器产生正确的事件形状
// ---------------------------------------------------------------------------

test('AC1 | buildStepStartedEvent 生成 step-started 事件', async () => {
  const result = await runTsSnippet(`
    ${RENDERER_IMPORTS}
    const event = buildStepStartedEvent({
      sessionId: 's1',
      executionId: 'e1',
      step: { id: 'step-1', order: 1, title: '查询物业费数据' },
    });
    console.log(JSON.stringify(event));
  `);

  assert.equal(result.kind, 'step-started');
  assert.equal(result.sessionId, 's1');
  assert.equal(result.executionId, 'e1');
  assert.equal(result.step.id, 'step-1');
  assert.equal(result.step.order, 1);
  assert.equal(result.step.title, '查询物业费数据');
  assert.equal(result.step.status, 'running');
  assert.ok(result.message.includes('步骤 1'), 'message 包含步骤序号');
  assert.ok(result.message.includes('查询物业费数据'), 'message 包含步骤标题');
});

test('AC1 | buildToolStartedEvent 生成 tool-started 事件', async () => {
  const result = await runTsSnippet(`
    ${RENDERER_IMPORTS}
    const event = buildToolStartedEvent({
      sessionId: 's1',
      executionId: 'e1',
      step: { id: 'step-1', order: 1, title: '查询数据' },
      tool: { name: 'cube.semantic-query', label: '数据查询', input: { metric: 'fee' } },
    });
    console.log(JSON.stringify(event));
  `);

  assert.equal(result.kind, 'tool-started');
  assert.equal(result.tool.name, 'cube.semantic-query');
  assert.equal(result.tool.label, '数据查询');
  assert.deepEqual(result.tool.input, { metric: 'fee' });
  assert.equal(result.step.status, 'running');
  assert.ok(result.message.includes('数据查询'), 'message 包含工具标签');
});

test('AC1 | buildToolCompletedEvent 生成 tool-completed 事件', async () => {
  const result = await runTsSnippet(`
    ${RENDERER_IMPORTS}
    const event = buildToolCompletedEvent({
      sessionId: 's1',
      executionId: 'e1',
      step: { id: 'step-1', order: 1, title: '查询数据' },
      tool: {
        name: 'cube.semantic-query',
        label: '数据查询',
        output: { rowCount: 5 },
        durationMs: 1234,
      },
    });
    console.log(JSON.stringify(event));
  `);

  assert.equal(result.kind, 'tool-completed');
  assert.equal(result.tool.name, 'cube.semantic-query');
  assert.equal(result.tool.label, '数据查询');
  assert.deepEqual(result.tool.output, { rowCount: 5 });
  assert.equal(result.tool.durationMs, 1234);
  assert.ok(result.message.includes('1234ms'), 'message 包含耗时');
});

test('AC1 | buildToolFailedEvent 生成 tool-failed 事件', async () => {
  const result = await runTsSnippet(`
    ${RENDERER_IMPORTS}
    const event = buildToolFailedEvent({
      sessionId: 's1',
      executionId: 'e1',
      step: { id: 'step-1', order: 1, title: '查询数据' },
      tool: {
        name: 'cube.semantic-query',
        label: '数据查询',
        error: '连接超时',
        durationMs: 5000,
      },
    });
    console.log(JSON.stringify(event));
  `);

  assert.equal(result.kind, 'tool-failed');
  assert.equal(result.tool.error, '连接超时');
  assert.equal(result.tool.durationMs, 5000);
  assert.ok(result.message.includes('失败'), 'message 包含"失败"');
  assert.ok(result.message.includes('连接超时'), 'message 包含错误信息');
});

test('AC1 | buildStepCompletedEvent 生成 step-completed 事件', async () => {
  const result = await runTsSnippet(`
    ${RENDERER_IMPORTS}
    const event = buildStepCompletedEvent({
      sessionId: 's1',
      executionId: 'e1',
      step: { id: 'step-1', order: 2, title: '原因分析', status: 'completed' },
      durationMs: 3456,
      toolCount: 2,
    });
    console.log(JSON.stringify(event));
  `);

  assert.equal(result.kind, 'step-completed');
  assert.equal(result.step.id, 'step-1');
  assert.equal(result.step.order, 2);
  assert.equal(result.step.status, 'completed');
  assert.equal(result.step.durationMs, 3456);
  assert.equal(result.step.toolCount, 2);
  assert.ok(result.message.includes('完成'), 'message 包含"完成"');
  assert.ok(result.message.includes('2 个工具'), 'message 包含工具数');
});

test('AC1 | buildStepCompletedEvent 失败状态使用"失败"标签', async () => {
  const result = await runTsSnippet(`
    ${RENDERER_IMPORTS}
    const event = buildStepCompletedEvent({
      sessionId: 's1',
      executionId: 'e1',
      step: { id: 'step-1', order: 1, title: '查询', status: 'failed' },
      durationMs: 100,
      toolCount: 0,
    });
    console.log(JSON.stringify(event));
  `);

  assert.equal(result.step.status, 'failed');
  assert.ok(result.message.includes('失败'), 'message 包含"失败"');
});

test('AC1 | computeDurationMs 正确计算时间差', async () => {
  const result = await runTsSnippet(`
    ${RENDERER_IMPORTS}
    console.log(JSON.stringify({
      normal: computeDurationMs('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:01.500Z'),
      zero: computeDurationMs('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      invalid: computeDurationMs('not-a-date', '2026-01-01T00:00:00.000Z'),
    }));
  `);

  assert.equal(result.normal, 1500);
  assert.equal(result.zero, 0);
  assert.equal(result.invalid, 0);
});

// ---------------------------------------------------------------------------
// AC2: 视图模型正确处理新事件种类
// ---------------------------------------------------------------------------

test('AC2 | step-started 事件在 toolTimeline 中创建新条目', async () => {
  const events = [
    buildEvent({
      sequence: 1,
      kind: 'step-started',
      step: { id: 'step-1', order: 1, title: '查询物业费', status: 'running' },
    }),
  ];
  const result = await runTsSnippet(`
    ${VM_IMPORTS}
    const events = ${JSON.stringify(events)};
    const vm = buildConversationViewModel({
      questionText: '测试', projection: null, events, hasConnectionIssue: false,
    });
    console.log(JSON.stringify({
      count: vm.assistantMessage.toolTimeline.length,
      first: vm.assistantMessage.toolTimeline[0],
    }));
  `);

  assert.equal(result.count, 1);
  assert.equal(result.first.stepId, 'step-1');
  assert.equal(result.first.stepName, '查询物业费');
  assert.equal(result.first.status, 'running');
});

test('AC2 | tool-started + tool-completed 更新 subStep 状态和耗时', async () => {
  const events = [
    buildEvent({
      sequence: 1,
      kind: 'step-started',
      step: { id: 'step-1', order: 1, title: '查询数据', status: 'running' },
    }),
    buildEvent({
      sequence: 2,
      kind: 'tool-started',
      step: { id: 'step-1', order: 1, title: '查询数据', status: 'running' },
      tool: { name: 'cube.semantic-query', label: '数据查询' },
    }),
    buildEvent({
      sequence: 3,
      kind: 'tool-completed',
      step: { id: 'step-1', order: 1, title: '查询数据', status: 'running' },
      tool: {
        name: 'cube.semantic-query',
        label: '数据查询',
        output: { rowCount: 10 },
        durationMs: 1500,
      },
    }),
  ];
  const result = await runTsSnippet(`
    ${VM_IMPORTS}
    const events = ${JSON.stringify(events)};
    const vm = buildConversationViewModel({
      questionText: '测试', projection: null, events, hasConnectionIssue: false,
    });
    console.log(JSON.stringify({
      timeline: vm.assistantMessage.toolTimeline,
    }));
  `);

  assert.equal(result.timeline.length, 1);
  const step = result.timeline[0];
  assert.equal(step.subSteps.length, 1);
  assert.equal(step.subSteps[0].toolName, 'cube.semantic-query');
  assert.equal(step.subSteps[0].status, 'completed');
  assert.equal(step.subSteps[0].duration, '1.5秒');
  assert.deepEqual(step.subSteps[0].output, { rowCount: 10 });
});

test('AC2 | tool-failed 更新 subStep 错误信息', async () => {
  const events = [
    buildEvent({
      sequence: 1,
      kind: 'step-started',
      step: { id: 'step-1', order: 1, title: '查询', status: 'running' },
    }),
    buildEvent({
      sequence: 2,
      kind: 'tool-started',
      step: { id: 'step-1', order: 1, title: '查询', status: 'running' },
      tool: { name: 'neo4j.graph-query', label: '关系分析' },
    }),
    buildEvent({
      sequence: 3,
      kind: 'tool-failed',
      step: { id: 'step-1', order: 1, title: '查询', status: 'running' },
      tool: {
        name: 'neo4j.graph-query',
        label: '关系分析',
        error: '连接超时',
        durationMs: 5000,
      },
    }),
  ];
  const result = await runTsSnippet(`
    ${VM_IMPORTS}
    const events = ${JSON.stringify(events)};
    const vm = buildConversationViewModel({
      questionText: '测试', projection: null, events, hasConnectionIssue: false,
    });
    console.log(JSON.stringify({
      subStep: vm.assistantMessage.toolTimeline[0].subSteps[0],
    }));
  `);

  assert.equal(result.subStep.status, 'failed');
  assert.equal(result.subStep.error, '连接超时');
  assert.equal(result.subStep.duration, '5.0秒');
});

test('AC2 | step-completed 更新步骤状态、耗时和工具数', async () => {
  const events = [
    buildEvent({
      sequence: 1,
      kind: 'step-started',
      step: { id: 'step-1', order: 1, title: '查询数据', status: 'running' },
    }),
    buildEvent({
      sequence: 2,
      kind: 'step-completed',
      step: {
        id: 'step-1',
        order: 1,
        title: '查询数据',
        status: 'completed',
        durationMs: 2300,
        toolCount: 3,
      },
    }),
  ];
  const result = await runTsSnippet(`
    ${VM_IMPORTS}
    const events = ${JSON.stringify(events)};
    const vm = buildConversationViewModel({
      questionText: '测试', projection: null, events, hasConnectionIssue: false,
    });
    console.log(JSON.stringify({
      step: vm.assistantMessage.toolTimeline[0],
    }));
  `);

  assert.equal(result.step.status, 'completed');
  assert.equal(result.step.duration, '2.3秒');
  assert.equal(result.step.details, '3 个工具调用');
});

test('AC2 | 完整流程: step-started → tool events → step-completed', async () => {
  const events = [
    buildEvent({
      sequence: 1,
      kind: 'step-started',
      step: { id: 'step-1', order: 1, title: '查询数据', status: 'running' },
    }),
    buildEvent({
      sequence: 2,
      kind: 'tool-started',
      step: { id: 'step-1', order: 1, title: '查询数据', status: 'running' },
      tool: { name: 'cube.semantic-query', label: '数据查询' },
    }),
    buildEvent({
      sequence: 3,
      kind: 'tool-completed',
      step: { id: 'step-1', order: 1, title: '查询数据', status: 'running' },
      tool: {
        name: 'cube.semantic-query',
        label: '数据查询',
        durationMs: 800,
      },
    }),
    buildEvent({
      sequence: 4,
      kind: 'tool-started',
      step: { id: 'step-1', order: 1, title: '查询数据', status: 'running' },
      tool: { name: 'llm.structured-analysis', label: '智能分析' },
    }),
    buildEvent({
      sequence: 5,
      kind: 'tool-completed',
      step: { id: 'step-1', order: 1, title: '查询数据', status: 'running' },
      tool: {
        name: 'llm.structured-analysis',
        label: '智能分析',
        durationMs: 2100,
      },
    }),
    buildEvent({
      sequence: 6,
      kind: 'step-completed',
      step: {
        id: 'step-1',
        order: 1,
        title: '查询数据',
        status: 'completed',
        durationMs: 3000,
        toolCount: 2,
      },
    }),
  ];
  const result = await runTsSnippet(`
    ${VM_IMPORTS}
    const events = ${JSON.stringify(events)};
    const vm = buildConversationViewModel({
      questionText: '测试', projection: null, events, hasConnectionIssue: false,
    });
    console.log(JSON.stringify({
      count: vm.assistantMessage.toolTimeline.length,
      step: vm.assistantMessage.toolTimeline[0],
    }));
  `);

  assert.equal(result.count, 1);
  assert.equal(result.step.status, 'completed');
  assert.equal(result.step.duration, '3.0秒');
  assert.equal(result.step.subSteps.length, 2);
  assert.equal(result.step.subSteps[0].toolName, 'cube.semantic-query');
  assert.equal(result.step.subSteps[0].status, 'completed');
  assert.equal(result.step.subSteps[0].duration, '800ms');
  assert.equal(result.step.subSteps[1].toolName, 'llm.structured-analysis');
  assert.equal(result.step.subSteps[1].status, 'completed');
  assert.equal(result.step.subSteps[1].duration, '2.1秒');
});

// ---------------------------------------------------------------------------
// AC3: 翻译映射覆盖所有已知工具
// ---------------------------------------------------------------------------

test('AC3 | TOOL_NAME_TRANSLATIONS 覆盖所有核心工具', async () => {
  const result = await runTsSnippet(`
    ${TRANSLATIONS_IMPORTS}
    console.log(JSON.stringify({
      keys: Object.keys(TOOL_NAME_TRANSLATIONS),
      cube: translateToolName('cube.semantic-query'),
      neo4j: translateToolName('neo4j.graph-query'),
      llm: translateToolName('llm.structured-analysis'),
      erp: translateToolName('erp-read'),
      erpModel: translateToolName('erp.read-model'),
      ctxExtract: translateToolName('context-extraction'),
      planGen: translateToolName('plan-generation'),
      platform: translateToolName('platform.capability-status'),
      unknown: translateToolName('nonexistent-tool'),
    }));
  `);

  assert.equal(result.cube, '数据查询');
  assert.equal(result.neo4j, '关系分析');
  assert.equal(result.llm, '智能分析');
  assert.equal(result.erp, '业务数据读取');
  assert.equal(result.erpModel, '业务数据读取');
  assert.equal(result.ctxExtract, '上下文提取');
  assert.equal(result.planGen, '计划生成');
  assert.equal(result.platform, '平台能力状态');
  assert.equal(result.unknown, 'nonexistent-tool', '未知工具保持原名');
  assert.ok(result.keys.length >= 8, '翻译表至少覆盖 8 个工具');
});

test('AC3 | translateStepStatus 覆盖新事件种类', async () => {
  const result = await runTsSnippet(`
    ${VM_IMPORTS}
    console.log(JSON.stringify({
      stepStarted: translateStepStatus('step-started'),
      toolStarted: translateStepStatus('tool-started'),
      toolCompleted: translateStepStatus('tool-completed'),
      toolFailed: translateStepStatus('tool-failed'),
      stepCompleted: translateStepStatus('step-completed'),
      legacyExec: translateStepStatus('execution-status'),
      legacyStep: translateStepStatus('step-lifecycle'),
      legacyStage: translateStepStatus('stage-result'),
    }));
  `);

  assert.equal(result.stepStarted, '步骤开始');
  assert.equal(result.toolStarted, '工具调用中');
  assert.equal(result.toolCompleted, '工具完成');
  assert.equal(result.toolFailed, '工具失败');
  assert.equal(result.stepCompleted, '步骤完成');
  assert.equal(result.legacyExec, '执行状态');
  assert.equal(result.legacyStep, '步骤进度');
  assert.equal(result.legacyStage, '阶段结果');
});

// ---------------------------------------------------------------------------
// AC4: formatDurationMs 人话耗时格式化
// ---------------------------------------------------------------------------

test('AC4 | formatDurationMs 毫秒级', async () => {
  const result = await runTsSnippet(`
    ${VM_IMPORTS}
    console.log(JSON.stringify({
      ms: formatDurationMs(500),
      ms2: formatDurationMs(999),
    }));
  `);

  assert.equal(result.ms, '500ms');
  assert.equal(result.ms2, '999ms');
});

test('AC4 | formatDurationMs 秒级', async () => {
  const result = await runTsSnippet(`
    ${VM_IMPORTS}
    console.log(JSON.stringify({
      sec: formatDurationMs(1500),
      sec2: formatDurationMs(12345),
      sec3: formatDurationMs(59999),
    }));
  `);

  assert.equal(result.sec, '1.5秒');
  assert.equal(result.sec2, '12.3秒');
  assert.equal(result.sec3, '60.0秒');
});

test('AC4 | formatDurationMs 分钟级', async () => {
  const result = await runTsSnippet(`
    ${VM_IMPORTS}
    console.log(JSON.stringify({
      min: formatDurationMs(60000),
      min2: formatDurationMs(90500),
    }));
  `);

  assert.equal(result.min, '1分0秒');
  assert.equal(result.min2, '1分31秒');
});

// ---------------------------------------------------------------------------
// AC5: 向后兼容性——既有事件仍然正常工作
// ---------------------------------------------------------------------------

test('AC5 | step-lifecycle + tool-list 事件仍然构建 toolTimeline', async () => {
  const events = [
    buildEvent({
      sequence: 1,
      kind: 'step-lifecycle',
      step: { id: 'step-1', order: 1, title: '查询数据', status: 'running' },
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
  ];
  const result = await runTsSnippet(`
    ${VM_IMPORTS}
    const events = ${JSON.stringify(events)};
    const vm = buildConversationViewModel({
      questionText: '测试', projection: null, events, hasConnectionIssue: false,
    });
    console.log(JSON.stringify({
      count: vm.assistantMessage.toolTimeline.length,
      step: vm.assistantMessage.toolTimeline[0],
    }));
  `);

  assert.equal(result.count, 1);
  assert.equal(result.step.stepId, 'step-1');
  assert.equal(result.step.subSteps.length, 1);
  assert.equal(result.step.subSteps[0].toolName, 'cube.semantic-query');
  assert.equal(result.step.subSteps[0].status, 'completed');
});

test('AC5 | 新旧事件混合时 toolTimeline 正确合并', async () => {
  const events = [
    // Story 12-5 新事件
    buildEvent({
      sequence: 1,
      kind: 'step-started',
      step: { id: 'step-1', order: 1, title: '查询数据', status: 'running' },
    }),
    buildEvent({
      sequence: 2,
      kind: 'tool-started',
      step: { id: 'step-1', order: 1, title: '查询数据', status: 'running' },
      tool: { name: 'cube.semantic-query', label: '数据查询' },
    }),
    buildEvent({
      sequence: 3,
      kind: 'tool-completed',
      step: { id: 'step-1', order: 1, title: '查询数据', status: 'running' },
      tool: {
        name: 'cube.semantic-query',
        label: '数据查询',
        durationMs: 1200,
      },
    }),
    buildEvent({
      sequence: 4,
      kind: 'step-completed',
      step: {
        id: 'step-1',
        order: 1,
        title: '查询数据',
        status: 'completed',
        durationMs: 1500,
        toolCount: 1,
      },
    }),
    // 既有 stage-result 事件（step-2）
    buildEvent({
      sequence: 5,
      kind: 'stage-result',
      step: { id: 'step-2', order: 2, title: '分析原因', status: 'completed' },
      renderBlocks: [
        {
          type: 'tool-list',
          title: '工具',
          items: [
            { toolName: 'llm.structured-analysis', objective: '分析原因', status: 'completed' },
          ],
        },
      ],
    }),
  ];
  const result = await runTsSnippet(`
    ${VM_IMPORTS}
    const events = ${JSON.stringify(events)};
    const vm = buildConversationViewModel({
      questionText: '测试', projection: null, events, hasConnectionIssue: false,
    });
    console.log(JSON.stringify({
      count: vm.assistantMessage.toolTimeline.length,
      steps: vm.assistantMessage.toolTimeline.map(s => ({
        stepId: s.stepId,
        stepName: s.stepName,
        status: s.status,
        duration: s.duration,
        subCount: s.subSteps.length,
      })),
    }));
  `);

  assert.equal(result.count, 2);

  assert.equal(result.steps[0].stepId, 'step-1');
  assert.equal(result.steps[0].status, 'completed');
  assert.equal(result.steps[0].duration, '1.5秒');
  assert.equal(result.steps[0].subCount, 1);

  assert.equal(result.steps[1].stepId, 'step-2');
  assert.equal(result.steps[1].status, 'completed');
  assert.equal(result.steps[1].subCount, 1);
});

// ---------------------------------------------------------------------------
// AC6: 事件可 JSON 序列化（新字段不引入循环引用）
// ---------------------------------------------------------------------------

test('AC6 | 所有新事件构建器输出可 JSON 序列化', async () => {
  const result = await runTsSnippet(`
    ${RENDERER_IMPORTS}
    const events = [
      buildStepStartedEvent({
        sessionId: 's', executionId: 'e',
        step: { id: 'step-1', order: 1, title: 'S1' },
      }),
      buildToolStartedEvent({
        sessionId: 's', executionId: 'e',
        step: { id: 'step-1', order: 1, title: 'S1' },
        tool: { name: 't', label: 'T', input: { k: 'v' } },
      }),
      buildToolCompletedEvent({
        sessionId: 's', executionId: 'e',
        step: { id: 'step-1', order: 1, title: 'S1' },
        tool: { name: 't', label: 'T', output: { r: 1 }, durationMs: 100 },
      }),
      buildToolFailedEvent({
        sessionId: 's', executionId: 'e',
        step: { id: 'step-1', order: 1, title: 'S1' },
        tool: { name: 't', label: 'T', error: 'err', durationMs: 50 },
      }),
      buildStepCompletedEvent({
        sessionId: 's', executionId: 'e',
        step: { id: 'step-1', order: 1, title: 'S1', status: 'completed' },
        durationMs: 200, toolCount: 1,
      }),
    ];
    // Verify JSON round-trip works
    const serialized = JSON.stringify(events);
    const deserialized = JSON.parse(serialized);
    console.log(JSON.stringify({
      count: deserialized.length,
      kinds: deserialized.map(e => e.kind),
    }));
  `);

  assert.equal(result.count, 5);
  assert.deepEqual(result.kinds, [
    'step-started',
    'tool-started',
    'tool-completed',
    'tool-failed',
    'step-completed',
  ]);
});
