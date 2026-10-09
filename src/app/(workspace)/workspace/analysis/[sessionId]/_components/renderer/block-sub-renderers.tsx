'use client';

/**
 * Chart / table / graph 块的渲染入口。
 *
 * 升级要点：
 *   - 表格使用 DataTableBlock（sticky header、空态、数字右对齐、长文本换行）
 *   - 图表使用 recharts（BarChart / LineChart），自动适配 dark 主题
 *   - 关系图保留节点+关系列表式表达，但有空态与层级强化
 *   - chart kind 使用正式 chartType，避免按系列数重新猜测类型
 */
import type { AnalysisRenderedBlock } from '@/application/analysis-interaction';

import type { AnalysisInteractionUiRenderInput } from '../analysis-interaction-ui-renderer-registry';

import { BarChartBlock } from './charts/bar-chart-block';
import { DataTableBlock } from './charts/data-table-block';
import { EntityGraphBlock } from './charts/entity-graph-block';
import { LineChartBlock } from './charts/line-chart-block';
import { PieChartBlock } from './charts/pie-chart-block';
import { resultDrilldownActions } from './result-drilldown';
import { ResultViewSwitch } from './result-view-switch';

export function renderTableBlock(input: AnalysisInteractionUiRenderInput) {
  const {
  renderedBlock,
  className = '',
  embedded = false,
  } = input;
  return (
    <DataTableBlock
      block={renderedBlock}
      className={className}
      flat={embedded}
      drilldown={resultDrilldownActions(input)}
    />
  );
}

export function renderChartBlock(input: AnalysisInteractionUiRenderInput) {
  const {
  renderedBlock,
  className = '',
  embedded = false,
  } = input;
  const drilldown = resultDrilldownActions(input);
  const hint =
    typeof renderedBlock.payload.chartType === 'string'
      ? renderedBlock.payload.chartType
      : null;
  const useLine = hint === 'line';

  const chart = hint === 'pie' ? (
    <PieChartBlock block={renderedBlock} flat={embedded} drilldown={drilldown} />
  ) : useLine ? (
    <LineChartBlock block={renderedBlock} flat={embedded} drilldown={drilldown} />
  ) : (
    <BarChartBlock block={renderedBlock} flat={embedded} drilldown={drilldown} />
  );

  return (
    <div className={className}>
      <ResultViewSwitch block={renderedBlock} drilldown={drilldown} embedded={embedded} chart={chart} />
      {drilldown.reason ? <p className="mt-2 text-xs text-muted-foreground">{drilldown.reason}</p> : null}
    </div>
  );
}

export function renderGraphBlock({
  renderedBlock,
  className = '',
  embedded = false,
}: AnalysisInteractionUiRenderInput) {
  return (
    <div className={className}>
      <EntityGraphBlock block={renderedBlock} flat={embedded} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 兼容导出：保留旧函数签名，避免外部直接引用 renderTable/renderChart/renderGraph 时编译失败。
// ---------------------------------------------------------------------------

export function renderTable(block: AnalysisRenderedBlock) {
  return <DataTableBlock block={block} />;
}

export function renderChart(block: AnalysisRenderedBlock) {
  return renderChartBlock({ renderedBlock: block });
}

export function renderGraph(block: AnalysisRenderedBlock) {
  return <EntityGraphBlock block={block} />;
}
