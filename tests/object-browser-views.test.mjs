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
  const seed = (query, objectType, row, propertyPresentations) => client.setQueryData(['analysis-object', 'session-old', { ...base, ...query }], {
    ...base, ontologyVersionId: 'ontology-old', objectType,
    propertyPresentations,
    page: { objectKey: objectType.key, rows: [row], limit: query.limit ?? 50, offset: 0, hasMore: false }, structure: null,
    dataContext: { capturedAt: '2026-10-08T02:00:00Z', scopeDescription: 'EasyV 用户 16 的数据' } });
  const application = (links) => ({ key: 'easyv-ai-application', label: 'AI 应用', links, properties: [
    { key: 'appId', label: '应用 ID', type: 'STRING', identifier: true }, { key: 'createdAt', label: '应用创建时间', type: 'TIME' },
    { key: 'scopeType', label: '归属类型', type: 'STRING', valueLabels: { USER: '个人' } }] });
  const appRow = { reference: { objectKey: 'easyv-ai-application', objectId: 'app-1', productVersionId: 'apps-old' },
    properties: { appId: 'app-1', createdAt: '2026-10-08T01:00:00Z', scopeType: 'USER' } };
  const layoutRow = { reference: { objectKey: 'easyv-prototype-layout', objectId: 'app-1', productVersionId: 'layouts-old' },
    properties: { appId: 'app-1', parseStatus: 'ok' } };
  const layoutType = { key: 'easyv-prototype-layout', label: '原型版式', links: [], properties: [{ key: 'appId', label: '应用 ID', type: 'STRING', identifier: true }] };

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
  client.clear();
  const qualityRow = { reference: { objectKey: 'easyv-quality-node', objectId: '1123', productVersionId: 'pipeline-new' },
    properties: { nodeId: '1123', taskId: 'task-secret-trace', appId: 'app-secret-trace', sessionId: 'session-secret-trace',
      stepName: 'ChatExecution', intent: 'OUT_OF_SCOPE', status: 'SUCCESS', createdAt: '2026-09-08T08:50:46Z' } };
  const qualityType = { key: 'easyv-quality-node', label: '需求与处理记录', links: [
    { key: 'operations', targetObjectKey: 'easyv-generation-feedback', targetLabel: '用户操作', prominent: true }], properties: [
    ...['nodeId', 'taskId', 'appId', 'sessionId'].map((key) => ({ key, label: key, type: 'STRING', identifier: true })),
    { key: 'stepName', label: '处理环节', type: 'STRING', valueLabels: { ChatExecution: '对话处理' } },
    { key: 'intent', label: '系统识别的诉求', type: 'STRING', title: true, valueLabels: { OUT_OF_SCOPE: '当次被判为不支持' } },
    { key: 'status', label: '处理状态', type: 'STRING', prominent: true, valueLabels: { SUCCESS: '处理完成' } },
    { key: 'createdAt', label: '发生时间', type: 'TIME' }] };
  const operationType = { key: 'easyv-generation-feedback', label: '用户操作', links: [], properties: [
    { key: 'actionType', label: '操作类型', type: 'STRING', title: true, valueLabels: { chatRefactor: '对话修改' } },
    { key: 'userInput', label: '用户原话', type: 'STRING', prominent: true }] };
  const operation = { reference: { objectKey: 'easyv-generation-feedback', objectId: '232', productVersionId: 'feedback-new' },
    properties: { actionType: 'chatRefactor', userInput: '把算力存储监控改成单值占比图', userInputTruncated: false,
      operatedAt: '2026-09-08T08:50:45Z' } };
  seed({ objectKey: 'easyv-quality-node', filters: [], limit: 20, offset: 0 }, qualityType, qualityRow);
  seed({ objectKey: 'easyv-quality-node', objectId: '1123' }, qualityType, qualityRow);
  seed({ objectKey: 'easyv-quality-node', objectId: '1123', relation: 'operations', limit: 20 },
    operationType, operation);
  seed({ objectKey: 'easyv-generation-feedback', objectId: '232' },
    operationType, operation);
  out.quality = render('easyv-quality-node');
  const timeline = { key: 'operations', targetObjectKey: 'easyv-generation-feedback', targetLabel: '用户操作',
    timeline: { title: '操作记录时间线', timeProperty: 'operatedAt', notice: '日志成功不代表修改已生效。' } };
  operationType.properties.push({ key: 'operatedAt', label: '操作记录时间', type: 'TIME' },
    { key: 'executeResult', label: '日志结果', type: 'STRING', prominent: true, valueLabels: { ok: '日志记为成功' } });
  operation.properties.executeResult = 'ok';
  seed({ objectKey: 'easyv-ai-application', objectId: 'app-1', relation: 'operations', limit: 20, offset: 0,
    order: [{ member: 'operatedAt', direction: 'DESC' }] }, operationType, operation);
  out.timeline = renderToStaticMarkup(React.createElement(QueryClientProvider, { client },
    React.createElement(browser.RelatedObjectCollection, { context: { ...base, sessionId: 'session-old' },
      source: appRow, link: timeline, selected: null, onSelect: () => {} })));
  const selectedInput = '$_({"id":"private-region","label":"算力监控","componentId":"private-component","componentLabel":"CPU平均利用率"})删除';
  operation.properties.userInput = selectedInput;
  seed({ objectKey: 'easyv-generation-feedback', objectId: '232' }, operationType, operation, {
    userInput: { items: [{ label: '用户原话', value: '【算力监控 / CPU平均利用率】删除' }], notice: '选中对象以源名称显示。' },
  });
  out.linkedPresentation = render('easyv-quality-node');
  client.clear();
  const understandingType = { ...qualityType, links: [], properties: [...qualityType.properties,
    { key: 'themes', label: '生成模块与约束', type: 'STRING' }] };
  const understandingRow = { ...qualityRow, properties: { ...qualityRow.properties,
    stepName: 'Step1', intent: null, themes: '[{"themeId":"private-theme","businessModule":"算力监控"}]' } };
  seed({ objectKey: 'easyv-quality-node', filters: [], limit: 20, offset: 0 }, understandingType, understandingRow);
  seed({ objectKey: 'easyv-quality-node', objectId: '1123' }, understandingType, understandingRow, {
    themes: { items: [{ label: '模块', value: '算力监控' }, { label: '用户要求（系统标记）', value: '展示 CPU 趋势 <img src=x onerror=run()>' }],
      notice: '这是系统当时的理解，是否正确仍需核对。' },
  });
  out.understanding = render('easyv-quality-node');
  seed({ objectKey: 'easyv-quality-node', objectId: '1123' }, understandingType, understandingRow, {
    themes: { items: [], notice: '格式无法识别，未生成业务解释；请展开源记录核对。' },
  });
  out.invalidUnderstanding = render('easyv-quality-node');
  for (const [key, titleField, title] of [
    ['easyv-prototype-layout', 'screenHeadingFromDomain', '订单经营大屏'],
    ['easyv-prototype-block', 'moduleHeadingFromDomain', '销售概览'],
    ['easyv-prototype-component', 'metricHeadingFromDomain', '月度收入'],
  ]) {
    client.clear();
    const row = { reference: { objectKey: key, objectId: 'private-object', productVersionId: 'private-version' },
      properties: { appId: 'app-1', blockId: 'private-block', chartFamily: 'line', [titleField]: title } };
    const type = { key, label: '原型对象', links: [], properties: [
      { key: titleField, label: '源业务名称', type: 'STRING', title: true },
      { key: 'appId', label: '应用 ID', type: 'STRING', identifier: true }] };
    seed({ objectKey: key, filters: [], limit: 20, offset: 0 }, type, row);
    out[key] = render(key);
  }
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
  assert.match(html, /2026\/10\/08 09:00:00/, '列表摘要来自第一个时间属性，按北京时间展示');
  assert.match(html, /<dt[^>]*>归属类型<\/dt><dd[^>]*>个人<\/dd>/);
  assert.match(html, /<dt[^>]*>应用创建时间<\/dt><dd[^>]*>2026\/10\/08 09:00:00<\/dd>/, 'TIME 属性不展示原始 ISO');
  assert.match(html, /针对这个对象追问/);
  assert.match(html, /数据出处与版本/);
  assert.doesNotMatch(html, /版式属性|结构示意|原型区域列表|查看原型版式/);
  assert.doesNotMatch(html, /查看/, '没有声明关系时不补造关系入口');
});

test('对象详情 | 业务结构来自后端，完整源记录默认折叠，内容按文本安全呈现', () => {
  const html = rendered.understanding;
  const main = html.slice(0, html.indexOf('查看完整源记录'));
  assert.match(main, /算力监控/);
  assert.match(main, /用户要求（系统标记）/);
  assert.match(main, /是否正确仍需核对/);
  assert.doesNotMatch(main, /private-theme|businessModule|themeId/);
  assert.match(html, /&lt;img src=x onerror=run\(\)&gt;/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /private-theme/);
  assert.match(html, /<details class="text-xs"><summary[^>]*>查看完整源记录/);
  assert.doesNotMatch(html, /<details[^>]*open/);
  assert.match(rendered.invalidUnderstanding, /格式无法识别，未生成业务解释/);
  assert.match(rendered.invalidUnderstanding, /private-theme/, 'unrecognized source remains available to inspect');
});

test('对象关联预览 | 复用同一属性呈现，不把选中组件的技术引用铺进正文', () => {
  const html = rendered.linkedPresentation;
  const main = html.slice(0, html.indexOf('查看完整源记录'));
  assert.match(main, /【算力监控 \/ CPU平均利用率】删除/);
  assert.doesNotMatch(main, /private-region|private-component|componentLabel/);
  assert.match(html, /private-component/, 'exact source is retained in a disclosure');
});

test('对象浏览 | 关系入口随本体声明出现，无需新增渲染器', () => {
  assert.match(rendered.linked, /查看原型版式/);
});

test('对象浏览 | 原型对象仍使用专业组合', () => {
  assert.match(rendered.layout, /原型结构/);
  assert.match(rendered.layout, /版式属性/);
});

test('对象浏览 | 排序与筛选控件由声明的属性生成，默认折叠且不产生已启用条件', () => {
  const html = rendered.application;
  assert.match(html, /排序与筛选/);
  assert.match(html, /<option value=""[^>]*>默认顺序<\/option>/);
  assert.match(html, /<option value="createdAt"[^>]*>应用创建时间<\/option>/);
  assert.doesNotMatch(html, /已启用的排序与筛选/);
  assert.match(rendered.idle, /<option value="CONTAINS"[^>]*>包含<\/option>/, '独立控件仍按实际属性类型提供算子');
  assert.match(rendered.layout, /排序与筛选/, '原型集合沿用同一控件');
  assert.doesNotMatch(rendered.pending, /排序与筛选/, '尚未读到字段声明时不展示控件');
  assert.match(rendered.pending, /正在读取当前对象/);
});

test('对象浏览 | 已启用的排序与筛选以可移除的条件展示，并提示数量上限', () => {
  const html = rendered.active;
  assert.match(html, /排序与筛选 · 3/);
  assert.match(html, /按应用创建时间降序/);
  assert.match(html, /aria-label="取消排序"/);
  assert.match(html, /aria-label="移除筛选：归属类型 等于 个人"/);
  assert.match(html, /aria-label="移除筛选：应用创建时间 不早于 2026-10-08"/);
  assert.match(html, /清除全部/);
  assert.match(html, /aria-label="当前降序，切换为升序"/);
  assert.match(rendered.full, /筛选条件已达上限 1 项/);
  assert.match(rendered.full, /<button[^>]*type="submit"[^>]*disabled/);
});


test('对象浏览 | 质量记录以中文诉求和原话展示，技术身份只在折叠追溯区', () => {
  const html = rendered.quality;
  const main = html.split('<details class="text-xs text-muted-foreground">')[0];
  assert.match(main, /当次被判为不支持/);
  assert.match(main, /处理完成/);
  assert.match(main, /用户原话/);
  assert.match(main, /把算力存储监控改成单值占比图/);
  assert.doesNotMatch(main, /task-secret-trace|app-secret-trace|session-secret-trace|>1123</);
  assert.doesNotMatch(main, />ChatExecution<|>OUT_OF_SCOPE<|>SUCCESS</);
  assert.match(html, /<details[^>]*><summary[^>]*>数据出处与版本/);
  assert.match(html, /task-secret-trace/);
});


test('原型列表 | 三类对象共用本体标题，不按前端字段名猜业务含义', () => {
  for (const [key, title] of [['easyv-prototype-layout', '订单经营大屏'], ['easyv-prototype-block', '销售概览'], ['easyv-prototype-component', '月度收入']]) {
    assert.match(rendered[key], new RegExp(title));
    const main = rendered[key].split('数据出处与版本')[0];
    assert.doesNotMatch(main.replace(/<[^>]*>/g, ''), /private-object|private-version/);
  }
});


test('关联时间线 | 按声明的时间排序，展示中文操作与日志结果，保持出处边界和分页入口', () => {
  const html = rendered.timeline;
  assert.match(html, /操作记录时间线/);
  assert.match(html, /日志成功不代表修改已生效/);
  assert.match(html, /<ol /);
  assert.match(html, /2026\/09\/08 16:50:45/);
  assert.match(html, /对话修改/);
  assert.match(html, /日志记为成功/);
  assert.match(html, /第 1 页 · 本页 1 条/);
  assert.match(html, /上一页关联记录/);
  assert.match(html, /下一页关联记录/);
  assert.doesNotMatch(html, /task-secret|app-secret|chatRefactor|operatedAt|2026-09-08T/);
});
