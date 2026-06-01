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
// ---------------------------------------------------------------------------

test('Phase 0a | append 后应对 stream key 和 sequence key 设置 72h TTL', async () => {
  const result = await runTsSnippet(`
    import eventStoreModule from './src/infrastructure/analysis-execution/redis-analysis-execution-event-store.ts';
    const { createRedisAnalysisExecutionEventStore } = eventStoreModule;

    const calls = [];
    let seqCounter = 0;

    const mockRedis = {
      async incr(key) { calls.push(['incr', key]); return ++seqCounter; },
      async rPush(key, value) { calls.push(['rPush', key, value]); return 1; },
      async lTrim(key, start, stop) { calls.push(['lTrim', key, start, stop]); },
      async expire(key, ttl) { calls.push(['expire', key, ttl]); },
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

    const expireCalls = calls.filter(c => c[0] === 'expire');
    const expireKeys = expireCalls.map(c => c[1]);
    const expireTtls = expireCalls.map(c => c[2]);

    const expectedStreamKey = 'dip3:stream:sess-001';
    const expectedSeqKey = 'dip3:stream-sequence:sess-001';
    const expectedTtl = 72 * 60 * 60;

    console.log(JSON.stringify({
      expireCallCount: expireCalls.length,
      expireKeys,
      expireTtls,
      hasStreamKey: expireKeys.includes(expectedStreamKey),
      hasSeqKey: expireKeys.includes(expectedSeqKey),
      allTtlsCorrect: expireTtls.every(t => t === expectedTtl),
      expectedTtl,
    }));
  `);

  assert.equal(result.expireCallCount, 2, '应调用 expire 两次（stream + sequence）');
  assert.ok(result.hasStreamKey, '应对 stream key 设置 TTL');
  assert.ok(result.hasSeqKey, '应对 stream-sequence key 设置 TTL');
  assert.ok(result.allTtlsCorrect, `TTL 应为 ${result.expectedTtl} 秒 (72h)`);
});

test('Phase 0a | 多次 append 每次都刷新 TTL', async () => {
  const result = await runTsSnippet(`
    import eventStoreModule from './src/infrastructure/analysis-execution/redis-analysis-execution-event-store.ts';
    const { createRedisAnalysisExecutionEventStore } = eventStoreModule;

    const calls = [];
    let seqCounter = 0;

    const mockRedis = {
      async incr(key) { calls.push(['incr', key]); return ++seqCounter; },
      async rPush(key, value) { calls.push(['rPush', key, value]); return seqCounter; },
      async lTrim(key, start, stop) { calls.push(['lTrim', key, start, stop]); },
      async expire(key, ttl) { calls.push(['expire', key, ttl]); },
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

    const expireCalls = calls.filter(c => c[0] === 'expire');

    console.log(JSON.stringify({
      expireCallCount: expireCalls.length,
    }));
  `);

  assert.equal(result.expireCallCount, 4, '两次 append 应各产生 2 次 expire 调用');
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
