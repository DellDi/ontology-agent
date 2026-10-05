import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import Ajv2020 from 'ajv/dist/2020.js';
import contracts from '../src/infrastructure/java-backend/scheme-assessment-contract.ts';
import client from '../src/infrastructure/java-backend/scheme-assessment-client.ts';
import route from '../src/app/api/analysis/sessions/[sessionId]/objects/assess/route.ts';
const { javaSchemeAssessmentRequestSchema, javaSchemeAssessmentResultSchema } = contracts;
const root = new URL('../contracts/backend/', import.meta.url);
const fixture = JSON.parse(await readFile(new URL('fixtures/scheme-assessment.json', root), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
for (const name of ['request', 'result']) ajv.addSchema(JSON.parse(await readFile(new URL(`schemas/scheme-assessment-${name}.schema.json`, root), 'utf8')));

test('方案评估 | Java 序列化 fixture 与 JSON Schema / Zod 一致，旧冻结缺失也是正式结果', () => {
  assert.equal(ajv.getSchema('scheme-assessment-request.schema.json')(fixture.selection), true, ajv.errorsText());
  assert.equal(javaSchemeAssessmentRequestSchema.safeParse(fixture.selection).success, true);
  assert.equal(ajv.getSchema('scheme-assessment-result.schema.json')(fixture), true, ajv.errorsText());
  assert.equal(javaSchemeAssessmentResultSchema.safeParse(fixture).success, true);
  const legacy = structuredClone(fixture); legacy.status = 'unassessable'; legacy.reason = 'SCHEME_LIBRARY_NOT_RETAINED';
  legacy.comparison = null; legacy.geometry = null; legacy.candidateInputs = []; delete legacy.productVersionIds['easyv-scheme-library'];
  assert.equal(ajv.getSchema('scheme-assessment-result.schema.json')(legacy), true);
  assert.equal(javaSchemeAssessmentResultSchema.safeParse(legacy).success, true);
});

test('方案评估 | 严格拒绝客户端属性和 SQL，评分与状态必须一致', () => {
  for (const request of [{ ...fixture.selection, sql: 'select *' }, { ...fixture.selection, properties: {} },
    { ...fixture.selection, reference: { ...fixture.selection.reference, objectKey: 'easyv-prototype-layout' } }]) {
    assert.equal(javaSchemeAssessmentRequestSchema.safeParse(request).success, false);
    assert.equal(ajv.getSchema('scheme-assessment-request.schema.json')(request), false);
  }
  for (const mutate of [
    (value) => { value.comparison.current.status = 'unassessable'; },
    (value) => { value.comparison.current.score = 101; },
    (value) => { value.comparison.current.assignments = []; },
    (value) => { value.comparison.current.sql = 'select *'; },
    (value) => { value.comparison.candidates[0].schemeId = 'not-in-input'; },
    (value) => { value.selection.reference.productVersionId = 'new-block'; },
    (value) => { value.comparison.rules.calibration = 'certified'; },
  ]) {
    const value = structuredClone(fixture); mutate(value);
    assert.equal(javaSchemeAssessmentResultSchema.safeParse(value).success, false);
  }
});

test('方案评估 | BFF 原样透传冻结引用、Cookie、Java 返回和权限错误', async (context) => {
  const previous = process.env.JAVA_BACKEND_URL; const captured = [];
  const server = createServer(async (incoming, response) => {
    let raw = ''; for await (const chunk of incoming) raw += chunk;
    captured.push({ url: incoming.url, cookie: incoming.headers.cookie, body: JSON.parse(raw) });
    response.writeHead(captured.length === 1 ? 200 : 403, { 'content-type': 'application/json' });
    response.end(JSON.stringify(captured.length === 1 ? fixture : { code: 'OBJECT_SCOPE_FORBIDDEN', error: '当前账号已失去读取权限。', traceId: 'assessment-trace' }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  process.env.JAVA_BACKEND_URL = `http://127.0.0.1:${server.address().port}`;
  context.after(() => { if (previous === undefined) delete process.env.JAVA_BACKEND_URL; else process.env.JAVA_BACKEND_URL = previous; server.close(); });
  const invoke = () => route.POST(new Request('http://web.local/api/analysis/sessions/session-old/objects/assess', {
    method: 'POST', headers: { cookie: 'dip3_session=test-only', 'content-type': 'application/json' }, body: JSON.stringify(fixture.selection),
  }));
  const result = await invoke(); assert.equal(result.status, 200); assert.deepEqual(await result.json(), fixture);
  assert.deepEqual(captured[0], { url: '/api/analysis/sessions/session-old/objects/assess', cookie: 'dip3_session=test-only', body: fixture.selection });
  const forbidden = await invoke(); assert.equal(forbidden.status, 403); assert.equal((await forbidden.json()).code, 'OBJECT_SCOPE_FORBIDDEN');
});

test('方案评估 | 客户端拒绝过期对象响应，Java 错误保留追踪 ID', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => Response.json(fixture);
  assert.deepEqual(await client.assessAnalysisScheme('session-old', fixture.selection), fixture);
  const stale = structuredClone(fixture); stale.selection.datasetVersionSetId = 'set-other';
  globalThis.fetch = async () => Response.json(stale);
  await assert.rejects(client.assessAnalysisScheme('session-old', fixture.selection), /选中的冻结区域不一致/);
  globalThis.fetch = async () => Response.json({ error: '授权范围已变更。', traceId: 'trace-assess' }, { status: 403 });
  await assert.rejects(client.assessAnalysisScheme('session-old', fixture.selection), /授权范围已变更.*trace-assess/);
});


test('方案结果直接渲染已保存比较，无加载占位；来源不一致明确报错', () => {
  const html = JSON.parse(execFileSync('node', ['--import', 'tsx', '--input-type=module', '-e', `
    import React from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { createRequire } from 'node:module';
    const { QueryClient, QueryClientProvider } = createRequire(import.meta.url)('@tanstack/react-query');
    import { readFileSync } from 'node:fs';
    import renderer from './src/app/(workspace)/workspace/analysis/[sessionId]/_components/renderer/render-scheme-comparison.tsx';
    const result = JSON.parse(readFileSync('contracts/backend/fixtures/scheme-assessment.json', 'utf8'));
    let requests = 0; globalThis.fetch = () => { requests++; throw new Error('Unexpected request'); };
    const input = { renderedBlock: { kind: 'scheme-comparison', source: { sessionId: 'session', executionId: result.selection.executionId }, payload: { result }, diagnostics: {} } };
    const render = (value) => renderToStaticMarkup(React.createElement(QueryClientProvider, { client: new QueryClient() }, renderer.renderSchemeComparisonBlock(value)));
    const saved = render(input);
    const corrupt = render({ ...input, renderedBlock: { ...input.renderedBlock, source: { sessionId: 'session', executionId: 'other' } } });
    console.log(JSON.stringify({ saved, corrupt, requests }));
  `], { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } }));
  assert.match(html.saved, /当前方案 · 源组件位置/);
  assert.match(html.saved, /候选方案 current/);
  assert.doesNotMatch(html.saved, /正在评估|正在检查/);
  assert.equal(html.requests, 0);
  assert.match(html.corrupt, /analysis-render-error/);
});
