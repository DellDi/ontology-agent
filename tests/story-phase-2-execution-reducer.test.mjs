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
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--conditions=react-server'].filter(Boolean).join(' '),
      },
    },
  );
  return JSON.parse(stdout.trim().split('\n').pop());
}

test('Phase 2b | 5 个事件应归并为 1 张步骤卡片', async () => {
  const result = await runTsSnippet(`
    import m from './src/application/analysis-execution/execution-event-reducer.ts';
    const { reduceEventsToStepCards } = m;

    const events = [
      { id: 'e1', sessionId: 's', executionId: 'x', sequence: 1, kind: 'step-started', timestamp: '2026-01-01T00:00:00Z', step: { id: 'step-1', title: '确认分析口径' } },
      { id: 'e2', sessionId: 's', executionId: 'x', sequence: 2, kind: 'step-lifecycle', status: 'running', timestamp: '2026-01-01T00:00:01Z', step: { id: 'step-1', title: '确认分析口径' } },
      { id: 'e3', sessionId: 's', executionId: 'x', sequence: 3, kind: 'tool-started', timestamp: '2026-01-01T00:00:02Z', step: { id: 'step-1' } },
      { id: 'e4', sessionId: 's', executionId: 'x', sequence: 4, kind: 'tool-completed', timestamp: '2026-01-01T00:00:03Z', step: { id: 'step-1' } },
      { id: 'e5', sessionId: 's', executionId: 'x', sequence: 5, kind: 'step-completed', status: 'completed', timestamp: '2026-01-01T00:00:04Z', step: { id: 'step-1', title: '确认分析口径', status: 'completed' } },
    ];

    const cards = reduceEventsToStepCards(events);
    console.log(JSON.stringify({
      cardCount: cards.length,
      firstCard: cards[0],
    }));
  `);
  assert.equal(result.cardCount, 1, '5 个事件应归并为 1 张卡片');
  assert.equal(result.firstCard.status, 'completed');
  assert.equal(result.firstCard.stepLabel, '确认分析口径');
});

test('Phase 2b | 不同 step.id 应产生独立卡片', async () => {
  const result = await runTsSnippet(`
    import m from './src/application/analysis-execution/execution-event-reducer.ts';
    const { reduceEventsToStepCards } = m;

    const events = [
      { id: 'e1', sessionId: 's', executionId: 'x', sequence: 1, kind: 'step-started', timestamp: '2026-01-01T00:00:00Z', step: { id: 'step-1', title: '步骤一' } },
      { id: 'e2', sessionId: 's', executionId: 'x', sequence: 2, kind: 'step-started', timestamp: '2026-01-01T00:00:01Z', step: { id: 'step-2', title: '步骤二' } },
    ];

    const cards = reduceEventsToStepCards(events);
    console.log(JSON.stringify({ cardCount: cards.length }));
  `);
  assert.equal(result.cardCount, 2, '不同 step.id 应产生 2 张卡片');
});

test('Phase 2b | failed 状态应优先于 completed', async () => {
  const result = await runTsSnippet(`
    import m from './src/application/analysis-execution/execution-event-reducer.ts';
    const { reduceEventsToStepCards } = m;

    const events = [
      { id: 'e1', sessionId: 's', executionId: 'x', sequence: 1, kind: 'step-started', timestamp: '2026-01-01T00:00:00Z', step: { id: 'step-1', title: '步骤' } },
      { id: 'e2', sessionId: 's', executionId: 'x', sequence: 2, kind: 'step-completed', status: 'completed', timestamp: '2026-01-01T00:00:01Z', step: { id: 'step-1', status: 'completed' } },
      { id: 'e3', sessionId: 's', executionId: 'x', sequence: 3, kind: 'tool-failed', status: 'failed', timestamp: '2026-01-01T00:00:02Z', step: { id: 'step-1', status: 'failed' } },
    ];

    const cards = reduceEventsToStepCards(events);
    console.log(JSON.stringify({ status: cards[0]?.status }));
  `);
  assert.equal(result.status, 'failed', 'failed 应优先于 completed');
});

test('Phase 2b | kind=step-completed + status=failed 应显示失败', async () => {
  const result = await runTsSnippet(`
    import m from './src/application/analysis-execution/execution-event-reducer.ts';
    const { reduceEventsToStepCards } = m;

    const events = [
      { id: 'e1', sessionId: 's', executionId: 'x', sequence: 1, kind: 'step-started', timestamp: '2026-01-01T00:00:00Z', step: { id: 'step-1', title: '步骤' } },
      { id: 'e2', sessionId: 's', executionId: 'x', sequence: 2, kind: 'step-completed', status: 'failed', timestamp: '2026-01-01T00:00:01Z', step: { id: 'step-1', status: 'failed' } },
    ];

    const cards = reduceEventsToStepCards(events);
    console.log(JSON.stringify({ status: cards[0]?.status }));
  `);
  assert.equal(result.status, 'failed', 'kind=step-completed + status=failed 应显示 failed');
});

test('Phase 2b | 无 step 的事件应被跳过', async () => {
  const result = await runTsSnippet(`
    import m from './src/application/analysis-execution/execution-event-reducer.ts';
    const { reduceEventsToStepCards } = m;

    const events = [
      { id: 'e1', sessionId: 's', executionId: 'x', sequence: 1, kind: 'execution-status', status: 'running', timestamp: '2026-01-01T00:00:00Z' },
    ];

    const cards = reduceEventsToStepCards(events);
    console.log(JSON.stringify({ cardCount: cards.length }));
  `);
  assert.equal(result.cardCount, 0, '无 step 的事件应被跳过');
});

test('P1-Finding-4 | execution completed 后，running step 应收敛为 completed', async () => {
  const result = await runTsSnippet(`
    import m from './src/application/analysis-execution/execution-event-reducer.ts';
    const { reduceEventsToStepCards } = m;

    const events = [
      { id: 'e1', sessionId: 's', executionId: 'x', sequence: 1, kind: 'step-started', timestamp: '2026-01-01T00:00:00Z', step: { id: 'step-1', title: '数据拉取' } },
      { id: 'e2', sessionId: 's', executionId: 'x', sequence: 2, kind: 'step-started', timestamp: '2026-01-01T00:00:01Z', step: { id: 'step-2', title: '指标计算' } },
      { id: 'e3', sessionId: 's', executionId: 'x', sequence: 3, kind: 'step-completed', status: 'completed', timestamp: '2026-01-01T00:00:02Z', step: { id: 'step-1', status: 'completed' } },
      // step-2 没有收到 step-completed 事件，但 execution 整体已完成
      { id: 'e4', sessionId: 's', executionId: 'x', sequence: 4, kind: 'execution-status', status: 'completed', timestamp: '2026-01-01T00:00:03Z' },
    ];

    const cards = reduceEventsToStepCards({ events, executionStatus: 'completed' });
    const step1 = cards.find(c => c.stepId === 'step-1');
    const step2 = cards.find(c => c.stepId === 'step-2');
    console.log(JSON.stringify({
      cardCount: cards.length,
      step1Status: step1?.status,
      step2Status: step2?.status,
      step2CompletedAt: step2?.completedAt,
    }));
  `);
  assert.equal(result.cardCount, 2, '应有 2 张卡片');
  assert.equal(result.step1Status, 'completed', 'step-1 正常完成');
  assert.equal(result.step2Status, 'completed', 'step-2 应被收敛为 completed');
  assert.equal(result.step2CompletedAt, '2026-01-01T00:00:01Z', 'converged step 的 completedAt 应回退到 startedAt');
});

test('P1-Finding-4 | execution failed 后，running step 应收敛为 failed', async () => {
  const result = await runTsSnippet(`
    import m from './src/application/analysis-execution/execution-event-reducer.ts';
    const { reduceEventsToStepCards } = m;

    const events = [
      { id: 'e1', sessionId: 's', executionId: 'x', sequence: 1, kind: 'step-started', timestamp: '2026-01-01T00:00:00Z', step: { id: 'step-1', title: '数据拉取' } },
      { id: 'e2', sessionId: 's', executionId: 'x', sequence: 2, kind: 'execution-status', status: 'failed', timestamp: '2026-01-01T00:00:01Z' },
    ];

    const cards = reduceEventsToStepCards({ events, executionStatus: 'failed' });
    console.log(JSON.stringify({
      status: cards[0]?.status,
    }));
  `);
  assert.equal(result.status, 'failed', 'running step 应被收敛为 failed');
});

test('P1-Finding-4 | executionStatus 未传时 running step 保持不变（向后兼容）', async () => {
  const result = await runTsSnippet(`
    import m from './src/application/analysis-execution/execution-event-reducer.ts';
    const { reduceEventsToStepCards } = m;

    const events = [
      { id: 'e1', sessionId: 's', executionId: 'x', sequence: 1, kind: 'step-started', timestamp: '2026-01-01T00:00:00Z', step: { id: 'step-1', title: '数据拉取' } },
    ];

    // 旧调用方式：直接传数组
    const cards = reduceEventsToStepCards(events);
    console.log(JSON.stringify({
      status: cards[0]?.status,
    }));
  `);
  assert.equal(result.status, 'running', '不传 executionStatus 时 running 状态不变');
});

test('Phase 2b | 无 step 但有 renderBlocks 的事件应保留', async () => {
  const result = await runTsSnippet(`
    import m from './src/application/analysis-execution/execution-event-reducer.ts';
    const { reduceEventsToStepCards } = m;

    const events = [
      {
        id: 'e1',
        sessionId: 's',
        executionId: 'x',
        sequence: 1,
        kind: 'stage-result',
        timestamp: '2026-01-01T00:00:00Z',
        stage: { label: '阶段结果' },
        renderBlocks: [{ type: 'kv-list', title: '结果', items: [] }]
      },
    ];

    const cards = reduceEventsToStepCards(events);
    console.log(JSON.stringify({
      cardCount: cards.length,
      hasRenderBlocks: cards[0]?.renderBlocks?.length > 0
    }));
  `);
  assert.equal(result.cardCount, 1, '应保留执行级卡片');
  assert.equal(result.hasRenderBlocks, true, '应包含 renderBlocks');
});
