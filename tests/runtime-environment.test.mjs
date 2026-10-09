import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import Ajv2020 from 'ajv/dist/2020.js';
import schemaModule from '../src/infrastructure/java-backend/runtime-environment-schema.ts';
import presentation from '../src/application/runtime-environment/presentation.ts';

const { runtimeEnvironmentSchema } = schemaModule;
const { environmentBadge, environmentTitle } = presentation;
const root = new URL('../contracts/backend/', import.meta.url);
const fixture = JSON.parse(await readFile(new URL('fixtures/runtime-environment.json', root), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addSchema(JSON.parse(await readFile(new URL('schemas/runtime-environment.schema.json', root), 'utf8')));
const validate = ajv.getSchema('runtime-environment.schema.json');
const env = (patch) => ({ ...fixture, ...patch });

test('运行环境 | Java 契约样本同时满足 JSON Schema 与严格 Zod，非管理员的库地址为空', () => {
  for (const body of [fixture, env({ database: null }), env({ name: 'easyv-dev', label: '公司验收 easyv-dev', kind: 'shared' }),
    env({ name: 'production', label: '生产', kind: 'production', database: null }), env({ remoteDatabase: true })]) {
    assert.equal(validate(body), true, ajv.errorsText(validate.errors));
    assert.equal(runtimeEnvironmentSchema.safeParse(body).success, true);
  }
  for (const mutate of [(b) => { b.name = 'Local Dev'; }, (b) => { b.kind = 'staging'; }, (b) => { b.label = ''; },
    (b) => { b.database.port = 0; }, (b) => { b.database.password = 'x'; }, (b) => { b.extra = 1; }, (b) => { delete b.remoteDatabase; },
    (b) => { delete b.database; }]) {
    const body = structuredClone(fixture); mutate(body);
    assert.equal(validate(body), false);
    assert.equal(runtimeEnvironmentSchema.safeParse(body).success, false);
  }
});

test('运行环境 | 标识按环境类型区分，未知与远程库显式告警，生产不打扰', () => {
  assert.deepEqual(environmentBadge(fixture), { text: '本地开发', tone: 'local', title: '本地开发 · local-dev' });
  assert.deepEqual(environmentBadge(env({ name: 'easyv-dev', label: '公司验收 easyv-dev', kind: 'shared' })),
    { text: '公司验收 easyv-dev', tone: 'shared', title: '公司验收 easyv-dev · easyv-dev' });
  assert.equal(environmentBadge(env({ name: 'production', label: '生产', kind: 'production' })), null);
  const remote = environmentBadge(env({ remoteDatabase: true }));
  assert.equal(remote.tone, 'warning');
  assert.match(remote.text, /本地开发 · 连接远程库/);
  const unknown = environmentBadge(null);
  assert.equal(unknown.tone, 'warning');
  assert.equal(unknown.text, '环境未知');
});

test('运行环境 | 浏览器标签页标题带环境前缀，生产保持原标题', () => {
  assert.equal(environmentTitle(fixture), '[本地开发] DIP3 - 智慧数据');
  assert.equal(environmentTitle(null), '[环境未知] DIP3 - 智慧数据');
  assert.equal(environmentTitle(env({ name: 'production', label: '生产', kind: 'production' })), null);
});

const html = JSON.parse(execFileSync('node', ['--import', 'tsx', '--input-type=module', '-e', `
  import React from 'react';
  import { renderToStaticMarkup } from 'react-dom/server';
  import badge from './src/app/_components/environment-badge.tsx';
  const env = ${JSON.stringify(fixture)};
  const render = (element) => renderToStaticMarkup(element);
  console.log(JSON.stringify({
    badge: render(React.createElement(badge.EnvironmentBadge, { environment: env })),
    production: render(React.createElement(badge.EnvironmentBadge, { environment: { ...env, name: 'production', label: '生产', kind: 'production' } })),
    unknown: render(React.createElement(badge.EnvironmentBadge, { environment: null })),
    detailsAdmin: render(React.createElement(badge.EnvironmentDetails, { environment: env })),
    detailsUser: render(React.createElement(badge.EnvironmentDetails, { environment: { ...env, database: null } })),
    detailsUnknown: render(React.createElement(badge.EnvironmentDetails, { environment: null })),
  }));
`], { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } }));

test('运行环境 | 徽标作为状态提示渲染，生产不渲染，未知环境带告警说明', () => {
  assert.match(html.badge, /role="status"/);
  assert.match(html.badge, /title="本地开发 · local-dev"/);
  assert.match(html.badge, />本地开发</);
  assert.equal(html.production, '');
  assert.match(html.unknown, />环境未知</);
  assert.match(html.unknown, /title="无法读取运行环境/);
});

test('运行环境 | 设置里的环境详情：管理员可见库地址，其余账号只看到环境，未知时说明原因', () => {
  assert.match(html.detailsAdmin, /local-dev/);
  assert.match(html.detailsAdmin, /127\.0\.0\.1:55432\/ontology_agent_local/);
  assert.match(html.detailsAdmin, /docs\/environments\.md/);
  assert.doesNotMatch(html.detailsUser, /55432|ontology_agent_local/);
  assert.match(html.detailsUser, /仅平台管理员可见/);
  assert.match(html.detailsUnknown, /无法读取运行环境/);
});
