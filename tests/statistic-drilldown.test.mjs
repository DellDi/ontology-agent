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
