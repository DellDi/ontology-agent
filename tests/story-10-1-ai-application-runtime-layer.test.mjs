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

function t(offsetSeconds) {
  const base = new Date('2026-04-21T07:00:00.000Z').getTime();
  return new Date(base + offsetSeconds * 1000).toISOString();
}

function buildFixtureEvents() {
  return [
    {
      id: 'evt-1',
      sessionId: 'session-1',
      executionId: 'exec-1',
      sequence: 1,
      kind: 'execution-status',
      timestamp: t(0),
      status: 'processing',
      message: '执行已启动',
      renderBlocks: [
        {
          type: 'status',
          title: '执行状态',
          value: '执行中',
          tone: 'info',
        },
      ],
    },
    {
      id: 'evt-2',
      sessionId: 'session-1',
      executionId: 'exec-1',
      sequence: 2,
      kind: 'step-lifecycle',
      timestamp: t(1),
      step: {
        id: 'step-context',
        order: 1,
        title: '上下文提取',
        status: 'running',
      },
      renderBlocks: [],
    },
    {
      id: 'evt-3',
      sessionId: 'session-1',
      executionId: 'exec-1',
      sequence: 3,
      kind: 'stage-result',
      timestamp: t(2),
      stage: {
        key: 'context',
        label: '上下文提取',
        status: 'completed',
      },
      step: {
        id: 'step-context',
        order: 1,
        title: '上下文提取',
        status: 'completed',
      },
      renderBlocks: [
        {
          type: 'markdown',
          title: '上下文摘要',
          content: '销售额同比下降 12%，主因需进一步分析。',
        },
      ],
    },
    {
      id: 'evt-4',
      sessionId: 'session-1',
      executionId: 'exec-1',
      sequence: 4,
      kind: 'stage-result',
      timestamp: t(3),
      stage: {
        key: 'conclusion',
        label: '归因汇总',
        status: 'completed',
      },
      step: {
        id: 'step-conclusion',
        order: 2,
        title: '归因汇总',
        status: 'completed',
      },
      renderBlocks: [
        {
          type: 'markdown',
          title: '原因 1: 需求下滑',
          content: '主要市场需求明显减少。',
        },
      ],
      metadata: {
        conclusionCauses: [
          {
            id: 'cause-1',
            rank: 1,
            title: '需求下滑',
            summary: '主要市场需求明显减少。',
            confidence: 0.72,
            evidence: [],
          },
        ],
      },
    },
    {
      id: 'evt-5',
      sessionId: 'session-1',
      executionId: 'exec-1',
      sequence: 5,
      kind: 'execution-status',
      timestamp: t(4),
      status: 'completed',
      message: '执行完成',
      renderBlocks: [
        {
          type: 'status',
          title: '执行状态',
          value: '已完成',
          tone: 'success',
        },
      ],
    },
  ];
}

const MAPPER_IMPORT = `
  import contractModule from './src/application/ai-runtime/runtime-contract.ts';
  import mapperModule from './src/application/ai-runtime/runtime-projection-mapper.ts';
  import bridgeModule from './src/application/ai-runtime/tool-runtime-bridge.ts';
  import adapterModule from './src/infrastructure/ai-runtime/vercel-ai-sdk-adapter.ts';
  const { AI_RUNTIME_PART_KINDS } = contractModule;
  const { buildAiRuntimeProjection, mergeAnalysisExecutionStreamEvents } = mapperModule;
  const { createEmptyAiRuntimeToolBridge, createAiRuntimeToolBridgeFromRegistry } = bridgeModule;
  const { projectionToUIMessages } = adapterModule;
`;

test('runtime mapper 把 execution events 映射为稳定顺序的 assistant message parts', async () => {
  const events = buildFixtureEvents();
  const result = await runTsSnippet(`
    ${MAPPER_IMPORT}
    const events = ${JSON.stringify(events)};
    const projection = buildAiRuntimeProjection({
      sessionId: 'session-1',
      executionId: 'exec-1',
      events,
    });
    const [message] = projection.messages;
    const partKinds = message.parts.map((part) => part.kind);
    const statusBanner = message.parts.find((part) => part.kind === 'status-banner');
    const stepTimeline = message.parts.find((part) => part.kind === 'step-timeline');
    const resumeAnchor = message.parts.find((part) => part.kind === 'resume-anchor');
    const conclusionCard = message.parts.find((part) => part.kind === 'conclusion-card');
    const evidenceCount = message.parts.filter((part) => part.kind === 'evidence-card').length;
    console.log(JSON.stringify({
      sessionId: projection.sessionId,
      executionId: projection.executionId,
      status: projection.status,
      lastSequence: projection.lastSequence,
      isTerminal: projection.isTerminal,
      messageCount: projection.messages.length,
      messageId: message.id,
      role: message.role,
      partKinds,
      statusBanner,
      stepCount: stepTimeline.steps.length,
      currentStageKey: stepTimeline.currentStage?.key ?? null,
      evidenceCount,
      conclusionCauseCount: conclusionCard?.readModel.causes.length ?? 0,
      resumeAnchor,
    }));
  `);

  assert.equal(result.sessionId, 'session-1');
  assert.equal(result.executionId, 'exec-1');
  assert.equal(result.status, 'completed');
  assert.equal(result.lastSequence, 5);
  assert.equal(result.isTerminal, true);
  assert.equal(result.messageCount, 1);
  assert.equal(result.role, 'assistant');

  // 稳定 part 顺序：banner -> timeline -> evidence* -> conclusion -> resume
  assert.equal(result.partKinds[0], 'status-banner');
  assert.equal(result.partKinds[1], 'step-timeline');
  assert.equal(result.partKinds[result.partKinds.length - 1], 'resume-anchor');
  const conclusionIndex = result.partKinds.indexOf('conclusion-card');
  assert.ok(conclusionIndex > 1);
  assert.ok(result.partKinds.lastIndexOf('evidence-card') < conclusionIndex);

  // 语义正确
  assert.equal(result.statusBanner.status, 'completed');
  assert.equal(result.statusBanner.tone, 'success');
  assert.equal(result.stepCount, 2);
  assert.equal(result.currentStageKey, 'conclusion');
  assert.ok(result.evidenceCount >= 2);
  assert.ok(result.conclusionCauseCount >= 1);
  assert.equal(result.resumeAnchor.isTerminal, true);
  assert.equal(result.resumeAnchor.lastSequence, 5);
});

test('mergeAnalysisExecutionStreamEvents 是幂等的并保持 sequence 单调', async () => {
  const [first, second] = buildFixtureEvents();
  const result = await runTsSnippet(`
    ${MAPPER_IMPORT}
    const a = ${JSON.stringify(first)};
    const b = ${JSON.stringify(second)};
    const foreign = { ...b, sessionId: 'other', executionId: 'other' };
    let events = [];
    events = mergeAnalysisExecutionStreamEvents(events, b);
    events = mergeAnalysisExecutionStreamEvents(events, a);
    events = mergeAnalysisExecutionStreamEvents(events, a); // idempotent
    events = mergeAnalysisExecutionStreamEvents(events, foreign, {
      sessionId: 'session-1',
      executionId: 'exec-1',
    });
    console.log(JSON.stringify({
      sequences: events.map((e) => e.sequence),
      ids: events.map((e) => e.id),
    }));
  `);

  assert.deepEqual(result.sequences, [1, 2]);
  assert.deepEqual(result.ids, ['evt-1', 'evt-2']);
});

test('刷新场景下从已有 snapshot 重建 projection 不写回 canonical truth', async () => {
  const events = buildFixtureEvents();
  const result = await runTsSnippet(`
    ${MAPPER_IMPORT}
    const events = ${JSON.stringify(events)};
    const originalSignature = JSON.stringify(events);

    const first = buildAiRuntimeProjection({
      sessionId: 'session-1',
      executionId: 'exec-1',
      events,
    });
    const second = buildAiRuntimeProjection({
      sessionId: 'session-1',
      executionId: 'exec-1',
      events,
    });

    const afterSignature = JSON.stringify(events);
    console.log(JSON.stringify({
      bytewiseEqual: originalSignature === afterSignature,
      projectionsEqual: JSON.stringify(first) === JSON.stringify(second),
      firstStatus: first.status,
      firstIsTerminal: first.isTerminal,
      firstLastSequence: first.lastSequence,
    }));
  `);

  assert.equal(result.bytewiseEqual, true, 'projection 必须只读：不得改写 canonical events');
  assert.equal(result.projectionsEqual, true, '相同输入必须产出相同 projection');
  assert.equal(result.firstStatus, 'completed');
  assert.equal(result.firstIsTerminal, true);
  assert.equal(result.firstLastSequence, 5);
});

test('fallbackConclusion 仅在事件自身无结论时生效，已有结论时不会被反向覆盖', async () => {
  const events = buildFixtureEvents();
  const result = await runTsSnippet(`
    ${MAPPER_IMPORT}
    const events = ${JSON.stringify(events)};
    const fallback = {
      causes: [
        {
          id: 'fallback-cause',
          rank: 1,
          title: 'FALLBACK',
          summary: 'from persisted snapshot',
          confidence: 0.5,
          evidence: [],
        },
      ],
      renderBlocks: [],
    };
    const onlyStart = events.slice(0, 2);
    const withStartOnly = buildAiRuntimeProjection({
      sessionId: 'session-1',
      executionId: 'exec-1',
      events: onlyStart,
      fallbackConclusion: fallback,
    });
    const withFull = buildAiRuntimeProjection({
      sessionId: 'session-1',
      executionId: 'exec-1',
      events,
      fallbackConclusion: fallback,
    });
    const conclusionFromFallback = withStartOnly.messages[0].parts.find(
      (p) => p.kind === 'conclusion-card',
    );
    const conclusionFromFacts = withFull.messages[0].parts.find(
      (p) => p.kind === 'conclusion-card',
    );
    console.log(JSON.stringify({
      fallbackTitle: conclusionFromFallback?.readModel.causes[0]?.title ?? null,
      derivedTitle: conclusionFromFacts?.readModel.causes[0]?.title ?? null,
    }));
  `);

  assert.equal(result.fallbackTitle, 'FALLBACK');
  assert.notEqual(result.derivedTitle, 'FALLBACK');
  assert.ok(result.derivedTitle);
});

test('Vercel AI SDK adapter 把 runtime projection 映射为 SDK 兼容 UIMessage', async () => {
  const events = buildFixtureEvents();
  const result = await runTsSnippet(`
    ${MAPPER_IMPORT}
    const events = ${JSON.stringify(events)};
    const projection = buildAiRuntimeProjection({
      sessionId: 'session-1',
      executionId: 'exec-1',
      events,
    });
    const uiMessages = projectionToUIMessages(projection);
    const [msg] = uiMessages;
    console.log(JSON.stringify({
      count: uiMessages.length,
      id: msg.id,
      role: msg.role,
      metadata: msg.metadata,
      partTypes: msg.parts.map((p) => p.type),
      firstPartHasData: Boolean(msg.parts[0]?.data),
    }));
  `);

  assert.equal(result.count, 1);
  assert.equal(result.role, 'assistant');
  assert.equal(result.metadata.sessionId, 'session-1');
  assert.equal(result.metadata.executionId, 'exec-1');
  assert.equal(result.metadata.isTerminal, true);
  assert.equal(result.firstPartHasData, true);
  // 所有 part 的 type 必须走 data-* 命名空间（SDK contract）
  for (const type of result.partTypes) {
    assert.ok(
      type.startsWith('data-'),
      `expected data-* part type, got ${type}`,
    );
  }
  assert.equal(result.partTypes[0], 'data-status-banner');
  assert.equal(result.partTypes[result.partTypes.length - 1], 'data-resume-anchor');
});

test('execution 切换时 resolveLiveShellCanonicalEvents 必须重置 canonical events，避免旧 execution 的事实污染 projection', async () => {
  const eventsForA = buildFixtureEvents();
  const eventsForB = buildFixtureEvents().map((event) => ({
    ...event,
    id: event.id.replace('evt-', 'b-evt-'),
    sessionId: 'session-1',
    executionId: 'exec-2',
    // B 只有首个 status 事件，用来模拟"新 execution 刚进入流式状态"。
  })).slice(0, 1);

  const result = await runTsSnippet(`
    ${MAPPER_IMPORT}
    const eventsA = ${JSON.stringify(eventsForA)};
    const eventsB_initial = ${JSON.stringify(eventsForB)};

    // --- 场景 1：同一 execution 的后续 render，不得重置 ---
    const sameExec = mapperModule.resolveLiveShellCanonicalEvents({
      sessionId: 'session-1',
      executionId: 'exec-1',
      previousTrackingKey: 'session-1::exec-1',
      previousEvents: eventsA,
      initialEventsForCurrentExecution: eventsA,
    });

    // --- 场景 2：切换到历史/其他 execution，必须重置 ---
    const switched = mapperModule.resolveLiveShellCanonicalEvents({
      sessionId: 'session-1',
      executionId: 'exec-2',
      previousTrackingKey: 'session-1::exec-1',
      previousEvents: eventsA,
      initialEventsForCurrentExecution: eventsB_initial,
    });

    // --- 场景 3：切换 session，也必须重置 ---
    const switchedSession = mapperModule.resolveLiveShellCanonicalEvents({
      sessionId: 'session-2',
      executionId: 'exec-1',
      previousTrackingKey: 'session-1::exec-1',
      previousEvents: eventsA,
      initialEventsForCurrentExecution: [],
    });

    // --- 场景 4：切换后构建 projection，必须严格反映新 execution 的事实 ---
    const projectionAfterSwitch = buildAiRuntimeProjection({
      sessionId: 'session-1',
      executionId: 'exec-2',
      events: switched.events,
    });

    // 对比"错误路径"：若切换时未重置 events，projection 会混入 A 的事实
    const projectionIfBugRegressed = buildAiRuntimeProjection({
      sessionId: 'session-1',
      executionId: 'exec-2',
      events: eventsA, // 故意传入 A 的 events 模拟 bug
    });

    const stepTimelineAfterSwitch = projectionAfterSwitch.messages[0].parts.find(
      (part) => part.kind === 'step-timeline',
    );
    const stepTimelineIfBug = projectionIfBugRegressed.messages[0].parts.find(
      (part) => part.kind === 'step-timeline',
    );
    const resumeAnchorAfterSwitch = projectionAfterSwitch.messages[0].parts.find(
      (part) => part.kind === 'resume-anchor',
    );

    console.log(JSON.stringify({
      sameExec: {
        didReset: sameExec.didReset,
        eventIds: sameExec.events.map((e) => e.id),
      },
      switched: {
        didReset: switched.didReset,
        trackingKey: switched.trackingKey,
        eventIds: switched.events.map((e) => e.id),
      },
      switchedSession: {
        didReset: switchedSession.didReset,
        trackingKey: switchedSession.trackingKey,
        eventCount: switchedSession.events.length,
      },
      projectionAfterSwitch: {
        executionId: projectionAfterSwitch.executionId,
        status: projectionAfterSwitch.status,
        lastSequence: projectionAfterSwitch.lastSequence,
        stepIds: stepTimelineAfterSwitch.steps.map((s) => s.id),
        resumeExecutionId: resumeAnchorAfterSwitch.executionId,
      },
      projectionIfBugRegressed: {
        // 这里只用于对比：假设 bug 回潮，stepIds 会是 A 的 step-context / step-conclusion
        stepIds: stepTimelineIfBug.steps.map((s) => s.id),
      },
    }));
  `);

  // 场景 1：不触发重置
  assert.equal(result.sameExec.didReset, false);
  assert.deepEqual(
    result.sameExec.eventIds,
    ['evt-1', 'evt-2', 'evt-3', 'evt-4', 'evt-5'],
  );

  // 场景 2：切换 executionId，必须重置为 B 的 initial events
  assert.equal(result.switched.didReset, true);
  assert.equal(result.switched.trackingKey, 'session-1::exec-2');
  assert.deepEqual(result.switched.eventIds, ['b-evt-1']);

  // 场景 3：切换 sessionId 同样必须重置
  assert.equal(result.switchedSession.didReset, true);
  assert.equal(result.switchedSession.trackingKey, 'session-2::exec-1');
  assert.equal(result.switchedSession.eventCount, 0);

  // 场景 4：切换后 projection 只反映新 execution 事实
  assert.equal(result.projectionAfterSwitch.executionId, 'exec-2');
  assert.equal(result.projectionAfterSwitch.status, 'processing');
  assert.equal(result.projectionAfterSwitch.lastSequence, 1);
  assert.equal(result.projectionAfterSwitch.resumeExecutionId, 'exec-2');
  // 新 execution 的 initial events 中只有 execution-status（无 step），timeline 必须为空
  assert.deepEqual(result.projectionAfterSwitch.stepIds, []);

  // 反向守护：若 bug 回潮（events 未重置），timeline 会出现 A 的 steps；该断言记录"坏路径"特征供 regression 对比
  assert.deepEqual(
    result.projectionIfBugRegressed.stepIds.sort(),
    ['step-context', 'step-conclusion'].sort(),
    '如该断言失败，说明 bug 假设已不再成立，请重新评估切换场景的对比路径',
  );
});

test('tool runtime bridge 默认空实现，不提前变成新的治理系统', async () => {
  const result = await runTsSnippet(`
    ${MAPPER_IMPORT}
    const bridge = createEmptyAiRuntimeToolBridge();
    const first = bridge.listTools();
    const second = bridge.listTools();
    console.log(JSON.stringify({
      partKinds: AI_RUNTIME_PART_KINDS,
      toolCount: first.length,
      stableRef: first === second,
    }));
  `);

  assert.deepEqual(result.partKinds, [
    'status-banner',
    'step-timeline',
    'evidence-card',
    'conclusion-card',
    'resume-anchor',
  ]);
  assert.equal(result.toolCount, 0);
  assert.equal(result.stableRef, true);
});

test('tool runtime bridge 可以从既有 tool registry 暴露运行时工具描述', async () => {
  const result = await runTsSnippet(`
    ${MAPPER_IMPORT}
    const definitions = [
      {
        name: 'cube.semantic-query',
        title: 'Cube 语义查询',
        description: '读取治理化指标',
        runtime: 'worker',
        availability: 'ready',
        inputSchemaLabel: 'cubeInput',
        outputSchemaLabel: 'cubeOutput',
      },
      {
        name: 'neo4j.graph-query',
        title: 'Neo4j 图谱查询',
        description: '读取图谱候选因素',
        runtime: 'worker',
        availability: 'degraded',
        availabilityReason: 'Neo4j 未配置',
        inputSchemaLabel: 'neo4jInput',
        outputSchemaLabel: 'neo4jOutput',
      },
    ];
    const bridge = createAiRuntimeToolBridgeFromRegistry({
      listToolDefinitions: () => definitions,
    });
    console.log(JSON.stringify(bridge.listTools()));
  `);

  assert.deepEqual(result, [
    {
      toolName: 'cube.semantic-query',
      displayName: 'Cube 语义查询',
      description: '读取治理化指标',
      status: 'available',
      requiresApproval: false,
    },
    {
      toolName: 'neo4j.graph-query',
      displayName: 'Neo4j 图谱查询',
      description: '读取图谱候选因素',
      status: 'unavailable',
      unavailableReason: 'Neo4j 未配置',
      requiresApproval: false,
    },
  ]);
});
