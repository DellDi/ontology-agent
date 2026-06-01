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
// Phase 0d: LLM call timeout — callWithTimeout / LLMTimeoutError
// ---------------------------------------------------------------------------

test('Phase 0d | callWithTimeout 在函数及时完成时正常 resolve', async () => {
  const result = await runTsSnippet(`
    import timeoutUtils from './src/worker/timeout-utils.ts';
    const { callWithTimeout } = timeoutUtils;

    const value = await callWithTimeout(() => Promise.resolve('ok'), 5000);
    console.log(JSON.stringify({ value }));
  `);

  assert.equal(result.value, 'ok');
});

test('Phase 0d | callWithTimeout 超时时 reject LLMTimeoutError', async () => {
  const result = await runTsSnippet(`
    import timeoutUtils from './src/worker/timeout-utils.ts';
    const { callWithTimeout, LLMTimeoutError } = timeoutUtils;

    // 永不 resolve 的 Promise，配合极短超时
    const neverResolve = new Promise(() => {});

    try {
      await callWithTimeout(() => neverResolve, 50);
      console.log(JSON.stringify({ timedOut: false }));
    } catch (error) {
      console.log(JSON.stringify({
        timedOut: true,
        isLLMTimeoutError: error instanceof LLMTimeoutError,
        errorName: error.name,
        errorMessage: error.message,
      }));
    }
  `);

  assert.ok(result.timedOut, '应该因超时而 reject');
  assert.ok(result.isLLMTimeoutError, '错误应该是 LLMTimeoutError 实例');
  assert.equal(result.errorName, 'LLMTimeoutError');
  assert.match(result.errorMessage, /超时/, '错误消息应包含"超时"');
});

test('Phase 0d | callWithTimeout 透传原始错误（非超时）', async () => {
  const result = await runTsSnippet(`
    import timeoutUtils from './src/worker/timeout-utils.ts';
    const { callWithTimeout, LLMTimeoutError } = timeoutUtils;

    const failing = () => Promise.reject(new Error('LLM provider error'));

    try {
      await callWithTimeout(failing, 5000);
      console.log(JSON.stringify({ threw: false }));
    } catch (error) {
      console.log(JSON.stringify({
        threw: true,
        isLLMTimeoutError: error instanceof LLMTimeoutError,
        errorMessage: error.message,
      }));
    }
  `);

  assert.ok(result.threw, '应该抛出错误');
  assert.ok(!result.isLLMTimeoutError, '不应是 LLMTimeoutError');
  assert.equal(result.errorMessage, 'LLM provider error');
});

test('Phase 0d | LLM_TIMEOUT_MS 常量在合理范围内（30s–120s）', async () => {
  const result = await runTsSnippet(`
    import timeoutUtils from './src/worker/timeout-utils.ts';
    const { LLM_TIMEOUT_MS } = timeoutUtils;

    console.log(JSON.stringify({
      value: LLM_TIMEOUT_MS,
      gte30s: LLM_TIMEOUT_MS >= 30_000,
      lte120s: LLM_TIMEOUT_MS <= 120_000,
    }));
  `);

  assert.ok(result.gte30s, `LLM_TIMEOUT_MS 应 >= 30000，实际 ${result.value}`);
  assert.ok(result.lte120s, `LLM_TIMEOUT_MS 应 <= 120000，实际 ${result.value}`);
});

test('Phase 0d | LLMTimeoutError 消息包含可读秒数', async () => {
  const result = await runTsSnippet(`
    import timeoutUtils from './src/worker/timeout-utils.ts';
    const { LLMTimeoutError } = timeoutUtils;

    const error60 = new LLMTimeoutError(60_000);
    const error30 = new LLMTimeoutError(30_000);

    console.log(JSON.stringify({
      msg60: error60.message,
      msg30: error30.message,
      name: error60.name,
      has60: error60.message.includes('60'),
      has30: error30.message.includes('30'),
    }));
  `);

  assert.equal(result.name, 'LLMTimeoutError');
  assert.ok(result.has60, '60 秒超时的错误消息应包含"60"');
  assert.ok(result.has30, '30 秒超时的错误消息应包含"30"');
});

test('Phase 0d | callWithTimeout 使用默认超时值', async () => {
  const result = await runTsSnippet(`
    import timeoutUtils from './src/worker/timeout-utils.ts';
    const { callWithTimeout, LLMTimeoutError } = timeoutUtils;

    // 验证默认超时值生效：不传第二个参数时应使用 LLM_TIMEOUT_MS（60s）
    const neverResolve = new Promise(() => {});

    // 仅验证 callWithTimeout 可省略 timeoutMs 参数
    const promise = callWithTimeout(() => neverResolve);

    // 给它一点时间确保不会立即 reject（默认 60s，不应在 100ms 内超时）
    const raceResult = await Promise.race([
      promise.then(() => 'resolved').catch(e => e instanceof LLMTimeoutError ? 'timeout' : 'other-error'),
      new Promise(resolve => setTimeout(() => resolve('still-pending'), 100)),
    ]);

    console.log(JSON.stringify({ raceResult }));

    // 强制退出，避免 pending timer 阻塞子进程
    process.exit(0);
  `);

  assert.equal(
    result.raceResult,
    'still-pending',
    '使用默认超时时，100ms 内不应 reject',
  );
});
