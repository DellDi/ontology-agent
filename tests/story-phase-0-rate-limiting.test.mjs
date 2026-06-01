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
// Phase 0c: API rate limiting — execute 和 follow-up 端点的限流检查
// 注：重构为 Lua 脚本原子化 INCR + EXPIRE 后，mock 需要实现 eval()。
// eval 的签名：eval(script, { keys, arguments })
// ---------------------------------------------------------------------------

test('Phase 0c | 未超限的请求应被放行', async () => {
  const result = await runTsSnippet(`
    import rateLimitModule from './src/infrastructure/api/rate-limit-middleware.ts';
    const { checkRateLimit, EXECUTION_RATE_LIMIT } = rateLimitModule;

    const mockRedis = {
      async eval(script, opts) { return 1; },
      async ttl() { return 30; },
    };

    const res = await checkRateLimit(mockRedis, EXECUTION_RATE_LIMIT, 'user-1');

    console.log(JSON.stringify({
      allowed: res.allowed,
    }));
  `);

  assert.equal(result.allowed, true, '第 1 次请求应被放行');
});

test('Phase 0c | 恰好到达上限的请求仍应被放行', async () => {
  const result = await runTsSnippet(`
    import rateLimitModule from './src/infrastructure/api/rate-limit-middleware.ts';
    const { checkRateLimit, EXECUTION_RATE_LIMIT } = rateLimitModule;

    const mockRedis = {
      async eval(script, opts) { return 5; },
      async ttl() { return 30; },
    };

    const res = await checkRateLimit(mockRedis, EXECUTION_RATE_LIMIT, 'user-1');

    console.log(JSON.stringify({
      allowed: res.allowed,
    }));
  `);

  assert.equal(result.allowed, true, '第 5 次请求（等于上限）应被放行');
});

test('Phase 0c | 超过上限的请求应被拒绝并返回 retryAfterSeconds', async () => {
  const result = await runTsSnippet(`
    import rateLimitModule from './src/infrastructure/api/rate-limit-middleware.ts';
    const { checkRateLimit, EXECUTION_RATE_LIMIT } = rateLimitModule;

    const mockRedis = {
      async eval(script, opts) { return 6; },
      async ttl() { return 30; },
    };

    const res = await checkRateLimit(mockRedis, EXECUTION_RATE_LIMIT, 'user-1');

    console.log(JSON.stringify({
      allowed: res.allowed,
      retryAfterSeconds: res.allowed === false ? res.retryAfterSeconds : null,
      limit: res.allowed === false ? res.limit : null,
    }));
  `);

  assert.equal(result.allowed, false, '第 6 次请求（超过上限）应被拒绝');
  assert.ok(result.retryAfterSeconds > 0, 'retryAfterSeconds 应大于 0');
  assert.equal(result.limit, 5, 'limit 应等于 maxRequests');
});

test('Phase 0c | eval 应接收正确的 key 与 windowSeconds 参数', async () => {
  const result = await runTsSnippet(`
    import rateLimitModule from './src/infrastructure/api/rate-limit-middleware.ts';
    const { checkRateLimit, EXECUTION_RATE_LIMIT } = rateLimitModule;

    const evalCalls = [];
    const mockRedis = {
      async eval(script, opts) {
        evalCalls.push({ script: script.trim(), keys: opts.keys, arguments: opts.arguments });
        return 1;
      },
      async ttl() { return 30; },
    };

    await checkRateLimit(mockRedis, EXECUTION_RATE_LIMIT, 'user-1');

    const call = evalCalls[0];
    console.log(JSON.stringify({
      evalCallCount: evalCalls.length,
      key: call?.keys?.[0] ?? null,
      keyContainsPrefix: call?.keys?.[0]?.includes('rl:analysis:execute') ?? false,
      keyContainsUser: call?.keys?.[0]?.includes('user-1') ?? false,
      windowArg: call?.arguments?.[0] ?? null,
      scriptUsesIncr: call?.script?.includes('INCR') ?? false,
      scriptUsesExpire: call?.script?.includes('EXPIRE') ?? false,
    }));
  `);

  assert.equal(result.evalCallCount, 1, '应调用一次 eval');
  assert.ok(result.keyContainsPrefix, 'key 应包含 rl:analysis:execute 前缀');
  assert.ok(result.keyContainsUser, 'key 应包含用户标识');
  assert.equal(result.windowArg, '60', 'ARGV[1] 应为 windowSeconds 字符串 "60"');
  assert.ok(result.scriptUsesIncr, 'Lua 脚本应包含 INCR 调用');
  assert.ok(result.scriptUsesExpire, 'Lua 脚本应包含 EXPIRE 调用');
});

test('Phase 0c | Lua 脚本保证原子性：INCR 与 EXPIRE 不会分离执行', async () => {
  const result = await runTsSnippet(`
    import rateLimitModule from './src/infrastructure/api/rate-limit-middleware.ts';
    const { checkRateLimit, EXECUTION_RATE_LIMIT } = rateLimitModule;

    // 验证：checkRateLimit 仅调用 eval（Lua），不再单独调用 incr / expire。
    // 这是原子性保证——若仍调用 incr/expire，说明回退到非原子路径。
    const calls = [];
    const mockRedis = {
      async eval(script, opts) { calls.push('eval'); return 1; },
      async incr() { calls.push('incr'); return 1; },
      async expire() { calls.push('expire'); return true; },
      async ttl() { return 30; },
    };

    await checkRateLimit(mockRedis, EXECUTION_RATE_LIMIT, 'user-1');

    console.log(JSON.stringify({
      calls,
      onlyEvalUsed: calls.length === 1 && calls[0] === 'eval',
    }));
  `);

  assert.equal(result.onlyEvalUsed, true, '应仅通过 eval(Lua) 执行 INCR+EXPIRE，不直接调用 incr/expire');
});

test('Phase 0c | FOLLOW_UP_RATE_LIMIT 的 maxRequests 应大于 EXECUTION_RATE_LIMIT', async () => {
  const result = await runTsSnippet(`
    import rateLimitModule from './src/infrastructure/api/rate-limit-middleware.ts';
    const { EXECUTION_RATE_LIMIT, FOLLOW_UP_RATE_LIMIT } = rateLimitModule;

    console.log(JSON.stringify({
      executionMax: EXECUTION_RATE_LIMIT.maxRequests,
      followUpMax: FOLLOW_UP_RATE_LIMIT.maxRequests,
      followUpHigher: FOLLOW_UP_RATE_LIMIT.maxRequests > EXECUTION_RATE_LIMIT.maxRequests,
      executionWindow: EXECUTION_RATE_LIMIT.windowSeconds,
      followUpWindow: FOLLOW_UP_RATE_LIMIT.windowSeconds,
    }));
  `);

  assert.ok(result.followUpHigher, '追问限流上限应高于执行限流上限');
  assert.equal(result.executionMax, 5, '执行限流应为 5 次/窗口');
  assert.equal(result.followUpMax, 10, '追问限流应为 10 次/窗口');
  assert.equal(result.executionWindow, 60, '窗口应为 60 秒');
  assert.equal(result.followUpWindow, 60, '窗口应为 60 秒');
});

test('Phase 0c | TTL 为 -1（key 无过期）时应回退到 windowSeconds', async () => {
  const result = await runTsSnippet(`
    import rateLimitModule from './src/infrastructure/api/rate-limit-middleware.ts';
    const { checkRateLimit, EXECUTION_RATE_LIMIT } = rateLimitModule;

    const mockRedis = {
      async eval() { return 6; },
      async ttl() { return -1; },
    };

    const res = await checkRateLimit(mockRedis, EXECUTION_RATE_LIMIT, 'user-1');

    console.log(JSON.stringify({
      allowed: res.allowed,
      retryAfterSeconds: res.allowed === false ? res.retryAfterSeconds : null,
    }));
  `);

  assert.equal(result.allowed, false, '超过上限应被拒绝');
  assert.equal(result.retryAfterSeconds, 60, 'TTL 为 -1 时应回退到 windowSeconds');
});

test('Phase 0c | 限流 key 应包含用户标识以实现 per-user 隔离', async () => {
  const result = await runTsSnippet(`
    import rateLimitModule from './src/infrastructure/api/rate-limit-middleware.ts';
    const { checkRateLimit, EXECUTION_RATE_LIMIT } = rateLimitModule;

    const keys = [];
    const mockRedis = {
      async eval(script, opts) { keys.push(opts.keys[0]); return 1; },
      async ttl() { return 30; },
    };

    await checkRateLimit(mockRedis, EXECUTION_RATE_LIMIT, 'user-alpha');
    await checkRateLimit(mockRedis, EXECUTION_RATE_LIMIT, 'user-beta');

    console.log(JSON.stringify({
      keys,
      userAlphaKey: keys[0],
      userBetaKey: keys[1],
      keysAreDistinct: keys[0] !== keys[1],
      userAlphaInKey: keys[0]?.includes('user-alpha') ?? false,
      userBetaInKey: keys[1]?.includes('user-beta') ?? false,
    }));
  `);

  assert.ok(result.keysAreDistinct, '不同用户应产生不同的限流 key');
  assert.ok(result.userAlphaInKey, 'key 应包含 user-alpha 标识');
  assert.ok(result.userBetaInKey, 'key 应包含 user-beta 标识');
});
