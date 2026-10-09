import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import tableView from '../src/application/analysis-interaction/chart-table-view.ts';

const { chartTableView, shiftDrilldownColumns } = tableView;
const point = (label, value) => ({ label, value });

test('结果视图 | 图表与表格读取同一份保存数据：分组图用“分组”列，时间序列用“时间”列，数值原样保留', () => {
  const bar = chartTableView({ chartType: 'bar', series: [{ name: '组件数', points: [point('donut', 3), point('line', 2.5)] }] });
  assert.deepEqual(bar, { columns: ['分组', '组件数'], rows: [['donut', '3'], ['line', '2.5']] });
  const line = chartTableView({ chartType: 'line', series: [
    { name: '成功', points: [point('2026-10-01', 4), point('2026-10-02', 0)] },
    { name: '失败', points: [point('2026-10-01', 1), point('2026-10-02', 7)] }] });
  assert.deepEqual(line, { columns: ['时间', '成功', '失败'], rows: [['2026-10-01', '4', '1'], ['2026-10-02', '0', '7']] });
  const pie = chartTableView({ chartType: 'pie', series: [{ name: '数量', points: [point('A', 1), point('A', 2)] }] });
  assert.deepEqual(pie.rows, [['A', '1'], ['A', '2']], '重复标签逐点保留，不合并、不覆盖');
});

test('结果视图 | 无法无损对应时不提供表格：系列错位、缺值、非有限数值、空数据与非图表载荷', () => {
  const aligned = [{ name: 'a', points: [point('x', 1)] }, { name: 'b', points: [point('x', 2)] }];
  assert.notEqual(chartTableView({ chartType: 'bar', series: aligned }), null);
  for (const payload of [
    { chartType: 'bar', series: [{ name: 'a', points: [point('x', 1)] }, { name: 'b', points: [point('y', 2)] }] },
    { chartType: 'bar', series: [{ name: 'a', points: [point('x', 1), point('y', 2)] }, { name: 'b', points: [point('x', 2)] }] },
    { chartType: 'bar', series: [{ name: 'a', points: [point('x', null)] }] },
    { chartType: 'bar', series: [{ name: 'a', points: [point('x', Infinity)] }] },
    { chartType: 'bar', series: [{ name: 'a', points: [point('x', '3')] }] },
    { chartType: 'bar', series: [{ name: 'a', points: [{ value: 1 }] }] },
    { chartType: 'bar', series: [{ name: 'a', points: [] }] },
    { chartType: 'bar', series: [] },
    { chartType: 'bar' },
    { columns: ['a'], rows: [['1']] },
  ]) {
    assert.equal(chartTableView(payload), null, JSON.stringify(payload));
  }
});

test('结果视图 | 表格下钻坐标回到原图表点位：标签列没有入口，其余列整体左移一列', () => {
  const calls = [];
  const base = { has: (row, column) => row === 1 && column === 0, open: (row, column) => calls.push([row, column]), reason: '原因' };
  const shifted = shiftDrilldownColumns(base);
  assert.equal(shifted.has(1, 1), true, '表格第 2 列对应第 1 个系列');
  assert.equal(shifted.has(1, 0), false, '分组标签列不是统计项');
  assert.equal(shifted.has(0, 1), false);
  shifted.open(1, 1); shifted.open(1, 0);
  assert.deepEqual(calls, [[1, 0]]);
  assert.equal(shifted.reason, null, '不可下钻原因只在图表区域外显示一次');
});

const rendered = JSON.parse(execFileSync('node', ['--import', 'tsx', '--input-type=module', '-e', `
  import React from 'react';
  import { renderToStaticMarkup } from 'react-dom/server';
  import registry from './src/app/(workspace)/workspace/analysis/[sessionId]/_components/renderer/block-sub-renderers.tsx';
  import view from './src/app/(workspace)/workspace/analysis/[sessionId]/_components/renderer/result-view-switch.tsx';

  const block = (payload) => ({ kind: 'chart', payload, source: { sourceType: 'execution-render-block' } });
  const series = [{ name: '组件数', points: [{ label: 'donut', value: 3 }, { label: 'line', value: 2 }] }];
  const out = {};
  out.chartDefault = renderToStaticMarkup(registry.renderChartBlock({ renderedBlock: block({ chartType: 'bar', series }) }));
  out.misaligned = renderToStaticMarkup(registry.renderChartBlock({ renderedBlock: block({ chartType: 'bar',
    series: [...series, { name: '另一个', points: [{ label: 'x', value: 1 }, { label: 'y', value: 1 }] }] }) }));
  const chartElement = registry.renderChartBlock({ renderedBlock: block({ chartType: 'bar', series }) });
  out.switchProps = Object.keys(chartElement.props.children[0].props);
  out.tableView = renderToStaticMarkup(React.createElement(view.ResultTableView, { block: block({ chartType: 'bar', series }),
    drilldown: { has: (row, column) => row === 0 && column === 0, open: () => {}, reason: '不应重复显示' } }));
  console.log(JSON.stringify(out));
`], { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } }));

test('结果视图 | 图表默认展示，提供图表/表格切换；无法对应时不展示切换', () => {
  assert.match(rendered.chartDefault, /role="group"[^>]*aria-label="结果视图"/);
  assert.match(rendered.chartDefault, /aria-pressed="true"[^>]*>图表</);
  assert.match(rendered.chartDefault, /aria-pressed="false"[^>]*>表格</);
  assert.doesNotMatch(rendered.chartDefault, /<table/, '默认仍是保存时选定的图表');
  assert.doesNotMatch(rendered.misaligned, /结果视图/);
  assert.deepEqual(rendered.switchProps.sort(), ['block', 'chart', 'drilldown', 'embedded'].sort());
});

test('结果视图 | 表格视图展示精确读数与说明，下钻入口只出现在统计数值列', () => {
  const html = rendered.tableView;
  assert.match(html, /<th[^>]*>分组<\/th>/);
  assert.match(html, /<th[^>]*>组件数<\/th>/);
  assert.match(html, /<td[^>]*>donut<\/td>/);
  assert.match(html, /与图表读取同一份保存的结果/);
  assert.match(html, /aria-label="查看第 1 行组件数的支撑对象"/);
  assert.doesNotMatch(html, /查看第 1 行分组的支撑对象/);
  assert.doesNotMatch(html, /不应重复显示/);
});
