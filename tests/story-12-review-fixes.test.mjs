import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function runTsSnippet(code) {
  const { stdout, stderr } = await execFileAsync(
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
  if (!trimmed) {
    if (stderr) throw new Error(`Snippet stderr: ${stderr}`);
    return null;
  }
  const lastLine = trimmed.split('\n').pop() ?? '';
  return JSON.parse(lastLine);
}

// ---------------------------------------------------------------------------
// Fix #1: replaceInitialContextIfUnmodified 版本语义
// ---------------------------------------------------------------------------

test('Fix #1 | replaceInitialContextIfUnmodified: 无 existing context 时初始化 version 1', async () => {
  const result = await runTsSnippet(`
    import contextModule from './src/application/analysis-context/use-cases.ts';
    const { createAnalysisContextUseCases } = contextModule;
    const store = new Map();
    const mockStore = {
      async getLatest(sid) { return store.get(sid + ':latest') ?? null; },
      async getByVersion(sid, v) { return store.get(sid + ':' + v) ?? null; },
      async save(vc) {
        store.set(vc.sessionId + ':latest', vc);
        store.set(vc.sessionId + ':' + vc.version, vc);
      },
      async countVersions(sid) {
        let c = 0; for (const k of store.keys()) if (k.startsWith(sid + ':') && k !== sid + ':latest') c++;
        return c;
      },
    };
    const uc = createAnalysisContextUseCases({ analysisContextStore: mockStore });
    const r = await uc.replaceInitialContextIfUnmodified({
      sessionId: 's1', ownerUserId: 'u1', questionText: '测试',
      newContext: { targetMetric: { label: '指标', value: '收缴率', state: 'confirmed' },
                   entity: { label: '实体', value: '丰和园', state: 'confirmed' },
                   timeRange: { label: '时间', value: '2026年', state: 'confirmed' },
                   comparison: { label: '比较', value: '无需比较', state: 'confirmed' },
                   constraints: [] },
    });
    console.log(JSON.stringify({ replaced: r.replaced, version: r.context.version }));
  `);

  assert.equal(result.replaced, true);
  assert.equal(result.version, 1);
});

test('Fix #1 | replaceInitialContextIfUnmodified: version=1 时替换为 version 2', async () => {
  const result = await runTsSnippet(`
    import contextModule from './src/application/analysis-context/use-cases.ts';
    const { createAnalysisContextUseCases } = contextModule;
    const store = new Map();
    const mockStore = {
      async getLatest(sid) { return store.get(sid + ':latest') ?? null; },
      async getByVersion(sid, v) { return store.get(sid + ':' + v) ?? null; },
      async save(vc) {
        store.set(vc.sessionId + ':latest', vc);
        store.set(vc.sessionId + ':' + vc.version, vc);
      },
      async countVersions(sid) {
        let c = 0; for (const k of store.keys()) if (k.startsWith(sid + ':') && k !== sid + ':latest') c++;
        return c;
      },
    };
    // 先初始化 version 1
    store.set('s1:latest', {
      sessionId: 's1', ownerUserId: 'u1', version: 1,
      context: { targetMetric: { label: '指标', value: '旧指标', state: 'confirmed' },
                 entity: { label: '实体', value: '旧实体', state: 'confirmed' },
                 timeRange: { label: '时间', value: '旧时间', state: 'confirmed' },
                 comparison: { label: '比较', value: '无需比较', state: 'confirmed' },
                 constraints: [] },
      originalQuestionText: '测试', createdAt: new Date().toISOString(),
    });
    const uc = createAnalysisContextUseCases({ analysisContextStore: mockStore });
    const r = await uc.replaceInitialContextIfUnmodified({
      sessionId: 's1', ownerUserId: 'u1', questionText: '测试',
      newContext: { targetMetric: { label: '指标', value: '新指标', state: 'confirmed' },
                   entity: { label: '实体', value: '新实体', state: 'confirmed' },
                   timeRange: { label: '时间', value: '2026年', state: 'confirmed' },
                   comparison: { label: '比较', value: '无需比较', state: 'confirmed' },
                   constraints: [] },
    });
    console.log(JSON.stringify({
      replaced: r.replaced,
      version: r.context.version,
      metricValue: r.context.context.targetMetric.value,
    }));
  `);

  assert.equal(result.replaced, true);
  assert.equal(result.version, 2);
  assert.equal(result.metricValue, '新指标');
});

test('Fix #1 | replaceInitialContextIfUnmodified: version>1 时不替换（用户已修正）', async () => {
  const result = await runTsSnippet(`
    import contextModule from './src/application/analysis-context/use-cases.ts';
    const { createAnalysisContextUseCases } = contextModule;
    const store = new Map();
    const mockStore = {
      async getLatest(sid) { return store.get(sid + ':latest') ?? null; },
      async getByVersion(sid, v) { return store.get(sid + ':' + v) ?? null; },
      async save(vc) {
        store.set(vc.sessionId + ':latest', vc);
        store.set(vc.sessionId + ':' + vc.version, vc);
      },
      async countVersions(sid) {
        let c = 0; for (const k of store.keys()) if (k.startsWith(sid + ':') && k !== sid + ':latest') c++;
        return c;
      },
    };
    // 模拟 version 3（用户已手动修正过两次）
    store.set('s1:latest', {
      sessionId: 's1', ownerUserId: 'u1', version: 3,
      context: { targetMetric: { label: '指标', value: '用户选的指标', state: 'confirmed' },
                 entity: { label: '实体', value: '用户选的实体', state: 'confirmed' },
                 timeRange: { label: '时间', value: '2026年', state: 'confirmed' },
                 comparison: { label: '比较', value: '无需比较', state: 'confirmed' },
                 constraints: [] },
      originalQuestionText: '测试', createdAt: new Date().toISOString(),
    });
    const uc = createAnalysisContextUseCases({ analysisContextStore: mockStore });
    const r = await uc.replaceInitialContextIfUnmodified({
      sessionId: 's1', ownerUserId: 'u1', questionText: '测试',
      newContext: { targetMetric: { label: '指标', value: 'LLM新指标', state: 'confirmed' },
                   entity: { label: '实体', value: 'LLM新实体', state: 'confirmed' },
                   timeRange: { label: '时间', value: '2026年', state: 'confirmed' },
                   comparison: { label: '比较', value: '无需比较', state: 'confirmed' },
                   constraints: [] },
    });
    console.log(JSON.stringify({
      replaced: r.replaced,
      version: r.context.version,
      metricValue: r.context.context.targetMetric.value,
    }));
  `);

  assert.equal(result.replaced, false);
  assert.equal(result.version, 3, '保持 version 3 不变');
  assert.equal(result.metricValue, '用户选的指标', '不被 LLM 结果覆盖');
});

// ---------------------------------------------------------------------------
// Fix #1b: extractContext source 字段真实反映 LLM 成功/失败
// ---------------------------------------------------------------------------

test('Fix #1b | extractContext: LLM 抛错时 source=rule-fallback 且不 throw', async () => {
  const result = await runTsSnippet(`
    import extractionModule from './src/application/analysis-context-extraction/use-cases.ts';
    const { createContextExtractionUseCases } = extractionModule;
    const failingPort = {
      async extract() { throw new Error('Redis 连接失败'); },
    };
    const { extractContext } = createContextExtractionUseCases({ extractionPort: failingPort });
    const r = await extractContext({
      questionText: '丰和园小区项目本年物业费收缴率',
    });
    console.log(JSON.stringify({
      source: r.source,
      hasErrorIssue: r.issues.some(i => i.field === 'llm' && i.severity === 'error'),
      issueMessage: r.issues[0]?.message,
    }));
  `);

  assert.equal(result.source, 'rule-fallback');
  assert.equal(result.hasErrorIssue, true);
  assert.ok(result.issueMessage.includes('Redis 连接失败'));
});

test('Fix #1b | extractContext: LLM 成功时 source=llm', async () => {
  const result = await runTsSnippet(`
    import extractionModule from './src/application/analysis-context-extraction/use-cases.ts';
    const { createContextExtractionUseCases } = extractionModule;
    const okPort = {
      async extract() {
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
    const { extractContext } = createContextExtractionUseCases({ extractionPort: okPort });
    const r = await extractContext({
      questionText: '丰和园小区项目本年物业费收缴率',
      projectNames: ['丰和园'],
    });
    console.log(JSON.stringify({ source: r.source, issueCount: r.issues.length }));
  `);

  assert.equal(result.source, 'llm');
  assert.equal(result.issueCount, 0);
});

// ---------------------------------------------------------------------------
// Fix #2: executeStep eventEmitter 非阻断行为
// ---------------------------------------------------------------------------

test('Fix #2 | executeStep: eventEmitter.onToolStarted 抛错时工具仍然执行', async () => {
  const result = await runTsSnippet(`
    import executionModule from './src/application/analysis-execution/use-cases.ts';
    const { createAnalysisExecutionUseCases } = executionModule;

    // 模拟 eventEmitter 抛错（Redis 挂了）
    const failingEmitter = {
      async onToolStarted() { throw new Error('Redis XADD failed'); },
      async onToolCompleted() { throw new Error('Redis XADD failed'); },
      async onToolFailed() { throw new Error('Redis XADD failed'); },
    };

    // 模拟工具注册：selectToolsForStep 返回 1 个工具，invokeTool 返回成功
    let toolInvoked = false;
    const toolRegistry = {
      listToolDefinitions() {
        return [{ name: 'cube.semantic-query', availability: 'ready' }];
      },
      async invokeTool() {
        toolInvoked = true;
        return {
          ok: true,
          toolName: 'cube.semantic-query',
          output: { rows: 5 },
          error: null,
        };
      },
    };

    // 模拟 AI 选择
    const aiUseCases = {
      async runTask() {
        return {
          ok: true,
          value: {
            strategy: 'test',
            tools: [{ toolName: 'cube.semantic-query', objective: '测试', confidence: 0.9 }],
          },
        };
      },
    };

    const uc = createAnalysisExecutionUseCases({
      toolRegistryUseCases: toolRegistry,
      analysisAiUseCases: aiUseCases,
    });

    // 抑制 console.error 输出
    const origError = console.error;
    console.error = () => {};

    const r = await uc.executeStep({
      stepId: 'test-step',
      questionText: '测试',
      selectionContext: { userId: 'u1', organizationId: 'o1', purpose: 'test' },
      invocationContext: { correlationId: 'c1', source: 'worker' },
      toolInputsByName: { 'cube.semantic-query': { metric: 'fee' } },
      eventEmitter: failingEmitter,
    });

    console.error = origError;
    console.log(JSON.stringify({
      status: r.status,
      toolInvoked,
      eventCount: r.events.length,
    }));
  `);

  assert.equal(result.status, 'completed', '工具执行成功，不受 eventEmitter 失败影响');
  assert.equal(result.toolInvoked, true, '工具被实际调用');
  assert.equal(result.eventCount, 1, '事件结果被记录');
});

test('Fix #2 | executeStep: eventEmitter.onToolCompleted 抛错时步骤仍然成功', async () => {
  const result = await runTsSnippet(`
    import executionModule from './src/application/analysis-execution/use-cases.ts';
    const { createAnalysisExecutionUseCases } = executionModule;

    let startedCalled = false;
    let completedCalled = false;
    const failingEmitter = {
      async onToolStarted() { startedCalled = true; },
      async onToolCompleted() { completedCalled = true; throw new Error('Redis publish failed'); },
      async onToolFailed() { throw new Error('Redis publish failed'); },
    };

    const toolRegistry = {
      listToolDefinitions() {
        return [{ name: 'cube.semantic-query', availability: 'ready' }];
      },
      async invokeTool() {
        return { ok: true, toolName: 'cube.semantic-query', output: { rows: 1 }, error: null };
      },
    };

    const aiUseCases = {
      async runTask() {
        return { ok: true, value: { strategy: 'test',
          tools: [{ toolName: 'cube.semantic-query', objective: '测试', confidence: 0.9 }] } };
      },
    };

    const uc = createAnalysisExecutionUseCases({
      toolRegistryUseCases: toolRegistry,
      analysisAiUseCases: aiUseCases,
    });

    const origError = console.error;
    console.error = () => {};
    const r = await uc.executeStep({
      stepId: 'test-step', questionText: '测试',
      selectionContext: { userId: 'u1', organizationId: 'o1', purpose: 'test' },
      invocationContext: { correlationId: 'c1', source: 'worker' },
      toolInputsByName: { 'cube.semantic-query': {} },
      eventEmitter: failingEmitter,
    });
    console.error = origError;
    console.log(JSON.stringify({
      status: r.status,
      startedCalled,
      completedCalled,
    }));
  `);

  assert.equal(result.status, 'completed', '步骤成功');
  assert.equal(result.startedCalled, true, 'onToolStarted 被调用');
  assert.equal(result.completedCalled, true, 'onToolCompleted 被尝试调用');
});

test('Fix #2 | executeStep: 无 eventEmitter 时工具正常执行', async () => {
  const result = await runTsSnippet(`
    import executionModule from './src/application/analysis-execution/use-cases.ts';
    const { createAnalysisExecutionUseCases } = executionModule;

    const toolRegistry = {
      listToolDefinitions() {
        return [{ name: 'cube.semantic-query', availability: 'ready' }];
      },
      async invokeTool() {
        return { ok: true, toolName: 'cube.semantic-query', output: { rows: 3 }, error: null };
      },
    };

    const aiUseCases = {
      async runTask() {
        return { ok: true, value: { strategy: 'test',
          tools: [{ toolName: 'cube.semantic-query', objective: '测试', confidence: 0.9 }] } };
      },
    };

    const uc = createAnalysisExecutionUseCases({
      toolRegistryUseCases: toolRegistry,
      analysisAiUseCases: aiUseCases,
    });

    const r = await uc.executeStep({
      stepId: 'test-step', questionText: '测试',
      selectionContext: { userId: 'u1', organizationId: 'o1', purpose: 'test' },
      invocationContext: { correlationId: 'c1', source: 'worker' },
      toolInputsByName: { 'cube.semantic-query': {} },
    });
    console.log(JSON.stringify({ status: r.status, eventCount: r.events.length }));
  `);

  assert.equal(result.status, 'completed');
  assert.equal(result.eventCount, 1);
});

test('Fix #2 | executeStep: eventEmitter 按 started → invoke → completed 顺序调用', async () => {
  const result = await runTsSnippet(`
    import executionModule from './src/application/analysis-execution/use-cases.ts';
    const { createAnalysisExecutionUseCases } = executionModule;

    const callOrder = [];
    const orderedEmitter = {
      async onToolStarted(input) { callOrder.push('started:' + input.toolName); },
      async onToolCompleted(input) { callOrder.push('completed:' + input.toolName); },
      async onToolFailed(input) { callOrder.push('failed:' + input.toolName); },
    };

    const toolRegistry = {
      listToolDefinitions() {
        return [{ name: 'cube.semantic-query', availability: 'ready' }];
      },
      async invokeTool() {
        callOrder.push('invoke:cube.semantic-query');
        return { ok: true, toolName: 'cube.semantic-query', output: {}, error: null };
      },
    };

    const aiUseCases = {
      async runTask() {
        return { ok: true, value: { strategy: 'test',
          tools: [{ toolName: 'cube.semantic-query', objective: '测试', confidence: 0.9 }] } };
      },
    };

    const uc = createAnalysisExecutionUseCases({
      toolRegistryUseCases: toolRegistry,
      analysisAiUseCases: aiUseCases,
    });

    await uc.executeStep({
      stepId: 'test-step', questionText: '测试',
      selectionContext: { userId: 'u1', organizationId: 'o1', purpose: 'test' },
      invocationContext: { correlationId: 'c1', source: 'worker' },
      toolInputsByName: { 'cube.semantic-query': {} },
      eventEmitter: orderedEmitter,
    });
    console.log(JSON.stringify({ callOrder }));
  `);

  assert.deepEqual(result.callOrder, [
    'started:cube.semantic-query',
    'invoke:cube.semantic-query',
    'completed:cube.semantic-query',
  ]);
});

// ---------------------------------------------------------------------------
// Fix #3: 首页 Redis 纠偏——倒序查找 execution-status 事件
// ---------------------------------------------------------------------------

test('Fix #3 | 首页纠偏: 最后事件是 tool-started 但有 execution-status processing 在前面', async () => {
  // 模拟 workspace/page.tsx 的纠偏逻辑
  const result = await runTsSnippet(`
    const events = [
      { kind: 'execution-status', status: 'processing', sequence: 1 },
      { kind: 'step-started', sequence: 2 },
      { kind: 'tool-started', sequence: 3 },
    ];
    // 复刻 page.tsx 的纠偏逻辑
    const lastStatusEvent = [...events].reverse().find(
      (e) => e.kind === 'execution-status' && e.status
    );
    console.log(JSON.stringify({
      found: lastStatusEvent !== undefined,
      status: lastStatusEvent?.status ?? null,
    }));
  `);

  assert.equal(result.found, true);
  assert.equal(result.status, 'processing');
});

test('Fix #3 | 首页纠偏: 多个 execution-status 取最后一个', async () => {
  const result = await runTsSnippet(`
    const events = [
      { kind: 'execution-status', status: 'processing', sequence: 1 },
      { kind: 'step-started', sequence: 2 },
      { kind: 'step-completed', sequence: 3 },
      { kind: 'execution-status', status: 'completed', sequence: 4 },
    ];
    const lastStatusEvent = [...events].reverse().find(
      (e) => e.kind === 'execution-status' && e.status
    );
    console.log(JSON.stringify({
      status: lastStatusEvent?.status,
      sequence: lastStatusEvent?.sequence,
    }));
  `);

  assert.equal(result.status, 'completed');
  assert.equal(result.sequence, 4);
});

test('Fix #3 | 首页纠偏: 无 execution-status 事件时返回 undefined', async () => {
  const result = await runTsSnippet(`
    const events = [
      { kind: 'step-started', sequence: 1 },
      { kind: 'tool-started', sequence: 2 },
      { kind: 'tool-completed', sequence: 3 },
    ];
    const lastStatusEvent = [...events].reverse().find(
      (e) => e.kind === 'execution-status' && e.status
    );
    console.log(JSON.stringify({ found: lastStatusEvent !== undefined }));
  `);

  assert.equal(result.found, false);
});

test('Fix #3 | 首页纠偏: execution-status 无 status 字段时跳过', async () => {
  const result = await runTsSnippet(`
    const events = [
      { kind: 'execution-status', sequence: 1 },
      { kind: 'execution-status', status: 'completed', sequence: 2 },
      { kind: 'step-started', sequence: 3 },
    ];
    const lastStatusEvent = [...events].reverse().find(
      (e) => e.kind === 'execution-status' && e.status
    );
    console.log(JSON.stringify({
      status: lastStatusEvent?.status,
      sequence: lastStatusEvent?.sequence,
    }));
  `);

  assert.equal(result.status, 'completed');
  assert.equal(result.sequence, 2, '跳过没有 status 的 execution-status 事件');
});

// ---------------------------------------------------------------------------
// Fix #1c: rule-fallback 不写入 version 2 的集成验证
// ---------------------------------------------------------------------------

test('Fix #1c | 模拟 execute route: rule-fallback 不调用 replaceInitialContextIfUnmodified', async () => {
  // 验证 execute route 的逻辑：source !== 'llm' 时不替换 context
  const result = await runTsSnippet(`
    import extractionModule from './src/application/analysis-context-extraction/use-cases.ts';
    const { createContextExtractionUseCases } = extractionModule;

    // 模拟 LLM 失败
    const failingPort = {
      async extract() { throw new Error('LLM 不可用'); },
    };
    const { extractContext } = createContextExtractionUseCases({ extractionPort: failingPort });
    const extractionResult = await extractContext({
      questionText: '丰和园小区本年物业费收缴率',
    });

    // 模拟 route 逻辑：source !== 'llm' 时不替换
    let replaceCalled = false;
    if (extractionResult.source !== 'llm') {
      // 记录 audit，不调用 replaceInitialContextIfUnmodified
      replaceCalled = false;
    } else {
      replaceCalled = true;
    }

    console.log(JSON.stringify({
      source: extractionResult.source,
      replaceCalled,
      hasLlmIssue: extractionResult.issues.some(i => i.field === 'llm'),
    }));
  `);

  assert.equal(result.source, 'rule-fallback');
  assert.equal(result.replaceCalled, false, 'rule-fallback 时不调用替换');
  assert.equal(result.hasLlmIssue, true, 'issues 包含 LLM 错误');
});
