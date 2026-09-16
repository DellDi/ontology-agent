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
  return JSON.parse(stdout.trim().split('\n').pop());
}

const IMPORTS = `
  import turnsModule from './src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-chat-turns.ts';
  const { buildChatTurns } = turnsModule;
`;

function buildRound(overrides = {}) {
  return {
    id: overrides.id ?? `round-${overrides.n ?? 1}`,
    kind: overrides.kind ?? 'initial',
    questionText: overrides.questionText ?? '问题',
    followUpId: overrides.followUpId ?? null,
    executionId: overrides.executionId ?? `exec-${overrides.n ?? 1}`,
    status: overrides.status ?? 'completed',
    ontologyVersionId: null,
    ontologyVersionBindingSource: null,
    planSnapshot: null,
    conclusionState: overrides.conclusionState ?? null,
    createdAt: '2026-01-01T00:00:00Z',
  };
}

test('Chat turns | 每轮历史轮次都渲染，live 仅标记当前执行轮', async () => {
  const aggregate = {
    history: [
      buildRound({ id: 'r1', n: 1, questionText: '问题一', executionId: 'exec-1' }),
      buildRound({ id: 'r2', n: 2, kind: 'follow-up', followUpId: 'fu-1', questionText: '问题二', executionId: 'exec-2' }),
      buildRound({ id: 'r3', n: 3, kind: 'follow-up', followUpId: 'fu-2', questionText: '问题三', executionId: 'exec-3' }),
    ],
    followUps: [
      { id: 'fu-1', questionText: '问题二', resultExecutionId: 'exec-2' },
      { id: 'fu-2', questionText: '问题三', resultExecutionId: 'exec-3' },
    ],
  };

  const result = await runTsSnippet(`
    ${IMPORTS}
    const aggregate = ${JSON.stringify(aggregate)};
    const turns = buildChatTurns(aggregate, 'exec-2');
    console.log(JSON.stringify(turns.map((turn) => ({
      key: turn.key,
      questionText: turn.questionText,
      live: turn.live,
      status: turn.status,
    }))));
  `);

  assert.equal(result.length, 3);
  assert.deepEqual(
    result.map((turn) => turn.live),
    [false, true, false],
    '只有 resolvedExecutionId 对应轮次是 live',
  );
  assert.equal(result[1].questionText, '问题二');
});

test('Chat turns | 无执行事实的追问追加为 pending 轮', async () => {
  const aggregate = {
    history: [
      buildRound({ id: 'r1', n: 1, questionText: '初始问题', executionId: 'exec-1' }),
    ],
    followUps: [
      { id: 'fu-pending', questionText: '新问题', resultExecutionId: null },
    ],
  };

  const result = await runTsSnippet(`
    ${IMPORTS}
    const aggregate = ${JSON.stringify(aggregate)};
    const turns = buildChatTurns(aggregate, 'exec-1');
    console.log(JSON.stringify(turns.map((turn) => ({
      key: turn.key,
      status: turn.status,
      followUpId: turn.followUpId,
      live: turn.live,
    }))));
  `);

  assert.equal(result.length, 2);
  assert.equal(result[1].key, 'pending-fu-pending');
  assert.equal(result[1].status, 'pending');
  assert.equal(result[1].followUpId, 'fu-pending');
});

test('Chat turns | 已落位历史轮的追问不重复生成 pending 轮', async () => {
  const aggregate = {
    history: [
      buildRound({ id: 'r1', n: 1, questionText: '初始', executionId: 'exec-1' }),
      buildRound({ id: 'r2', n: 2, kind: 'follow-up', followUpId: 'fu-1', questionText: '追问', executionId: null, status: null }),
    ],
    followUps: [
      { id: 'fu-1', questionText: '追问', resultExecutionId: null },
    ],
  };

  const result = await runTsSnippet(`
    ${IMPORTS}
    const aggregate = ${JSON.stringify(aggregate)};
    const turns = buildChatTurns(aggregate, 'exec-1');
    console.log(JSON.stringify(turns.map((turn) => turn.key)));
  `);

  assert.deepEqual(result, ['r1', 'r2'], '历史轮已覆盖的 followUp 不得重复');
});

test('Chat turns | processing/queued 归一为 running', async () => {
  const aggregate = {
    history: [
      buildRound({ id: 'r1', n: 1, executionId: 'exec-1', status: 'processing' }),
      buildRound({ id: 'r2', n: 2, kind: 'follow-up', followUpId: 'fu-1', executionId: 'exec-2', status: 'queued' }),
    ],
    followUps: [],
  };

  const result = await runTsSnippet(`
    ${IMPORTS}
    const aggregate = ${JSON.stringify(aggregate)};
    const turns = buildChatTurns(aggregate, 'exec-1');
    console.log(JSON.stringify(turns.map((turn) => turn.status)));
  `);

  assert.deepEqual(result, ['running', 'running']);
});
