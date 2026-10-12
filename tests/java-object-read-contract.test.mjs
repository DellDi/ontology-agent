import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import contracts from '../src/infrastructure/java-backend/object-read-contract.ts';
import objectClient from '../src/infrastructure/java-backend/object-read-client.ts';
import queryRoute from '../src/app/api/analysis/sessions/[sessionId]/objects/query/route.ts';

const { javaObjectReadRequestSchema, javaObjectReadResultSchema } = contracts;
const root = new URL('../contracts/backend/', import.meta.url);
const detail = JSON.parse(await readFile(new URL('fixtures/object-read-detail.json', root), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
addFormats(ajv);
for (const name of ['object-read-request', 'object-read-result']) {
  const schema = JSON.parse(await readFile(new URL(`schemas/${name}.schema.json`, root), 'utf8'));
  assert.equal(ajv.validateSchema(schema), true);
  ajv.addSchema(schema);
}
const request = {
  executionId: detail.executionId, datasetVersionSetId: detail.datasetVersionSetId,
  objectKey: 'easyv-prototype-layout', objectId: 'app-1',
};

test('组件外框属于授权页面，非法外框与未知字段不能被静默接受', () => {
  const result = { ...detail, structure: null, objectType: { ...detail.objectType, key: 'easyv-prototype-component' },
    page: { ...detail.page, objectKey: 'easyv-prototype-component', rows: [{ reference: { objectKey: 'easyv-prototype-component', objectId: '41:c1', productVersionId: 'components-old' }, properties: {} }] },
    componentGeometry: { '41:c1': { status: 'available', errorCode: null, box: { x: 66.66, y: 62.5, width: 33.34, height: 37.5 } } } };
  assert.equal(ajv.getSchema('object-read-result.schema.json')(result), true, ajv.errorsText());
  assert.equal(javaObjectReadResultSchema.safeParse(result).success, true);
  for (const geometry of [{ status: 'missing', errorCode: 'COMPONENT_BOX_MISSING', box: null },
    { status: 'invalid', errorCode: 'COMPONENT_BOX_BOUNDS_INVALID', box: null }]) {
    const body = { ...result, componentGeometry: { '41:c1': geometry } };
    assert.equal(ajv.getSchema('object-read-result.schema.json')(body), true, ajv.errorsText());
    assert.equal(javaObjectReadResultSchema.safeParse(body).success, true);
  }
  for (const mutate of [
    (body) => { body.componentGeometry['not-authorized'] = body.componentGeometry['41:c1']; },
    (body) => { body.componentGeometry['41:c1'].box.x = 90; },
    (body) => { body.componentGeometry['41:c1'].box.width = 0; },
    (body) => { body.componentGeometry['41:c1'].fallback = true; },
  ]) {
    const body = structuredClone(result); mutate(body);
    assert.equal(javaObjectReadResultSchema.safeParse(body).success, false);
  }
  delete result.componentGeometry;
  assert.equal(javaObjectReadResultSchema.safeParse(result).success, true, '滚动部署期间旧 API 响应可读取');
});

test('对象读取 | Java fixture 同时符合 JSON Schema 和严格 Zod', () => {
  for (const structure of [detail.structure, { status: 'not_retained', layout: null }, { status: 'parse_failed', layout: null }]) {
    const result = { ...detail, structure };
    assert.equal(ajv.getSchema('object-read-result.schema.json')(result), true, ajv.errorsText());
    assert.equal(javaObjectReadResultSchema.safeParse(result).success, true);
  }
  const empty = { ...detail, page: { ...detail.page, rows: [], limit: 50 }, structure: null };
  assert.equal(ajv.getSchema('object-read-result.schema.json')(empty), true);
  assert.equal(javaObjectReadResultSchema.safeParse(empty).success, true);
  for (const body of [request, { ...request, relation: 'blocks', filters: [{ member: 'schemeId', operator: 'EQUALS', values: ['4'] }], order: [{ member: 'blockKey', direction: 'ASC' }], limit: 20, offset: 0 }]) {
    assert.equal(ajv.getSchema('object-read-request.schema.json')(body), true);
    assert.equal(javaObjectReadRequestSchema.safeParse(body).success, true);
  }
});

test('对象读取 | AI 应用与原型对象共用同一契约，目录外对象与错配的专业附件被拒绝', () => {
  const application = { ...detail, structure: null, componentGeometry: {},
    objectType: { key: 'easyv-ai-application', label: 'AI 应用', links: [],
      properties: [{ key: 'appId', label: '应用 ID', type: 'STRING' }, { key: 'createdAt', label: '应用创建时间', type: 'TIME' }] },
    page: { ...detail.page, objectKey: 'easyv-ai-application', rows: [{
      reference: { objectKey: 'easyv-ai-application', objectId: 'app-1', productVersionId: 'apps-old' },
      properties: { appId: 'app-1', createdAt: '2026-10-08T01:00:00Z' } }] } };
  const toLayout = { ...detail, objectType: { ...detail.objectType, links: [...detail.objectType.links,
    { key: 'application', targetObjectKey: 'easyv-ai-application', targetLabel: 'AI 应用' }] } };
  for (const body of [application, toLayout]) {
    assert.equal(ajv.getSchema('object-read-result.schema.json')(body), true, ajv.errorsText());
    assert.equal(javaObjectReadResultSchema.safeParse(body).success, true);
  }
  const listRequest = { ...request, objectKey: 'easyv-ai-application', objectId: null };
  assert.equal(ajv.getSchema('object-read-request.schema.json')(listRequest), true);
  assert.equal(javaObjectReadRequestSchema.safeParse(listRequest).success, true);
  for (const body of [{ ...listRequest, objectKey: 'easyv-scheme-library' },
    { ...request, objectKey: 'easyv-ai-application', includeComponentSummary: true }]) {
    assert.equal(ajv.getSchema('object-read-request.schema.json')(body), false);
    assert.equal(javaObjectReadRequestSchema.safeParse(body).success, false);
  }
  for (const mutate of [
    (body) => { body.objectType.key = 'easyv-scheme-library'; body.page.objectKey = 'easyv-scheme-library'; body.page.rows[0].reference.objectKey = 'easyv-scheme-library'; },
    (body) => { body.structure = { status: 'not_retained', layout: null }; },
    (body) => { body.componentSummary = { total: 0, groups: [] }; },
    (body) => { body.componentGeometry = { 'app-1': { status: 'missing', errorCode: 'COMPONENT_BOX_MISSING', box: null } }; },
  ]) {
    const body = structuredClone(application); mutate(body);
    assert.equal(javaObjectReadResultSchema.safeParse(body).success, false);
  }
  assert.equal(contracts.javaObjectSelectionSchema.safeParse({ executionId: 'execution-old', datasetVersionSetId: 'set-old',
    reference: { objectKey: 'easyv-ai-application', objectId: 'app-1', productVersionId: 'apps-old' } }).success, true);
});

test('对象读取 | 拒绝无执行/冻结集、越界分页、SQL 字段和损坏结构', () => {
  for (const mutate of [
    (body) => { delete body.executionId; },
    (body) => { delete body.datasetVersionSetId; },
    (body) => { body.limit = 201; },
    (body) => { body.offset = -1; },
    (body) => { body.sql = 'select *'; },
    (body) => { body.scope = { all: true }; },
  ]) {
    const body = structuredClone(request); mutate(body);
    assert.equal(ajv.getSchema('object-read-request.schema.json')(body), false);
    assert.equal(javaObjectReadRequestSchema.safeParse(body).success, false);
  }
  for (const mutate of [
    (result) => { delete result.page.rows[0].reference.productVersionId; },
    (result) => { result.structure.layout.children[0].attributes.width = 1920; },
    (result) => { delete result.structure.layout.children; },
    (result) => { result.structure = { status: 'parse_failed', layout: detail.structure.layout }; },
    (result) => { result.sql = 'select *'; },
  ]) {
    const result = structuredClone(detail); mutate(result);
    assert.equal(ajv.getSchema('object-read-result.schema.json')(result), false);
    assert.equal(javaObjectReadResultSchema.safeParse(result).success, false);
  }
  const wrongType = structuredClone(detail);
  wrongType.page.rows[0].reference.objectKey = 'easyv-prototype-component';
  assert.equal(javaObjectReadResultSchema.safeParse(wrongType).success, false);
});

test('对象读取 | BFF 原样透传路径、Cookie、冻结上下文和 Java 错误', async (context) => {
  const originalUrl = process.env.JAVA_BACKEND_URL;
  const captured = [];
  const server = createServer(async (incoming, response) => {
    let raw = ''; for await (const chunk of incoming) raw += chunk;
    captured.push({ url: incoming.url, cookie: incoming.headers.cookie, body: JSON.parse(raw) });
    response.writeHead(captured.length === 1 ? 200 : 409, { 'content-type': 'application/json' });
    response.end(JSON.stringify(captured.length === 1 ? detail : {
      code: 'OBJECT_VERSION_MISMATCH', error: '请求冻结集合与来源执行不一致。', traceId: 'trace-object',
    }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  process.env.JAVA_BACKEND_URL = `http://127.0.0.1:${server.address().port}`;
  context.after(() => { if (originalUrl === undefined) delete process.env.JAVA_BACKEND_URL;
    else process.env.JAVA_BACKEND_URL = originalUrl; server.close(); });
  const invoke = (body) => queryRoute.POST(new Request('http://web.local/api/analysis/sessions/session-old/objects/query', {
    method: 'POST', headers: { cookie: 'dip3_session=test-only', 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
  const success = await invoke(request);
  assert.equal(success.status, 200);
  assert.deepEqual(await success.json(), detail);
  assert.deepEqual(captured[0], { url: '/api/analysis/sessions/session-old/objects/query', cookie: 'dip3_session=test-only', body: request });
  const mismatch = await invoke({ ...request, datasetVersionSetId: 'set-forged' });
  assert.equal(mismatch.status, 409);
  assert.equal((await mismatch.json()).code, 'OBJECT_VERSION_MISMATCH');
  assert.equal(captured[1].body.datasetVersionSetId, 'set-forged');
});


test('组件构成 | 全量数量、空值和未知族必须保留，分类条件与统计一致', () => {
  const groups = [
    { chartFamily: 'table', count: 250, filter: { member: 'chartFamily', operator: 'EQUALS', values: ['table'] } },
    { chartFamily: 'future-chart', count: 2, filter: { member: 'chartFamily', operator: 'EQUALS', values: ['future-chart'] } },
    { chartFamily: null, count: 1, filter: { member: 'chartFamily', operator: 'NOT_SET', values: [] } },
  ];
  const full = { ...detail, componentSummary: { total: 253, groups } };
  for (const body of [full, { ...detail, componentSummary: { total: 0, groups: [] } }]) {
    assert.equal(ajv.getSchema('object-read-result.schema.json')(body), true, ajv.errorsText());
    assert.equal(javaObjectReadResultSchema.safeParse(body).success, true);
  }
  for (const mutate of [
    (body) => { body.componentSummary.total = 3; },
    (body) => { body.componentSummary.groups[0].filter.values = ['line']; },
    (body) => { body.componentSummary.groups[2].filter.operator = 'EQUALS'; },
    (body) => { body.componentSummary.groups.push(body.componentSummary.groups[0]); },
    (body) => { body.dataContext.capturedAt = 'invalid'; },
    (body) => { body.dataContext.connectorPassword = 'not-allowed'; },
    (body) => { body.componentSummary.groups[0].count = 1.5; },
  ]) {
    const body = structuredClone(full); mutate(body);
    assert.equal(javaObjectReadResultSchema.safeParse(body).success, false);
  }
  const legacy = structuredClone(detail); delete legacy.componentSummary; delete legacy.dataContext;
  assert.equal(javaObjectReadResultSchema.safeParse(legacy).success, true, '旧 API 不补造统计或时间');
  assert.equal(ajv.getSchema('object-read-request.schema.json')({ ...request, includeComponentSummary: true }), true);
  for (const body of [{ ...request, objectKey: 'easyv-prototype-component', includeComponentSummary: true }, { ...request, relation: 'components', includeComponentSummary: true }, { ...request, objectId: null, includeComponentSummary: true }]) {
    assert.equal(ajv.getSchema('object-read-request.schema.json')(body), false);
    assert.equal(javaObjectReadRequestSchema.safeParse(body).success, false);
  }
});


test('组件构成 | 请求统计后不能接受缺失统计或属于其他对象的响应', async (context) => {
  const original = globalThis.fetch; context.after(() => { globalThis.fetch = original; });
  const complete = { ...detail, componentSummary: { total: 0, groups: [] } };
  const invoke = () => objectClient.readAnalysisObjects('session-old', { ...request, includeComponentSummary: true }, new AbortController().signal);
  globalThis.fetch = async () => Response.json(complete);
  assert.equal((await invoke()).componentSummary.total, 0);
  for (const mutate of [
    (body) => { delete body.componentSummary; },
    (body) => { body.dataContext = null; },
    (body) => { body.page.rows[0].reference.objectId = 'other-app'; },
  ]) {
    const body = structuredClone(complete); mutate(body); globalThis.fetch = async () => Response.json(body);
    await assert.rejects(invoke(), /缺少统计或数据出处，或与所选对象不一致/);
  }
});

test('对象详情 | 业务呈现绑定同一授权文本属性，原始源值保留且不接受执行内容', () => {
  const result = { ...detail, structure: null, propertyPresentations: {
    themes: { items: [{ label: '模块', value: '算力监控' }], notice: '这是系统当时的理解，仍需核对。' },
  }, objectType: { key: 'easyv-quality-node', label: '需求与处理记录', links: [], properties: [
    { key: 'themes', label: '生成模块与约束', type: 'STRING' },
    { key: 'nodeId', label: '节点 ID', type: 'STRING', identifier: true },
  ] }, page: { objectKey: 'easyv-quality-node', rows: [{
    reference: { objectKey: 'easyv-quality-node', objectId: 'node-1', productVersionId: 'nodes-old' },
    properties: { themes: '[{"businessModule":"算力监控"}]', nodeId: 'node-1' },
  }], limit: 1, offset: 0, hasMore: false } };
  assert.equal(ajv.getSchema('object-read-result.schema.json')(result), true, ajv.errorsText());
  assert.equal(javaObjectReadResultSchema.safeParse(result).success, true);
  for (const mutate of [
    (body) => { body.propertyPresentations.themes.items[0].html = '<script>run()</script>'; },
    (body) => { body.propertyPresentations.themes.notice = ''; },
    (body) => { body.propertyPresentations.themes.items[0].value = ''; },
  ]) {
    const body = structuredClone(result); mutate(body);
    assert.equal(ajv.getSchema('object-read-result.schema.json')(body), false);
    assert.equal(javaObjectReadResultSchema.safeParse(body).success, false);
  }
  for (const mutate of [
    (body) => { body.propertyPresentations.nodeId = body.propertyPresentations.themes; },
    (body) => { body.propertyPresentations.notDeclared = body.propertyPresentations.themes; },
    (body) => { delete body.page.rows[0].properties.themes; },
    (body) => { body.page.rows.push(body.page.rows[0]); body.page.limit = 2; },
    (body) => { body.objectType.properties[0].type = 'NUMBER'; },
  ]) {
    const body = structuredClone(result); mutate(body);
    assert.equal(javaObjectReadResultSchema.safeParse(body).success, false);
  }
  result.propertyPresentations.themes.items = [];
  result.propertyPresentations.themes.notice = '格式无法识别，请展开源记录核对。';
  assert.equal(javaObjectReadResultSchema.safeParse(result).success, true, 'invalid source is diagnosed without a fabricated interpretation');
});

test('对象客户端允许当前数据版本不同于历史来源，但拒绝其他执行的响应', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ ...detail, datasetVersionSetId: 'set-latest' });
    const current = await objectClient.readAnalysisObjects('session-old', request, new AbortController().signal);
    assert.equal(current.datasetVersionSetId, 'set-latest');
    assert.equal(current.executionId, request.executionId);
    globalThis.fetch = async () => Response.json({ ...detail, datasetVersionSetId: 'set-latest', executionId: 'other-execution' });
    await assert.rejects(() => objectClient.readAnalysisObjects('session-old', request, new AbortController().signal), /来源执行不一致/);
  } finally { globalThis.fetch = original; }
});


test('对象读取 | 时间线声明同时符合两份契约，缺少来源说明和未知字段被拒绝', () => {
  const body = structuredClone(detail);
  body.objectType.links[0].timeline = { title: '操作记录时间线', timeProperty: 'operatedAt', notice: '记录时间不代表实际修改时间。' };
  for (const timeline of [body.objectType.links[0].timeline, null]) {
    const result = structuredClone(body); result.objectType.links[0].timeline = timeline;
    assert.equal(ajv.getSchema('object-read-result.schema.json')(result), true, ajv.errorsText());
    assert.equal(javaObjectReadResultSchema.safeParse(result).success, true);
  }
  for (const mutate of [(timeline) => { delete timeline.notice; }, (timeline) => { timeline.timeProperty = ''; },
    (timeline) => { timeline.fallback = true; }]) {
    const result = structuredClone(body); mutate(result.objectType.links[0].timeline);
    assert.equal(ajv.getSchema('object-read-result.schema.json')(result), false);
    assert.equal(javaObjectReadResultSchema.safeParse(result).success, false);
  }
});
