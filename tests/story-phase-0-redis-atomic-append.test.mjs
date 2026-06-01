import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
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
// Phase 0b: Redis Atomic Event Append — 写入操作应通过 Lua 脚本原子化
// ---------------------------------------------------------------------------

test('Phase 0b | 源码应使用 redis.eval + Lua 脚本执行写入操作', async () => {
  const source = await readFile(
    'src/infrastructure/analysis-execution/redis-analysis-execution-event-store.ts',
    'utf-8',
  );

  // 应包含 Lua 脚本标记
  assert.match(source, /redis\.call\('RPUSH'/, 'Lua 脚本应包含 RPUSH 命令');
  assert.match(source, /redis\.call\('LTRIM'/, 'Lua 脚本应包含 LTRIM 命令');
  assert.match(source, /redis\.call\('EXPIRE'/, 'Lua 脚本应包含 EXPIRE 命令');

  // 应通过 redis.eval 调用 Lua 脚本
  assert.match(source, /redis\.eval\(/, '应使用 redis.eval 执行 Lua 脚本');
});

test('Phase 0b | append 方法不应直接调用 rPush / lTrim / expire', async () => {
  const source = await readFile(
    'src/infrastructure/analysis-execution/redis-analysis-execution-event-store.ts',
    'utf-8',
  );

  // 提取 append 方法体
  const appendMatch = source.match(
    /async append\(input\)\s*\{[\s\S]*?(?=\n\s{4}async |\n\s{2}\};)/,
  );
  assert.ok(appendMatch, '应能找到 append 方法');
  const appendBody = appendMatch[0];

  // 移除模板字符串（Lua 脚本内容），只保留 JS 代码
  const jsOnly = appendBody.replace(/`[\s\S]*?`/g, '""');

  // JS 代码中不应直接调用这些 Redis 方法
  assert.doesNotMatch(
    jsOnly,
    /redis\.rPush/,
    'append 不应直接调用 redis.rPush（应在 Lua 脚本中）',
  );
  assert.doesNotMatch(
    jsOnly,
    /redis\.lTrim/,
    'append 不应直接调用 redis.lTrim（应在 Lua 脚本中）',
  );
  assert.doesNotMatch(
    jsOnly,
    /redis\.expire/,
    'append 不应直接调用 redis.expire（应在 Lua 脚本中）',
  );
});

test('Phase 0b | append 仍保留 redis.incr 用于获取序列号', async () => {
  const source = await readFile(
    'src/infrastructure/analysis-execution/redis-analysis-execution-event-store.ts',
    'utf-8',
  );

  // INCR 保留在 JS 侧（不在 Lua 脚本中），以便构建带正确 sequence 的事件
  assert.match(
    source,
    /redis\.incr\(/,
    '应保留 redis.incr 调用以获取序列号',
  );
});

test('Phase 0b | eval 调用应传递正确的 keys 和 arguments', async () => {
  const result = await runTsSnippet(`
    import eventStoreModule from './src/infrastructure/analysis-execution/redis-analysis-execution-event-store.ts';
    const { createRedisAnalysisExecutionEventStore } = eventStoreModule;

    let evalCall = null;
    let seqCounter = 0;

    const mockRedis = {
      async incr(key) { return ++seqCounter; },
      async eval(script, options) {
        evalCall = { script, options };
        return 1;
      },
      async lRange() { return []; },
    };

    const store = createRedisAnalysisExecutionEventStore(mockRedis);

    const event = await store.append({
      sessionId: 'sess-atomic',
      executionId: 'exec-atomic',
      kind: 'execution-status',
      status: 'processing',
      message: '原子测试',
    });

    const keys = evalCall?.options?.keys || [];
    const args = evalCall?.options?.arguments || [];
    const script = evalCall?.script || '';

    // 解析传入 Lua 的 event JSON
    let pushedEvent = null;
    try { pushedEvent = JSON.parse(args[0]); } catch {}

    console.log(JSON.stringify({
      keyCount: keys.length,
      hasStreamKey: keys.some(k => k.includes('stream:sess-atomic')),
      hasSeqKey: keys.some(k => k.includes('stream-sequence:sess-atomic')),
      argCount: args.length,
      maxCountArg: args[1],
      ttlArg: args[2],
      scriptHasRpush: script.includes('RPUSH'),
      scriptHasLtrim: script.includes('LTRIM'),
      scriptHasExpire: script.includes('EXPIRE'),
      returnedSequence: event.sequence,
      pushedEventSequence: pushedEvent?.sequence,
      pushedEventKind: pushedEvent?.kind,
    }));
  `);

  assert.equal(result.keyCount, 2, 'Lua 应接收 2 个 KEYS');
  assert.ok(result.hasStreamKey, 'KEYS 应包含 stream key');
  assert.ok(result.hasSeqKey, 'KEYS 应包含 stream-sequence key');
  assert.equal(result.argCount, 3, 'Lua 应接收 3 个 ARGV');
  assert.equal(result.maxCountArg, '200', 'ARGV[2] 应为 MAX_EVENT_COUNT');
  assert.equal(result.ttlArg, '259200', 'ARGV[3] 应为 STREAM_TTL_SECONDS');
  assert.ok(result.scriptHasRpush, '脚本应包含 RPUSH');
  assert.ok(result.scriptHasLtrim, '脚本应包含 LTRIM');
  assert.ok(result.scriptHasExpire, '脚本应包含 EXPIRE');
  assert.equal(result.returnedSequence, 1, '返回的事件应有正确的 sequence');
  assert.equal(result.pushedEventSequence, 1, '推入 Redis 的事件 JSON 应有正确的 sequence');
  assert.equal(result.pushedEventKind, 'execution-status', '推入的事件 kind 应正确');
});

test('Phase 0b | 并发 append 时 eval 与 incr 配合正确', async () => {
  const result = await runTsSnippet(`
    import eventStoreModule from './src/infrastructure/analysis-execution/redis-analysis-execution-event-store.ts';
    const { createRedisAnalysisExecutionEventStore } = eventStoreModule;

    const evalCalls = [];
    let nextSequence = 0;

    const mockRedis = {
      async incr() {
        nextSequence += 1;
        return nextSequence;
      },
      async eval(script, options) {
        evalCalls.push({
          eventJson: options.arguments[0],
          keys: options.keys,
        });
        return 1;
      },
      async lRange() { return []; },
    };

    const store = createRedisAnalysisExecutionEventStore(mockRedis);

    const [first, second] = await Promise.all([
      store.append({
        sessionId: 'sess-concurrent',
        executionId: 'exec-concurrent',
        kind: 'execution-status',
        status: 'processing',
        message: '事件 A',
      }),
      store.append({
        sessionId: 'sess-concurrent',
        executionId: 'exec-concurrent',
        kind: 'execution-status',
        status: 'completed',
        message: '事件 B',
      }),
    ]);

    const pushedEvents = evalCalls.map(c => JSON.parse(c.eventJson));

    console.log(JSON.stringify({
      returnedSequences: [first.sequence, second.sequence].sort((a, b) => a - b),
      evalCallCount: evalCalls.length,
      pushedSequences: pushedEvents.map(e => e.sequence).sort((a, b) => a - b),
      allKeysConsistent: evalCalls.every(c =>
        c.keys.length === 2 &&
        c.keys[0].includes('stream:sess-concurrent') &&
        c.keys[1].includes('stream-sequence:sess-concurrent')
      ),
    }));
  `);

  assert.deepEqual(result.returnedSequences, [1, 2], '返回的 sequence 应为 [1, 2]');
  assert.equal(result.evalCallCount, 2, '应有 2 次 eval 调用');
  assert.deepEqual(result.pushedSequences, [1, 2], '推入的事件 sequence 应为 [1, 2]');
  assert.ok(result.allKeysConsistent, '每次 eval 的 KEYS 应一致');
});
