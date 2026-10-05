import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import Ajv2020 from 'ajv/dist/2020.js';
import contracts from '../src/infrastructure/java-backend/object-read-contract.ts';
import queryRoute from '../src/app/api/analysis/sessions/[sessionId]/objects/query/route.ts';

const { javaObjectReadRequestSchema, javaObjectReadResultSchema } = contracts;
const root = new URL('../contracts/backend/', import.meta.url);
const detail = JSON.parse(await readFile(new URL('fixtures/object-read-detail.json', root), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
for (const name of ['object-read-request', 'object-read-result']) {
  const schema = JSON.parse(await readFile(new URL(`schemas/${name}.schema.json`, root), 'utf8'));
  assert.equal(ajv.validateSchema(schema), true);
  ajv.addSchema(schema);
}
const request = {
  executionId: detail.executionId, datasetVersionSetId: detail.datasetVersionSetId,
  objectKey: 'easyv-prototype-layout', objectId: 'app-1',
};

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
