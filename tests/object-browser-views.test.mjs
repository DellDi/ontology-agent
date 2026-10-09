import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const rendered = JSON.parse(execFileSync('node', ['--import', 'tsx', '--input-type=module', '-e', `
  import React from 'react';
  import { renderToStaticMarkup } from 'react-dom/server';
  import { createRequire } from 'node:module';
  // tsx 将组件按 CJS 加载；同一份 react-query 实例才能共享 QueryClient 上下文。
  const { QueryClient, QueryClientProvider } = createRequire(import.meta.url)('@tanstack/react-query');
  import browser from './src/app/(workspace)/workspace/analysis/[sessionId]/_components/renderer/render-object-browser.tsx';
  import collection from './src/app/(workspace)/workspace/analysis/[sessionId]/_components/renderer/object-collection-controls.tsx';

  const base = { executionId: 'execution-old', datasetVersionSetId: 'set-old' };
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  const seed = (query, objectType, row) => client.setQueryData(['analysis-object', 'session-old', { ...base, ...query }], {
    ...base, ontologyVersionId: 'ontology-old', objectType,
    page: { objectKey: objectType.key, rows: [row], limit: query.limit ?? 50, offset: 0, hasMore: false }, structure: null,
    dataContext: { capturedAt: '2026-10-08T02:00:00Z', scopeDescription: 'EasyV 用户 16 的数据' } });
  const application = (links) => ({ key: 'easyv-ai-application', label: 'AI 应用', links, properties: [
    { key: 'appId', label: '应用 ID', type: 'STRING' }, { key: 'createdAt', label: '应用创建时间', type: 'TIME' },
    { key: 'scopeType', label: '归属类型', type: 'STRING' }] });
  const appRow = { reference: { objectKey: 'easyv-ai-application', objectId: 'app-1', productVersionId: 'apps-old' },
    properties: { appId: 'app-1', createdAt: '2026-10-08T01:00:00Z', scopeType: 'USER' } };
  const layoutRow = { reference: { objectKey: 'easyv-prototype-layout', objectId: 'app-1', productVersionId: 'layouts-old' },
    properties: { appId: 'app-1', parseStatus: 'ok' } };
  const layoutType = { key: 'easyv-prototype-layout', label: '原型版式', links: [], properties: [{ key: 'appId', label: '应用 ID', type: 'STRING' }] };

  const render = (objectKey) => renderToStaticMarkup(React.createElement(QueryClientProvider, { client },
    browser.renderObjectBrowserBlock({ renderedBlock: { kind: 'object-browser', payload: { datasetVersionSetId: 'set-old', objectKey, filters: [],
      scopeDescription: '本次查询当前期的对象范围' }, source: { sourceType: 'execution-render-block', sessionId: 'session-old', executionId: 'execution-old' } },
      onObjectSelect: () => {} })));
  const out = {};
  const seedApplication = (links) => {
    client.clear();
    seed({ objectKey: 'easyv-ai-application', filters: [], limit: 20, offset: 0 }, application(links), appRow);
    seed({ objectKey: 'easyv-ai-application', objectId: 'app-1' }, application(links), appRow);
  };
  seedApplication([]); out.application = render('easyv-ai-application');
  seedApplication([{ key: 'prototype', targetObjectKey: 'easyv-prototype-layout', targetLabel: '原型版式' }]); out.linked = render('easyv-ai-application');
  client.clear(); seed({ objectKey: 'easyv-prototype-layout', filters: [], limit: 20, offset: 0 }, layoutType, layoutRow);
  out.layout = render('easyv-prototype-layout');
  client.clear(); out.pending = render('easyv-ai-application');
  const declared = application([]).properties;
  const controlsHtml = (state, maxFilters = 5) => renderToStaticMarkup(React.createElement(collection.ObjectCollectionControls,
    { properties: declared, controls: state, maxFilters, onChange: () => {} }));
  out.idle = controlsHtml({ order: null, filters: [] });
  out.active = controlsHtml({ order: { member: 'createdAt', direction: 'DESC' }, filters: [
    { member: 'scopeType', operator: 'EQUALS', values: ['USER'] }, { member: 'createdAt', operator: 'GTE', values: ['2026-10-08T00:00:00+08:00'] }] });
  out.full = controlsHtml({ order: null, filters: [{ member: 'scopeType', operator: 'SET', values: [] }] }, 1);
  console.log(JSON.stringify(out));
`], { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } }));

test('对象浏览 | AI 应用复用通用集合与详情，属性来自声明，不进入原型专业视图', () => {
  const html = rendered.application;
  assert.match(html, /AI 应用 · 1/);
  assert.match(html, /应用创建时间 2026\/10\/08 09:00:00/, '列表摘要来自第一个时间属性，按北京时间展示');
  assert.match(html, /<dt[^>]*>归属类型<\/dt><dd[^>]*>USER<\/dd>/);
  assert.match(html, /<dt[^>]*>应用创建时间<\/dt><dd[^>]*>2026\/10\/08 09:00:00<\/dd>/, 'TIME 属性不展示原始 ISO');
  assert.match(html, /针对这个对象追问/);
  assert.match(html, /数据出处与版本/);
  assert.doesNotMatch(html, /版式属性|结构示意|原型区域列表|查看原型版式/);
  assert.doesNotMatch(html, /查看/, '没有声明关系时不补造关系入口');
});

test('对象浏览 | 关系入口随本体声明出现，无需新增渲染器', () => {
  assert.match(rendered.linked, /查看原型版式/);
});

test('对象浏览 | 原型对象仍使用专业组合', () => {
  assert.match(rendered.layout, /原型 app-1/);
  assert.match(rendered.layout, /版式属性/);
});

test('对象浏览 | 排序与筛选控件由声明的属性生成，默认折叠且不产生已启用条件', () => {
  const html = rendered.application;
  assert.match(html, /排序与筛选/);
  assert.match(html, /<option value=""[^>]*>默认顺序<\/option>/);
  assert.match(html, /<option value="createdAt"[^>]*>应用创建时间<\/option>/);
  assert.doesNotMatch(html, /已启用的排序与筛选/);
  assert.match(rendered.idle, /<option value="CONTAINS"[^>]*>包含<\/option>/, '首个属性为文本，默认提供文本算子');
  assert.match(rendered.layout, /排序与筛选/, '原型集合沿用同一控件');
  assert.doesNotMatch(rendered.pending, /排序与筛选/, '尚未读到字段声明时不展示控件');
  assert.match(rendered.pending, /正在读取本轮对象/);
});

test('对象浏览 | 已启用的排序与筛选以可移除的条件展示，并提示数量上限', () => {
  const html = rendered.active;
  assert.match(html, /排序与筛选 · 3/);
  assert.match(html, /按应用创建时间降序/);
  assert.match(html, /aria-label="取消排序"/);
  assert.match(html, /aria-label="移除筛选：归属类型 等于 USER"/);
  assert.match(html, /aria-label="移除筛选：应用创建时间 不早于 2026-10-08"/);
  assert.match(html, /清除全部/);
  assert.match(html, /aria-label="当前降序，切换为升序"/);
  assert.match(rendered.full, /筛选条件已达上限 1 项/);
  assert.match(rendered.full, /<button[^>]*type="submit"[^>]*disabled/);
});
