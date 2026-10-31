import test from 'node:test';
import assert from 'node:assert/strict';
import projection from '../src/application/prototype-layout/project-layout.ts';
import streams from '../src/domain/analysis-execution/stream-models.ts';
import parts from '../src/application/analysis-interaction/interaction-part-schema.ts';
import registry from '../src/application/analysis-interaction/renderer-registry.ts';
import vm from '../src/application/analysis-message-projection/conversation-view-model.ts';
import mapper from '../src/application/ai-runtime/runtime-projection-mapper.ts';
const { projectPrototypeLayout, projectPrototypeComponents } = projection;
const node = (tag, attributes = {}, children = []) => ({ tag, attributes, children });
const blocks = ['left', 'right'].map((id) => ({ reference: { objectId: `source:${id}` }, properties: { blockId: id } }));
const page = (layout, dimensions = { width: '1200', height: '600' }) => node('Pages', {}, [node('Page', dimensions, [layout])]);
const frame = (id, span) => node('Sider', { span }, [node('Block', { id, span: '12/12' })]);

test('旧读取响应缺少源外框字段时，近似栅格仍明确检查边界', () => {
  const components = [
    { reference: { objectId: 'block:kpi' }, properties: { chartFamily: 'single-value-metric', gridCol: 1, gridRow: 1, gridColSpan: 12, gridRowSpan: 3 } },
    { reference: { objectId: 'block:line' }, properties: { chartFamily: 'line', gridCol: 1, gridRow: 4, gridColSpan: 12, gridRowSpan: 9 } },
  ];
  assert.deepEqual(projectPrototypeComponents(components), { diagnostics: [], items: [
    { objectId: 'block:kpi', chartFamily: 'single-value-metric', x: 0, y: 0, width: 100, height: 25 },
    { objectId: 'block:line', chartFamily: 'line', x: 0, y: 25, width: 100, height: 75 },
  ] });
  for (const invalid of [{ gridCol: null }, { gridRow: 0 }, { gridColSpan: 13 }, { gridRow: 11 }, { gridColSpan: 1.5 }]) {
    const result = projectPrototypeComponents([{ ...components[1], properties: { ...components[1].properties, ...invalid } }]);
    assert.deepEqual(result.items, []); assert.match(result.diagnostics[0], /未保留有效的 12 栅格位置/);
  }
});

test('方案 18 的末行使用源百分比框，不能因近似栅格越界漏掉三个组件', () => {
  const components = [0, 1, 2].map((index) => ({ reference: { objectId: `41:c${index}` },
    properties: { chartFamily: 'line', gridCol: 1 + index * 4, gridRow: 9, gridColSpan: 4, gridRowSpan: 5 } }));
  const geometry = Object.fromEntries(components.map((row, index) => [row.reference.objectId,
    { status: 'available', errorCode: null, box: { x: index * 33.33, y: 62.5, width: index === 2 ? 33.34 : 33.33, height: 37.5 } }]));
  const result = projectPrototypeComponents(components, geometry);
  assert.equal(result.items.length, 3); assert.deepEqual(result.diagnostics, []);
  assert.equal(result.items[2].x + result.items[2].width, 100);
  assert.equal(result.items[2].y + result.items[2].height, 100);
  for (const invalid of [{}, { '41:c0': { status: 'missing', errorCode: 'COMPONENT_BOX_MISSING', box: null } },
    { '41:c0': { status: 'available', errorCode: null, box: { x: 90, y: 0, width: 20, height: 100 } } }]) {
    const result = projectPrototypeComponents([components[0]], invalid);
    assert.deepEqual(result.items, []); assert.equal(result.diagnostics.length, 1);
  }
});

test('Layout 的直接 Block 与冻结区域绑定，不能把已读取的区域显示为空结构', () => {
  const result = projectPrototypeLayout(page(node('Layout', { 'grid-direction': 'horizontal' }, [
    node('Block', { id: 'left', span: '4/12' }), node('Block', { id: 'right', span: '8/12' }),
  ])), blocks)[0];
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.items.map(({ x, y, width, height, objectId }) => ({ x, y, width, height, objectId })), [
    { x: 0, y: 0, width: 400, height: 600, objectId: 'source:left' },
    { x: 400, y: 0, width: 800, height: 600, objectId: 'source:right' },
  ]);
});

test('同一个投影器还原横向/纵向布局，12 栅格 gap 和 padding 不能按 flex 均分', () => {
  const horizontal = projectPrototypeLayout(page(node('Layout', { 'grid-direction': 'horizontal', padding: '10px 20px', gap: '12' }, [frame('left', '4/12'), frame('right', '8/12')])), blocks)[0];
  assert.deepEqual(horizontal.diagnostics, []);
  assert.deepEqual(horizontal.items.map(({ x, y, width, height, objectId }) => ({ x, y, width, height, objectId })), [
    { x: 20, y: 10, width: 378.6666666666667, height: 580, objectId: 'source:left' },
    { x: 410.6666666666667, y: 10, width: 769.3333333333334, height: 580, objectId: 'source:right' },
  ]);
  const vertical = projectPrototypeLayout(page(node('Layout', { 'grid-direction': 'vertical' }, [frame('left', '3/12'), frame('right', '9/12')])), blocks)[0];
  assert.equal(vertical.items[0].height, 150); assert.equal(vertical.items[1].y, 150); assert.equal(vertical.items[1].height, 450);
  assert.equal(vertical.items[0].width, 1200);
});

test('缺失尺寸、非法跨度、未知方向和重复区域明确诊断，不渲染猜测几何', () => {
  const layout = node('Layout', { 'grid-direction': 'horizontal' }, [frame('left', '6/12'), frame('right', '6/12')]);
  for (const [tree, message] of [
    [page(layout, { width: '1200' }), /缺少页面尺寸/],
    [page({ ...layout, attributes: { 'grid-direction': 'diagonal' } }), /不支持的排布方向/],
    [page(node('Layout', {}, [frame('left', '1/7')])), /无法映射/],
    [page(node('Layout', {}, [frame('left', '8/12'), frame('right', '8/12')])), /超过父容器/],
    [page(node('Layout', {}, [frame('left', '6/12'), frame('left', '6/12')])), /ID 缺失或重复/],
  ]) {
    const result = projectPrototypeLayout(tree, blocks)[0]; assert.equal(result.items.length, 0); assert.match(result.diagnostics.join(' '), message);
  }
  const unbound = projectPrototypeLayout(page(layout), blocks.slice(0, 1))[0];
  assert.equal(unbound.items[1].objectId, null); assert.match(unbound.diagnostics[0], /没有对应的区域对象/);
});

test('多页和主视觉保留；主视觉不会生成虚构的对象 ID', () => {
  const content = node('Layout', {}, [node('Content', { id: '#map', span: '12/12' })]);
  const tree = node('Pages', {}, [node('Page', { width: '600', height: '300' }, [content]), node('Page', { width: '300', height: '600' }, [content])]);
  const result = projectPrototypeLayout(tree, []); assert.equal(result.length, 2);
  assert.equal(result[0].items[0].kind, 'content'); assert.equal(result[0].items[0].objectId, null);
  assert.equal(result[1].height, 600); assert.notEqual(result[0].key, result[1].key);
});

test('对象块在 SSE、历史 projection 和 renderer registry 中保留执行与冻结上下文', () => {
  const event = streams.validateAnalysisExecutionStreamEvent({ id: 'event', sessionId: 'session-old', executionId: 'execution-old', sequence: 2, kind: 'stage-result', timestamp: '2026-10-03T01:00:00Z',
    renderBlocks: [{ type: 'object-browser', title: '对象范围', role: 'supporting', objectKey: 'easyv-prototype-layout', datasetVersionSetId: 'set-old', filters: [{ member: 'createdAt', operator: 'LT', values: ['2026-10-04T00:00:00+08:00'] }], scopeDescription: '当前期对象范围' }] });
  const part = parts.normalizeExecutionRenderBlock(event.renderBlocks[0], { sourceType: 'execution-render-block', sessionId: event.sessionId, executionId: event.executionId });
  const rendered = registry.createDefaultAnalysisRendererRegistry().render(part, { surface: 'mobile' });
  assert.equal(rendered.kind, 'object-browser'); assert.equal(rendered.source.executionId, 'execution-old');
  assert.equal(rendered.payload.datasetVersionSetId, 'set-old'); assert.equal(rendered.payload.filters[0].operator, 'LT');
  assert.throws(() => streams.validateAnalysisExecutionStreamEvent({ ...event, renderBlocks: [{ ...event.renderBlocks[0], objectKey: 'unknown' }] }));
});

test('真实聊天 view model 保留对象入口，历史恢复与 SSE 都绑定原执行，不漂到后续轮次', async () => {
  const block = { type: 'object-browser', title: '对象范围', role: 'supporting', objectKey: 'easyv-prototype-layout', datasetVersionSetId: 'set-old', filters: [], scopeDescription: '当前期对象范围' };
  const event = { id: 'event', sessionId: 'session-old', executionId: 'execution-old', sequence: 2, kind: 'stage-result', timestamp: '2026-10-03T01:00:00Z', renderBlocks: [block], metadata: {} };
  for (const events of [[event], []]) {
    const projected = mapper.buildAiRuntimeProjection({ sessionId: 'session-old', executionId: 'execution-old', events,
      fallbackConclusion: { causes: [], renderBlocks: [block] } });
    const result = vm.buildConversationViewModel({ questionText: '查看原型', projection: projected, events, hasConnectionIssue: false });
    const entries = result.assistantMessage.result.blocks.filter((item) => item.kind === 'object-browser');
    assert.equal(entries.length, 1); assert.equal(entries[0].source.sessionId, 'session-old');
    assert.equal(entries[0].source.executionId, 'execution-old'); assert.equal(entries[0].payload.datasetVersionSetId, 'set-old');
  }
});

test('主视觉设计按页面与 Content 引用关联，同名、跨页、重复和坏数据不能误绑', () => {
  const content = { id: 'content-main', title: '全国水利风险态势总览', metrics: [{ id: 'main-content__map-region', name: '区域风险分布' }] };
  const pages = [{ pageId: 'page-1', contents: [content] }, { pageId: 'page-2', contents: [{ ...content, title: '另一页' }] }];
  const tree = node('Pages', {}, [node('Page', { id: 'page-1', width: '600', height: '300' }, [node('Layout', {}, [
    node('Content', { id: 'main-content', ref: 'content-main' }),
  ])])]);
  const canvas = projectPrototypeLayout(tree, [])[0];
  const projected = projection.readPrototypeMainContent(JSON.stringify(pages), canvas.pageId, canvas.items[0].contentIds);
  assert.deepEqual(projected.content, content);
  assert.equal(projection.mainContentHasMap(projected.content), true);
  assert.equal(projection.mainContentHasMap({ title: '地图', metrics: [{ id: 'unknown', name: '地图' }] }), false);
  for (const value of [null, '{', '[]', JSON.stringify([{ pageId: 'page-1', contents: 'invalid' }]),
    JSON.stringify([{ pageId: 'page-1', contents: [content, content] }]), JSON.stringify([pages[0], pages[0]])]) {
    const result = projection.readPrototypeMainContent(value, 'page-1', ['content-main']);
    assert.equal(result.content, null); assert.ok(result.diagnostic);
  }
  assert.equal(projection.readPrototypeMainContent(JSON.stringify(pages), 'page-3', ['content-main']).content, null);
  assert.equal(projection.readPrototypeMainContent(JSON.stringify(pages), 'page-1', ['同名但未关联']).content, null);
});

test('核心指标 | 五项小数跨度按源等分，fillLayout 主视觉覆盖核心槽位且保留角色', () => {
  const coreBlocks = Array.from({ length: 5 }, (_,i) => ({ reference: { objectId: `core:${i}` }, properties: { blockId: `core_metric_${i}` } }));
  const core = node('Header', { type: 'core-metrics', span: '2/12' }, coreBlocks.map((row) => node('Block', {
    id: row.properties.blockId, span: '2.4/12', metric_role: 'core',
  })));
  const tree = page(node('Layout', { 'grid-direction': 'vertical' }, [core, node('Content', { id: 'main', span: '10/12', fillLayout: '1' })]));
  const result = projectPrototypeLayout(tree, coreBlocks)[0];
  assert.deepEqual(result.diagnostics, []);
  const items = result.items.filter(item => item.kind === 'block');
  assert.equal(items.length, 5); assert.ok(items.every(item => item.metricRole === 'core'));
  assert.equal(items[0].width, 240); assert.equal(items[4].x + items[4].width, 1200);
  const visual = result.items.find(item => item.kind === 'content');
  assert.equal(visual.y, 0); assert.equal(visual.height, 600);
  assert.deepEqual(visual.contentBox, { x: 0, y: 100, width: 1200, height: 500 });
  const noFill = projectPrototypeLayout(page(node('Layout', {}, [core, node('Content', { id: 'main', span: '10/12' })])), coreBlocks)[0];
  assert.equal(noFill.items.at(-1).y, 100); assert.equal(noFill.items.at(-1).height, 500);
});

 test('动态面板保留宿主外框和标签顺序，不把状态排列成并列区域', () => {
  const panel = node('Block', {id:'host', render:'dynamic-panel', options:'["s1","s2"]'}, [node('Block',{id:'s1'}), node('Block',{id:'s2'})]);
  const rows = ['host','s1','s2'].map(id=>({reference:{objectId:`app:${id}`},properties:{blockId:id,blockTitle:id}}));
  const result = projectPrototypeLayout(page(node('Layout',{},[panel])), rows)[0];
  assert.equal(result.items.length,1);
  assert.deepEqual(result.items[0].panelStates.map(s=>s.objectId),['app:s1','app:s2']);
  assert.equal(result.items[0].width,1200);
  assert.match(projectPrototypeLayout(page(node('Layout',{},[panel])), rows.slice(0,2))[0].diagnostics[0],/面板状态/);
});
