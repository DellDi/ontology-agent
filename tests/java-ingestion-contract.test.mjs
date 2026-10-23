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
  const draft = structuredClone(fixture);
  draft.releases[0].status = 'draft'; draft.releases[0].frozenAt = null;
  draft.releases[0].products[0].sources[0].startedAt = null;
  draft.releases[0].products[0].sources[0].finishedAt = null;
  check(draft, true);
  for (const mutate of [
    value => { value.sources[0].connectionRef = 'private'; },
    value => { value.runs[0].errorDetail = { password: 'private' }; },
    value => { value.runs[0].status = 'success'; },
    value => { value.runs[0].createdAt = 'invalid-date'; },
    value => { delete value.releases[0].products[0].sources[0].runId; },
    value => { value.scope = 'unknown'; },
    value => { value.releases[0].frozenAt = 'invalid-date'; },
    value => { value.releases[0].products[0].sources[0].finishedAt = 'invalid-date'; },
    value => { delete value.releases[0].products[0].sources[0].startedAt; },
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
    for (const mutate of [task => { task.triggerType = 'cron'; }, task => { delete task.triggerType; }]) {
      const broken = structuredClone(fixture);
      mutate(broken.items ? broken.items[0] : broken);
      assert.equal(validate(broken), false);
      assert.equal(zod.safeParse(broken).success, false);
    }
  }
  const list = await read('../contracts/backend/fixtures/ingestion-release-task-list.json');
  assert.deepEqual(list.items.map(task => task.triggerType), ['manual', 'scheduled']);
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


test('版本血缘展示区分输入采集时间与发布时间，旧输入不被新发布冒充', async () => {
  const { execFileSync } = await import('node:child_process');
  const html = execFileSync('node', ['--import', 'tsx', '--input-type=module', '-e', `
    import React from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { readFileSync } from 'node:fs';
    import workbench from './src/app/(admin)/admin/ingestion/ingestion-workbench.tsx';
    const overview = JSON.parse(readFileSync('./contracts/backend/fixtures/ingestion-overview.json', 'utf8'));
    console.log(renderToStaticMarkup(React.createElement(workbench.IngestionWorkbench, {
      overview, releaseTasks: [], initialView: 'releases',
      access: { canView: true, canManage: false, sourceKeys: ['property'], grants: [] },
    })));
  `], { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } });
  assert.match(html, /输入采集开始/);
  assert.match(html, /输入采集完成/);
  assert.match(html, /发布完成时间/);
  assert.match(html, /2026\/09\/10 09:00/);
  assert.match(html, /2026\/09\/10 09:05/);
  assert.match(html, /2026\/09\/12 09:10/);
  assert.match(html, /这些时间不代表最近一次采集检查/);
});

test('数据健康契约 | 保留旧发布与最新失败，缺失时间不伪造，拒绝连接和原始错误', async () => {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(await read('../contracts/backend/schemas/ingestion-health.schema.json'));
  const fixture = await read('../contracts/backend/fixtures/ingestion-health.json');
  const check = (value, expected) => {
    assert.equal(validate(value), expected, ajv.errorsText());
    assert.equal(schemas.ingestionHealthSchema.safeParse(value).success, expected);
  };
  check(fixture, true);
  const missing = structuredClone(fixture);
  Object.assign(missing.products[0], { published: null, latestRun: null, lastSuccessfulCheckAt: null });
  check(missing, true);
  for (const mutate of [
    product => { product.connectionRef = 'private'; },
    product => { product.latestRun.errorDetail = { password: 'private' }; },
    product => { product.lastSuccessfulCheckAt = 'invalid'; },
    product => { product.published.rowCount = -1; },
    product => { delete product.latestRun; },
  ]) {
    const invalid = structuredClone(fixture);
    mutate(invalid.products[0]);
    check(invalid, false);
  }
});

test('数据健康呈现 | 最近任务失败保留已有版本，空发布和零条记录分别展示', async () => {
  const { execFileSync } = await import('node:child_process');
  const html = execFileSync('node', ['--import', 'tsx', '--input-type=module', '-e', `
    import React from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { readFileSync } from 'node:fs';
    import panel from './src/app/(admin)/admin/ingestion/ingestion-health-panel.tsx';
    const health = JSON.parse(readFileSync('./contracts/backend/fixtures/ingestion-health.json', 'utf8'));
    const empty = structuredClone(health.products[0]);
    Object.assign(empty, { key: 'empty-product', published: null, latestRun: null, lastSuccessfulCheckAt: null });
    const zero = structuredClone(health.products[0]);
    zero.key = 'zero-product'; zero.published.rowCount = 0;
    health.products.push(empty, zero);
    console.log(renderToStaticMarkup(React.createElement(panel.IngestionHealthPanel, { health, onInspectRuns: () => {} })));
  `], { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } });
  assert.match(html, /最近任务失败/);
  assert.match(html, /上一发布版本仍保留/);
  assert.match(html, /尚无成功检查记录/);
  assert.match(html, /尚无发布版本/);
  assert.match(html, /发布版本含 0 条记录/);
  assert.match(html, /没有配置新鲜度时限/);
});

test('失败巡检契约 | 分开状态变化与首次可见，严格保留版本和缺失时间', async () => {
  const inspection = await import('../src/infrastructure/java-backend/inspection-schema.ts');
  const ajv = new Ajv2020({ strict: true, allErrors: true }); addFormats(ajv);
  const validate = ajv.compile(await read('../contracts/backend/schemas/failure-inspection.schema.json'));
  const fixture = await read('../contracts/backend/fixtures/failure-inspection.json');
  const check = (value, expected) => {
    assert.equal(validate(value), expected, ajv.errorsText());
    assert.equal(inspection.failureInspectionSchema.safeParse(value).success, expected);
  };
  check(fixture, true);
  for (const change of ['CHANGED_TO_FAILED','FIRST_VISIBLE_FAILURE','FAILED_IN_BOTH','NO_BASELINE']) {
    const value = structuredClone(fixture); value.failures[0].change = change; value.failures[0].previousStatus = null; check(value, true);
  }
  const empty = structuredClone(fixture); empty.baseline = null; empty.failures = []; check(empty, true);
  for (const mutate of [
    value => { value.scopeLabel = ''; }, value => { value.summary.totalFailures = -1; },
    value => { value.failures[0].change = 'NEW_ROOT_CAUSE'; },
    value => { value.failures[0].reference.productVersionId = ''; },
    value => { value.failures[0].reference.objectKey = 'free-sql'; },
    value => { value.failures[0].createdAt = 'not-a-date'; },
    value => { value.connectionRef = 'private'; }, value => { value.failures[0].sql = 'private'; },
    value => { value.limit = 1000; }, value => { delete value.hasMore; },
  ]) { const broken = structuredClone(fixture); mutate(broken); check(broken, false); }
});

test('失败巡检页面 | 解释空范围、无对比版本、首次可见与后续分析边界', async () => {
  const { execFileSync } = await import('node:child_process');
  const html = execFileSync('node', ['--import','tsx','--input-type=module','-e', `
    import React from 'react'; import { renderToStaticMarkup } from 'react-dom/server';
    import { readFileSync } from 'node:fs';
    import view from './src/app/(workspace)/workspace/inspection/inspection-view.tsx';
    const report=JSON.parse(readFileSync('./contracts/backend/fixtures/failure-inspection.json','utf8'));
    console.log(renderToStaticMarkup(React.createElement(view.InspectionView,{report})));
    report.baseline=null; report.failures=[];report.summary.totalFailures=0;
    console.log(renderToStaticMarkup(React.createElement(view.InspectionView,{report})));
  `], { encoding:'utf8',env:{...process.env,NODE_OPTIONS:''} });
  assert.match(html,/首次可见不等于刚刚发生/);
  assert.match(html,/当前可见范围内没有符合上述口径/);
  assert.match(html,/尚无更早的完整冻结版本/);
  assert.match(html,/不等于已验证的根因/);
  assert.match(html,/后续分析按当时最新发布数据读取/);
  assert.match(html,/\/workspace\?draft=/);
  assert.match(html,/task-a/);
});

test('失败巡检 BFF | 保留冻结版本和分页，只透传会话 Cookie', async context => {
  const { createServer } = await import('node:http'); const { once } = await import('node:events');
  const { forwardJavaBackendRequest } = await import('../src/infrastructure/java-backend/client.ts');
  const old = process.env.JAVA_BACKEND_URL; const seen=[];
  const fixture = await read('../contracts/backend/fixtures/failure-inspection.json');
  const server=createServer((request,response) => { seen.push({url:request.url,cookie:request.headers.cookie}); response.writeHead(200,{'Content-Type':'application/json'}); response.end(JSON.stringify(fixture)); });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  context.after(() => { server.close(); if(old===undefined) delete process.env.JAVA_BACKEND_URL; else process.env.JAVA_BACKEND_URL=old; });
  process.env.JAVA_BACKEND_URL=`http://127.0.0.1:${server.address().port}`;
  const response=await forwardJavaBackendRequest(new Request('http://next.local/api/easyv/inspection?setId=set-current&offset=50',{headers:{cookie:'dip3_session=signed; private=omit'}}));
  assert.equal(response.status,200); assert.deepEqual(await response.json(),fixture);
  assert.deepEqual(seen,[{url:'/api/easyv/inspection?setId=set-current&offset=50',cookie:'dip3_session=signed'}]);
});
