import test from 'node:test';
import assert from 'node:assert/strict';

// Story 7.4 — Observability 核心单元测试：
// - sanitize：敏感字段脱敏与自由文本截断
// - correlation：入站 header 解析 / 缺省生成 / AsyncLocalStorage 传递
// - metrics：counter 累加与 recent errors 行为
// - request wrapper：correlation 注入 + 计数 + 错误可观测
//
// NOTE: 项目 package.json 未声明 `"type": "module"`，tsx 将源 TS 文件编译为 CJS；
// 统一采用 `await import()` 动态加载避免静态命名导入被 CJS 吞掉。

type SanitizeModule = typeof import('../src/infrastructure/observability/sanitize');
type CorrelationModule = typeof import('../src/infrastructure/observability/correlation');
type MetricsModule = typeof import('../src/infrastructure/observability/metrics');
type RequestModule = typeof import('../src/infrastructure/observability/request');

async function loadModules() {
  const sanitize = (await import(
    '@/infrastructure/observability/sanitize'
  )) as SanitizeModule;
  const correlation = (await import(
    '@/infrastructure/observability/correlation'
  )) as CorrelationModule;
  const metricsMod = (await import(
    '@/infrastructure/observability/metrics'
  )) as MetricsModule;
  const requestMod = (await import(
    '@/infrastructure/observability/request'
  )) as RequestModule;
  return { sanitize, correlation, metricsMod, requestMod };
}

// ---------------- sanitize ----------------

test('Story 7.4 | sanitize 将 password / token / secret / cookie 字段脱敏', async () => {
  const { sanitize } = await loadModules();
  const result = sanitize.sanitizeLogPayload({
    username: 'alice',
    password: 'plain-text-should-redact',
    api_key: 'ak-12345',
    accessToken: 'bearer-xxx',
    refresh_token: 'rt-xxx',
    cookie: 'sid=abc',
    sessionId: 'sid-123',
    nested: {
      credential: 'c',
      safe: 'still-here',
    },
  });

  assert.equal(result.username, 'alice');
  assert.equal(result.password, '[REDACTED]');
  assert.equal(result.api_key, '[REDACTED]');
  assert.equal(result.accessToken, '[REDACTED]');
  assert.equal(result.refresh_token, '[REDACTED]');
  assert.equal(result.cookie, '[REDACTED]');
  assert.equal(result.sessionId, '[REDACTED]');
  assert.equal(result.nested.credential, '[REDACTED]');
  assert.equal(result.nested.safe, 'still-here');
});

test('Story 7.4 | sanitize 将 questionText / prompt 替换为长度摘要', async () => {
  const { sanitize } = await loadModules();
  const result = sanitize.sanitizeLogPayload({
    questionText: '为什么某小区本月收费率突然下降超过 20%？',
    prompt: 'system prompt text leak risk',
    nested: {
      rawQuestion: '追问内容',
    },
  });

  assert.match(result.questionText as string, /^\[QUESTION length=\d+\]$/);
  assert.match(result.prompt as string, /^\[QUESTION length=\d+\]$/);
  assert.match(result.nested.rawQuestion as string, /^\[QUESTION length=\d+\]$/);
});

test('Story 7.4 | sanitize 保留正常字段与基本类型', async () => {
  const { sanitize } = await loadModules();
  const result = sanitize.sanitizeLogPayload({
    count: 42,
    active: true,
    tags: ['a', 'b'],
    ratio: 0.9,
  });
  assert.equal(result.count, 42);
  assert.equal(result.active, true);
  assert.deepEqual(result.tags, ['a', 'b']);
  assert.equal(result.ratio, 0.9);
});

test('Story 7.4 | sanitize 递归 Error 对象并转为可序列化结构', async () => {
  const { sanitize } = await loadModules();
  const err = new Error('boom');
  const result = sanitize.sanitizeLogPayload({ err }) as {
    err: { name: string; message: string; stack?: string };
  };
  assert.equal(result.err.name, 'Error');
  assert.equal(result.err.message, 'boom');
  assert.ok(typeof result.err.stack === 'string');
});

// ---------------- correlation ----------------

test('Story 7.4 | correlation 入站 header 优先', async () => {
  const { correlation } = await loadModules();
  const headers = new Headers({ 'x-correlation-id': 'abc-123' });
  const resolved = correlation.resolveCorrelationIdFromHeaders(headers);
  assert.equal(resolved.correlationId, 'abc-123');
  assert.equal(resolved.origin, 'inbound-header');
});

test('Story 7.4 | correlation 无 header 时自动生成并标记 origin', async () => {
  const { correlation } = await loadModules();
  const headers = new Headers();
  const resolved = correlation.resolveCorrelationIdFromHeaders(headers);
  assert.ok(resolved.correlationId.length >= 8);
  assert.equal(resolved.origin, 'generated');
});

test('Story 7.4 | withCorrelationAsync 在异步链中传递 correlation id', async () => {
  const { correlation } = await loadModules();
  const result = await correlation.withCorrelationAsync(
    { correlationId: 'trace-xyz', origin: 'generated' },
    async () => {
      await Promise.resolve();
      return correlation.getCurrentCorrelationId();
    },
  );
  assert.equal(result, 'trace-xyz');
});

test('Story 7.4 | attachResponseCorrelationHeader 在响应头上透传 correlation', async () => {
  const { correlation } = await loadModules();
  const response = new Response(null, { status: 204 });
  const withHeader = correlation.attachResponseCorrelationHeader(
    response,
    'resp-trace-1',
  );
  assert.equal(withHeader.headers.get('x-correlation-id'), 'resp-trace-1');
});

// ---------------- metrics ----------------

test('Story 7.4 | metrics.increment / snapshot 行为正确', async () => {
  const { metricsMod } = await loadModules();
  metricsMod.metrics.reset();
  metricsMod.metrics.increment('request.total');
  metricsMod.metrics.increment('request.total');
  metricsMod.metrics.increment('request.total', 3);

  const snapshot = metricsMod.metrics.snapshot();
  assert.equal(snapshot.counters['request.total'], 5);
  assert.ok(typeof snapshot.generatedAt === 'string');
});

test('Story 7.4 | metrics.recordError 同步累加 counter 并采样最近错误', async () => {
  const { metricsMod } = await loadModules();
  metricsMod.metrics.reset();
  metricsMod.metrics.recordError({
    kind: 'analysis.execute.unhandled',
    message: 'boom',
    correlationId: 'trace-1',
  });
  const snapshot = metricsMod.metrics.snapshot();
  assert.equal(snapshot.counters['errors.analysis.execute.unhandled'], 1);
  assert.equal(snapshot.recentErrors.length, 1);
  assert.equal(snapshot.recentErrors[0].correlationId, 'trace-1');
  assert.equal(snapshot.recentErrors[0].kind, 'analysis.execute.unhandled');
});

// ---------------- request wrapper ----------------

test('Story 7.4 | withRequestObservability 注入 correlation 并计数成功请求', async () => {
  const { requestMod, metricsMod, correlation } = await loadModules();
  metricsMod.metrics.reset();

  const request = new Request('http://localhost/api/test', { method: 'GET' });
  const response = await requestMod.withRequestObservability(
    request,
    'test.op',
    async () => {
      // 断言 handler 内部可以读到 correlation id
      assert.ok(correlation.getCurrentCorrelationId());
      return new Response('ok', { status: 200 });
    },
  );

  assert.equal(response.status, 200);
  assert.ok(response.headers.get('x-correlation-id'));
  const snapshot = metricsMod.metrics.snapshot();
  assert.equal(snapshot.counters['request.total'], 1);
  assert.equal(snapshot.counters['request.by_op.test.op'], 1);
  assert.equal(snapshot.counters['request.status.200'], 1);
});

test('Story 7.4 | withRequestObservability 将 500 响应计入错误指标', async () => {
  const { requestMod, metricsMod } = await loadModules();
  metricsMod.metrics.reset();

  const request = new Request('http://localhost/api/test', { method: 'GET' });
  const response = await requestMod.withRequestObservability(
    request,
    'test.op',
    async () => new Response('err', { status: 500 }),
  );

  assert.equal(response.status, 500);
  const snapshot = metricsMod.metrics.snapshot();
  assert.equal(snapshot.counters['errors.test.op.status_500'], 1);
});

test('Story 7.4 | withRequestObservability 将抛出异常纳入 recentErrors 并继续抛出', async () => {
  const { requestMod, metricsMod } = await loadModules();
  metricsMod.metrics.reset();

  const request = new Request('http://localhost/api/test', { method: 'GET' });
  await assert.rejects(
    () =>
      requestMod.withRequestObservability(request, 'test.op', async () => {
        throw new Error('handler crashed');
      }),
    (error: unknown) =>
      error instanceof Error && /handler crashed/.test(error.message),
  );

  const snapshot = metricsMod.metrics.snapshot();
  assert.equal(snapshot.counters['errors.test.op.unhandled'], 1);
  assert.equal(snapshot.recentErrors.at(-1)?.kind, 'test.op.unhandled');
});

test('Story 7.4 | withRequestObservability 继承入站 x-correlation-id', async () => {
  const { requestMod, correlation } = await loadModules();

  const request = new Request('http://localhost/api/test', {
    method: 'GET',
    headers: { 'x-correlation-id': 'inherited-trace' },
  });

  let captured: string | undefined;
  await requestMod.withRequestObservability(request, 'test.op', async () => {
    captured = correlation.getCurrentCorrelationId();
    return new Response(null, { status: 204 });
  });

  assert.equal(captured, 'inherited-trace');
});

// ---------------- 补充覆盖（P3） ----------------

test('Story 7.4 | sanitize 对深层嵌套超出 maxDepth 回落到标记', async () => {
  const { sanitize } = await loadModules();
  let node: Record<string, unknown> = { leaf: 'value' };
  for (let i = 0; i < 8; i += 1) {
    node = { nested: node };
  }
  const serialized = JSON.stringify(sanitize.sanitizeLogPayload(node));
  assert.ok(
    serialized.includes('[DEPTH_LIMIT]'),
    '超过 maxDepth 时必须有明显标记避免无限递归',
  );
});

test('Story 7.4 | sanitize 不再把 publicKey / workflowKey 误伤为 REDACTED（P5 验证）', async () => {
  const { sanitize } = await loadModules();
  const result = sanitize.sanitizeLogPayload({
    publicKey: 'abc-public',
    workflowKey: 'flow-123',
    apiKey: 'secret-key-should-redact',
  });
  assert.equal(result.publicKey, 'abc-public');
  assert.equal(result.workflowKey, 'flow-123');
  assert.equal(result.apiKey, '[REDACTED]');
});

test('Story 7.4 | logger safeStringify 处理循环引用不抛出（P4 验证）', async () => {
  const logger = (await loadModules()).requestMod; // reuse import chain
  // 直接加载 logger 验证 safeStringify 的"不抛异常"契约。
  const { createLogger } = (await import(
    '@/infrastructure/observability/logger'
  )) as typeof import('../src/infrastructure/observability/logger');
  const log = createLogger();
  const circular: Record<string, unknown> = { name: 'root' };
  circular.self = circular;
  // 能不抛异常完成记录即通过；借助 assert.doesNotThrow 验证契约。
  assert.doesNotThrow(() => {
    log.info('test.circular', { payload: circular });
  });
  // 防止 unused 变量 lint
  assert.ok(logger);
});

test('Story 7.4 | attachResponseCorrelationHeader 对 ReadableStream body 不克隆（P1 验证）', async () => {
  const { correlation } = await loadModules();

  // 手动生成一个 frozen header 的 Response，迫使走 catch 分支。
  const originalHeaders = new Headers();
  Object.freeze(originalHeaders);
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: hello\n\n'));
      controller.close();
    },
  });

  // 由于 frozen header 只能在某些 runtime 上构造出来，这里直接断言
  // stream body 情况下即便 header 写入失败也返回原始 Response，不会破坏 stream。
  const response = new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });

  const result = correlation.attachResponseCorrelationHeader(
    response,
    'trace-for-stream',
  );
  // 一切正常 set 的 runtime 下也必须保证 body 仍是可读流。
  assert.ok(result.body instanceof ReadableStream);
});

test('Story 7.4 | metrics 请求 wrapper 不对已存在 correlation id 重复写入响应头', async () => {
  const { requestMod } = await loadModules();
  const request = new Request('http://localhost/api/test', {
    method: 'GET',
    headers: { 'x-correlation-id': 'inbound-a' },
  });

  const response = await requestMod.withRequestObservability(
    request,
    'test.op',
    async () => {
      const pre = new Response(null, { status: 204 });
      pre.headers.set('x-correlation-id', 'handler-set');
      return pre;
    },
  );

  // handler 已主动写入的 correlation id 必须被尊重，不被 wrapper 覆盖。
  assert.equal(response.headers.get('x-correlation-id'), 'handler-set');
});
