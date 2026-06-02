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
// Phase 0a: Redis Stream TTL — append 后应对 stream 和 sequence key 设置过期
// (updated for Phase 0b: TTL now set inside Lua script via redis.eval)
// ---------------------------------------------------------------------------

test('Phase 0a | append 通过 Lua 脚本对 stream key 和 sequence key 设置 72h TTL', async () => {
  const result = await runTsSnippet(`
    import eventStoreModule from './src/infrastructure/analysis-execution/redis-analysis-execution-event-store.ts';
    const { createRedisAnalysisExecutionEventStore } = eventStoreModule;

    const calls = [];
    let seqCounter = 0;

    const mockRedis = {
      async incr(key) { calls.push(['incr', key]); return ++seqCounter; },
      async eval(script, options) {
        calls.push(['eval', script, options]);
        return 1;
      },
      async lRange() { return []; },
    };

    const store = createRedisAnalysisExecutionEventStore(mockRedis);

    await store.append({
      sessionId: 'sess-001',
      executionId: 'exec-001',
      kind: 'execution-status',
      status: 'processing',
      message: '开始执行',
    });

    const evalCalls = calls.filter(c => c[0] === 'eval');

    let evalKeys = [];
    let evalArgs = [];
    let scriptContainsExpire = false;
    if (evalCalls.length > 0) {
      const opts = evalCalls[0][2];
      evalKeys = opts.keys || [];
      evalArgs = opts.arguments || [];
      scriptContainsExpire = evalCalls[0][1].includes('EXPIRE');
    }

    const expectedStreamKey = 'dip3:stream:sess-001';
    const expectedSeqKey = 'dip3:stream-sequence:sess-001';
    const expectedTtl = String(72 * 60 * 60);

    console.log(JSON.stringify({
      evalCallCount: evalCalls.length,
      evalKeys,
      evalArgs,
      scriptContainsExpire,
      hasStreamKey: evalKeys.includes(expectedStreamKey),
      hasSeqKey: evalKeys.includes(expectedSeqKey),
      ttlArgCorrect: evalArgs.includes(expectedTtl),
      expectedTtl,
    }));
  `);

  assert.equal(result.evalCallCount, 1, '应调用 eval 一次（Lua 脚本）');
  assert.ok(result.hasStreamKey, 'Lua KEYS 应包含 stream key');
  assert.ok(result.hasSeqKey, 'Lua KEYS 应包含 stream-sequence key');
  assert.ok(result.scriptContainsExpire, 'Lua 脚本应包含 EXPIRE 命令');
  assert.ok(result.ttlArgCorrect, `Lua ARGV 应包含 TTL ${result.expectedTtl} 秒 (72h)`);
});

test('Phase 0a | 多次 append 每次都通过 Lua 脚本刷新 TTL', async () => {
  const result = await runTsSnippet(`
    import eventStoreModule from './src/infrastructure/analysis-execution/redis-analysis-execution-event-store.ts';
    const { createRedisAnalysisExecutionEventStore } = eventStoreModule;

    const calls = [];
    let seqCounter = 0;

    const mockRedis = {
      async incr(key) { calls.push(['incr', key]); return ++seqCounter; },
      async eval(script, options) {
        calls.push(['eval', script, options]);
        return 1;
      },
      async lRange() { return []; },
    };

    const store = createRedisAnalysisExecutionEventStore(mockRedis);

    await store.append({
      sessionId: 'sess-002',
      executionId: 'exec-002',
      kind: 'step-lifecycle',
      message: '步骤 1',
    });

    await store.append({
      sessionId: 'sess-002',
      executionId: 'exec-002',
      kind: 'step-lifecycle',
      message: '步骤 2',
    });

    const evalCalls = calls.filter(c => c[0] === 'eval');

    console.log(JSON.stringify({
      evalCallCount: evalCalls.length,
    }));
  `);

  assert.equal(result.evalCallCount, 2, '两次 append 应各产生 1 次 eval 调用');
});

test('Phase 0a | STREAM_TTL_SECONDS 常量已导出且值为 259200', async () => {
  const result = await runTsSnippet(`
    import eventStoreModule from './src/infrastructure/analysis-execution/redis-analysis-execution-event-store.ts';
    const { STREAM_TTL_SECONDS } = eventStoreModule;

    console.log(JSON.stringify({
      value: STREAM_TTL_SECONDS,
      isCorrect: STREAM_TTL_SECONDS === 72 * 60 * 60,
    }));
  `);

  assert.ok(result.isCorrect, `STREAM_TTL_SECONDS 应为 ${72 * 60 * 60}，实际为 ${result.value}`);
});
