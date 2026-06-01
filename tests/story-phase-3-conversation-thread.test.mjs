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

test('Phase 3a | 单轮线程应产生 1 个 turn', async () => {
  const result = await runTsSnippet(`
    import m from './src/application/analysis-message-projection/conversation-thread-view-model.ts';
    const { buildConversationThreadViewModel } = m;

    const thread = buildConversationThreadViewModel({
      rounds: [
        {
          executionId: 'exec-1',
          questionText: '2026年物业费收缴率是多少？',
          projection: null,
          events: [],
        },
      ],
      activeTurnId: 'exec-1',
    });

    console.log(JSON.stringify({
      turnCount: thread.turns.length,
      activeTurnId: thread.activeTurnId,
      firstQuestion: thread.turns[0]?.viewModel.userMessage.questionText,
      firstExpanded: thread.turns[0]?.isExpanded,
    }));
  `);
  assert.equal(result.turnCount, 1);
  assert.equal(result.activeTurnId, 'exec-1');
  assert.equal(result.firstQuestion, '2026年物业费收缴率是多少？');
  assert.equal(result.firstExpanded, true);
});

test('Phase 3a | 多轮线程应按顺序排列', async () => {
  const result = await runTsSnippet(`
    import m from './src/application/analysis-message-projection/conversation-thread-view-model.ts';
    const { buildConversationThreadViewModel } = m;

    const thread = buildConversationThreadViewModel({
      rounds: [
        { executionId: 'exec-1', questionText: '初始问题', projection: null, events: [] },
        { executionId: 'exec-2', questionText: '按月份展开看看', projection: null, events: [] },
      ],
      activeTurnId: 'exec-2',
    });

    console.log(JSON.stringify({
      turnCount: thread.turns.length,
      q1: thread.turns[0]?.viewModel.userMessage.questionText,
      q2: thread.turns[1]?.viewModel.userMessage.questionText,
      expanded1: thread.turns[0]?.isExpanded,
      expanded2: thread.turns[1]?.isExpanded,
    }));
  `);
  assert.equal(result.turnCount, 2);
  assert.equal(result.q1, '初始问题');
  assert.equal(result.q2, '按月份展开看看');
  assert.equal(result.expanded1, false, '非活跃轮不应展开');
  assert.equal(result.expanded2, true, '活跃轮应展开');
});

test('Phase 3a | 3 轮线程只有 active turn 展开', async () => {
  const result = await runTsSnippet(`
    import m from './src/application/analysis-message-projection/conversation-thread-view-model.ts';
    const { buildConversationThreadViewModel } = m;

    const thread = buildConversationThreadViewModel({
      rounds: [
        { executionId: 'exec-1', questionText: '问题一', projection: null, events: [] },
        { executionId: 'exec-2', questionText: '问题二', projection: null, events: [] },
        { executionId: 'exec-3', questionText: '问题三', projection: null, events: [] },
      ],
      activeTurnId: 'exec-2',
    });

    console.log(JSON.stringify({
      expanded: thread.turns.map(t => t.isExpanded),
    }));
  `);
  assert.deepEqual(result.expanded, [false, true, false]);
});
