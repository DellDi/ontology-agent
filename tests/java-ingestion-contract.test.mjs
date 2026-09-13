import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import schemas from '../src/infrastructure/java-backend/ingestion-schema.ts';

const read = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));

test('ingestion contract accepts lineage and rejects leaked fields or malformed states', async () => {
  const schema = await read('../contracts/backend/schemas/ingestion-overview.schema.json');
  const fixture = await read('../contracts/backend/fixtures/ingestion-overview.json');
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const check = (value, expected) => {
    assert.equal(validate(value), expected, ajv.errorsText());
    assert.equal(schemas.ingestionOverviewSchema.safeParse(value).success, expected);
  };
  check(fixture, true);
  check({ ...fixture, runs: [], releases: [] }, true);
  for (const mutate of [
    value => { value.sources[0].connectionRef = 'private'; },
    value => { value.runs[0].errorDetail = { password: 'private' }; },
    value => { value.runs[0].status = 'success'; },
    value => { value.runs[0].createdAt = 'invalid-date'; },
    value => { delete value.releases[0].products[0].sources[0].runId; },
    value => { value.scope = 'unknown'; },
  ]) {
    const invalid = structuredClone(fixture);
    mutate(invalid);
    check(invalid, false);
  }
});

test('release task fixtures keep durable status and actor credentials out of the response', async () => {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  for (const [name, zod] of [['ingestion-release-task', schemas.ingestionReleaseTaskSchema], ['ingestion-release-task-list', schemas.ingestionReleaseTaskListSchema]]) {
    const validate = ajv.compile(await read(`../contracts/backend/schemas/${name}.schema.json`));
    const fixture = await read(`../contracts/backend/fixtures/${name}.json`);
    assert.equal(validate(fixture), true, ajv.errorsText());
    assert.equal(zod.safeParse(fixture).success, true);
    const invalid = structuredClone(fixture);
    const task = invalid.items ? invalid.items[0] : invalid;
    task.sessionId = 'private-session';
    assert.equal(validate(invalid), false);
    assert.equal(zod.safeParse(invalid).success, false);
  }
});

test('release BFF preserves JSON, authenticated cookie, request key and accepted status', async context => {
  const { createServer } = await import('node:http');
  const { once } = await import('node:events');
  const client = await import('../src/infrastructure/java-backend/client.ts');
  const { forwardJavaBackendRequest } = client;
  const oldUrl = process.env.JAVA_BACKEND_URL;
  const fixture = await read('../contracts/backend/fixtures/ingestion-release-task.json');
  const seen = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    seen.push({ url: request.url, headers: request.headers, body: Buffer.concat(chunks).toString() });
    response.writeHead(202, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(fixture));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  context.after(() => { server.close(); if (oldUrl === undefined) delete process.env.JAVA_BACKEND_URL; else process.env.JAVA_BACKEND_URL = oldUrl; });
  process.env.JAVA_BACKEND_URL = `http://127.0.0.1:${server.address().port}`;
  const body = JSON.stringify({ sourceKey: 'property', productKeys: ['property-payment'], mode: 'full' });
  const response = await forwardJavaBackendRequest(new Request('http://next.local/api/admin/ingestion/release-tasks', {
    method: 'POST', headers: { Cookie: 'dip3_session=signed; private=omit', 'Content-Type': 'application/json', 'Idempotency-Key': fixture.id }, body,
  }));
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), fixture);
  assert.equal(seen[0].url, '/api/admin/ingestion/release-tasks');
  assert.equal(seen[0].headers.cookie, 'dip3_session=signed');
  assert.equal(seen[0].headers['idempotency-key'], fixture.id);
  assert.equal(seen[0].body, body);
});
