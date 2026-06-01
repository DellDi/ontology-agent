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
// ---------------------------------------------------------------------------

test('Phase 0c | 未超限的请求应被放行', async () => {
  const result = await runTsSnippet(`
    import { checkRateLimit, EXECUTION_RATE_LIMIT } from './src/infrastructure/api/rate-limit-middleware.ts';

    const mockRedis = {
      async incr() { return 1; },
      async expire() { return true; },
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
    import { checkRateLimit, EXECUTION_RATE_LIMIT } from './src/infrastructure/api/rate-limit-middleware.ts';

    const mockRedis = {
      async incr() { return 5; },
      async expire() { return true; },
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
    import { checkRateLimit, EXECUTION_RATE_LIMIT } from './src/infrastructure/api/rate-limit-middleware.ts';

    const mockRedis = {
      async incr() { return 6; },
      async expire() { return true; },
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

test('Phase 0c | 首次请求应设置 TTL，后续请求不应重复设置', async () => {
  const result = await runTsSnippet(`
    import { checkRateLimit, EXECUTION_RATE_LIMIT } from './src/infrastructure/api/rate-limit-middleware.ts';

    const calls = [];
    const mockRedis = {
      async incr(key) { calls.push(['incr', key]); return 1; },
      async expire(key, ttl) { calls.push(['expire', key, ttl]); return true; },
      async ttl() { return 30; },
    };

    await checkRateLimit(mockRedis, EXECUTION_RATE_LIMIT, 'user-1');

    const expireCalls = calls.filter(c => c[0] === 'expire');
    const expireKey = expireCalls[0]?.[1] ?? null;
    const expireTtl = expireCalls[0]?.[2] ?? null;

    console.log(JSON.stringify({
      expireCallCount: expireCalls.length,
      expireKey,
      expireTtl,
      keyContainsPrefix: expireKey?.includes('rl:analysis:execute') ?? false,
    }));
  `);

  assert.equal(result.expireCallCount, 1, '首次请求应调用一次 expire');
  assert.equal(result.expireTtl, 60, 'expire TTL 应为 60 秒');
  assert.ok(result.keyContainsPrefix, 'key 应包含 rl:analysis:execute 前缀');
});

test('Phase 0c | 非首次请求（count > 1）不应重新设置 TTL', async () => {
  const result = await runTsSnippet(`
    import { checkRateLimit, EXECUTION_RATE_LIMIT } from './src/infrastructure/api/rate-limit-middleware.ts';

    const calls = [];
    const mockRedis = {
      async incr(key) { calls.push(['incr', key]); return 3; },
      async expire(key, ttl) { calls.push(['expire', key, ttl]); return true; },
      async ttl() { return 30; },
    };

    await checkRateLimit(mockRedis, EXECUTION_RATE_LIMIT, 'user-1');

    const expireCalls = calls.filter(c => c[0] === 'expire');

    console.log(JSON.stringify({
      expireCallCount: expireCalls.length,
    }));
  `);

  assert.equal(result.expireCallCount, 0, 'count > 1 时不应调用 expire');
});

test('Phase 0c | FOLLOW_UP_RATE_LIMIT 的 maxRequests 应大于 EXECUTION_RATE_LIMIT', async () => {
  const result = await runTsSnippet(`
    import { EXECUTION_RATE_LIMIT, FOLLOW_UP_RATE_LIMIT } from './src/infrastructure/api/rate-limit-middleware.ts';

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
    import { checkRateLimit, EXECUTION_RATE_LIMIT } from './src/infrastructure/api/rate-limit-middleware.ts';

    const mockRedis = {
      async incr() { return 6; },
      async expire() { return true; },
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
    import { checkRateLimit, EXECUTION_RATE_LIMIT } from './src/infrastructure/api/rate-limit-middleware.ts';

    const keys = [];
    const mockRedis = {
      async incr(key) { keys.push(key); return 1; },
      async expire() { return true; },
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
