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

test('组件按源 1-based 栅格切分，不以指标 ID 或源百分比框代替网格位置', () => {
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
  assert.equal(unbound.items[1].objectId, null); assert.match(unbound.diagnostics[0], /没有对应的冻结对象/);
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
