import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import streamModule from '../src/domain/analysis-execution/stream-models.ts';
import interactionModule from '../src/application/analysis-interaction/interaction-part-schema.ts';
import contracts from '../src/infrastructure/java-backend/object-read-contract.ts';
import projectionModule from '../src/application/analysis-message-projection/conversation-view-model.ts';

const { validateAnalysisExecutionStreamEvent } = streamModule;
const { normalizeExecutionRenderBlock } = interactionModule;
const binding = { id: 'q1:0:count', row: 0, column: 0, objectKey: 'easyv-prototype-component',
  scopeDescription: '图表族：donut · 图表组件数 3', filters: [{ member: 'chartFamily', operator: 'EQUALS', values: ['donut'] }] };
const context = { datasetVersionSetId: 'set-old', drilldowns: [binding] };
const chart = { type: 'chart', title: '组件分布', chartType: 'bar', series: [{ name: '组件数', points: [{ label: 'donut', value: 3 }] }], ...context };
const event = block => ({ id: 'event', sessionId: 'session-old', executionId: 'execution-old', sequence: 1,
  kind: 'stage-result', timestamp: '2026-10-08T00:00:00Z', renderBlocks: [block] });

test('精确下钻 | AI 应用统计项与对象范围同属开放目录，目录外对象在流式边界被拒绝', () => {
  const application = { ...chart, drilldowns: [{ ...binding, objectKey: 'easyv-ai-application', filters: [] }] };
  const browser = { type: 'object-browser', title: 'AI 应用数 · 对象范围', role: 'supporting', datasetVersionSetId: 'set-old',
    objectKey: 'easyv-ai-application', filters: [], scopeDescription: '本次查询当前期的对象范围' };
  for (const block of [application, browser]) {
    assert.doesNotThrow(() => validateAnalysisExecutionStreamEvent(event(block)));
  }
  assert.equal(normalizeExecutionRenderBlock(browser, { sourceType: 'execution-render-block', sessionId: 'session-old', executionId: 'execution-old' }).payload.objectKey, 'easyv-ai-application');
  for (const block of [{ ...application, drilldowns: [{ ...application.drilldowns[0], objectKey: 'easyv-forge-task' }] },
    { ...browser, objectKey: 'easyv-forge-task' }]) {
    assert.throws(() => validateAnalysisExecutionStreamEvent(event(block)));
  }
});

test('精确下钻 | SSE 与历史投影保留相同绑定与冻结集合', () => {
  for (const block of [chart, { type: 'kv-list', title: '组件数', items: [{ label: '组件数', value: '3' }], ...context },
    { type: 'table', title: '分组计数', columns: ['组件数'], rows: [['3']], ...context }]) {
    const validated = validateAnalysisExecutionStreamEvent(event(block)).renderBlocks[0];
    const source = { sourceType: 'execution-render-block', sessionId: 'session-old', executionId: 'execution-old' };
    const live = normalizeExecutionRenderBlock(validated, source);
    const history = normalizeExecutionRenderBlock(JSON.parse(JSON.stringify(block)), source);
    assert.deepEqual(live.payload.drilldowns, history.payload.drilldowns);
    assert.equal(live.payload.datasetVersionSetId, 'set-old');
    assert.deepEqual(live.payload.drilldowns, [binding]);
  }
  const legacy = { ...chart }; delete legacy.drilldowns; delete legacy.datasetVersionSetId;
  assert.doesNotThrow(() => validateAnalysisExecutionStreamEvent(event(legacy)));
});

test('精确下钻 | 缺版本、坏坐标和未知对象类型被拒绝', () => {
  for (const mutate of [b => delete b.datasetVersionSetId, b => { b.drilldowns[0].row = 4; },
    b => { b.drilldowns[0].column = -1; }, b => { b.drilldowns[0].objectKey = 'property-project'; }]) {
    const block = structuredClone(chart); mutate(block);
    assert.throws(() => validateAnalysisExecutionStreamEvent(event(block)));
  }
  assert.equal(contracts.javaObjectReadRequestSchema.safeParse({ executionId: 'execution-old', datasetVersionSetId: 'set-old',
    objectKey: binding.objectKey, drilldownId: binding.id, limit: 20, offset: 20 }).success, true);
});

test('动态呈现 | 表格说明与精确下钻在实时和历史投影保持一致', () => {
  const block = { type: 'table', title: '版式分组', columns: ['版式签名', '原型数'], rows: [['hash-a', '1']],
    presentationReason: '已返回分组没有数值差异，使用明细便于查看对象。',
    ...context, drilldowns: [{ ...binding, column: 1 }] };
  const validated = validateAnalysisExecutionStreamEvent(event(block)).renderBlocks[0];
  const source = { sourceType: 'execution-render-block', sessionId: 'session-old', executionId: 'execution-old' };
  const live = normalizeExecutionRenderBlock(validated, source);
  const saved = normalizeExecutionRenderBlock(JSON.parse(JSON.stringify(block)), source);
  assert.equal(live.payload.presentationReason, block.presentationReason);
  assert.deepEqual(live.payload, saved.payload);
  const invalid = { ...block, presentationReason: { reason: 'bad' } };
  assert.throws(() => validateAnalysisExecutionStreamEvent(event(invalid)));
});

test('动态呈现 | 前端按正式图表类型分派，饼图不会被当作柱图，非法占比数据被拒绝', () => {
  const result = execFileSync('node', ['--import', 'tsx', '--input-type=module', '-e', `
    import React from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import registry from './src/app/(workspace)/workspace/analysis/[sessionId]/_components/renderer/block-sub-renderers.tsx';
    import table from './src/app/(workspace)/workspace/analysis/[sessionId]/_components/renderer/charts/data-table-block.tsx';
    const types = ['bar', 'line', 'pie'].map(chartType => {
      const renderedBlock = { kind: 'chart', payload: { chartType, series: [{ name: '数量', points: [{ label: 'A', value: 1 }] }] }, source: { sourceType: 'execution-render-block' } };
      const rendered = registry.renderChartBlock({ renderedBlock });
      return rendered.props.children[0].type.name;
    });
    const multi = registry.renderChartBlock({ renderedBlock: { kind: 'chart', payload: { chartType: 'bar', series: [
      { name: '数量', points: [{ label: 'A', value: 3 }] }, { name: '金额', points: [{ label: 'A', value: 9 }, { label: 'B', value: 7 }] }
    ] }, source: { sourceType: 'execution-render-block' } } }).props.children[0];
    const bars = multi.type(multi.props).props.children.props.children;
    const data = bars.props.data;
    const html = renderToStaticMarkup(React.createElement(table.DataTableBlock, {
      block: { kind: 'table', source: { sourceType: 'execution-render-block' }, payload: { columns: ['签名', '数量'], rows: [['hash-a', '1']], presentationReason: '当前预览 50 行；不是全量对象数。' } }
    }));
    console.log(JSON.stringify({ types, multiType: multi.type.name, data, html }));
  `], { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } });
  const parsed = JSON.parse(result);
  assert.deepEqual(parsed.types, ['BarChartBlock', 'LineChartBlock', 'PieChartBlock']);
  assert.equal(parsed.multiType, 'BarChartBlock');
  assert.deepEqual(parsed.data, [{ label: 'A', shortLabel: 'A', 'value-0': 3, 'value-1': 9 },
    { label: 'B', shortLabel: 'B', 'value-0': null, 'value-1': 7 }]);
  assert.match(parsed.html, /当前预览 50 行；不是全量对象数/);
  const pie = { ...chart, chartType: 'pie' };
  assert.doesNotThrow(() => validateAnalysisExecutionStreamEvent(event(pie)));
  for (const value of [-1, 0, Infinity]) {
    const invalid = structuredClone(pie); invalid.series[0].points[0].value = value;
    assert.throws(() => validateAnalysisExecutionStreamEvent(event(invalid)));
  }
  const multiple = structuredClone(pie); multiple.series.push(structuredClone(multiple.series[0]));
  assert.throws(() => validateAnalysisExecutionStreamEvent(event(multiple)));
});

test('精确下钻 | 交互结果保留注册表渲染，不被无执行上下文的业务投影覆盖', () => {
  const source = { sourceType: 'execution-render-block', sessionId: 'session-old', executionId: 'execution-old' };
  const block = normalizeExecutionRenderBlock(chart, source);
  assert.deepEqual(projectionModule.extractBusinessViews([block]), { metricCards: [], visualizations: [] });
  const legacy = structuredClone(chart); delete legacy.drilldowns; delete legacy.datasetVersionSetId;
  assert.equal(projectionModule.extractBusinessViews([normalizeExecutionRenderBlock(legacy, source)]).visualizations.length, 1);
});

test('精确下钻 | 点击只传绑定 ID，三个结果形态使用同一坐标语义', () => {
  const result = execFileSync('node', ['--import', 'tsx', '--input-type=module', '-e', `
    import React from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import helper from './src/app/(workspace)/workspace/analysis/[sessionId]/_components/renderer/result-drilldown.tsx';
    import simple from './src/app/(workspace)/workspace/analysis/[sessionId]/_components/renderer/render-simple-blocks.tsx';
    import table from './src/app/(workspace)/workspace/analysis/[sessionId]/_components/renderer/charts/data-table-block.tsx';
    const binding = ${JSON.stringify(binding)};
    const panels = [];
    const input = { renderedBlock: { kind: 'kv-list', source: { sourceType: 'execution-render-block', sessionId: 'session-old', executionId: 'execution-old' },
      payload: { datasetVersionSetId: 'set-old', drilldowns: [binding], items: [{ label: '组件数', value: '3' }] } }, onOpenSidePanel: panel => panels.push(panel) };
    const actions = helper.resultDrilldownActions(input);
    actions.open(0, 1); if (panels.length) throw Error('无绑定的列不可下钻');
    actions.open(0, 0);
    const html = renderToStaticMarkup(simple.renderKvListBlock(input));
    const tableHtml = renderToStaticMarkup(React.createElement(table.DataTableBlock, { block: { ...input.renderedBlock, payload: { columns: ['组件数'], rows: [['3']] } }, drilldown: actions }));
    console.log(JSON.stringify({ payload: panels[0].content.props, html, tableHtml }));
  `], { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } });
  const parsed = JSON.parse(result);
  assert.equal(parsed.payload.drilldownId, binding.id);
  assert.equal(parsed.payload.objectKey, binding.objectKey);
  assert.equal(parsed.payload.context.datasetVersionSetId, 'set-old');
  assert.equal(parsed.payload.filters, undefined, '客户端不能用展示端过滤替换绑定');
  assert.match(parsed.html, /查看组件数的支撑对象/);
  assert.match(parsed.tableHtml, /查看第 1 行组件数的支撑对象/);
});
