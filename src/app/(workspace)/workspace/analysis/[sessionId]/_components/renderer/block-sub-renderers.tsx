'use client';

/**
 * Chart / table / graph 块的渲染入口。
 *
 * 升级要点：
 *   - 表格使用 DataTableBlock（sticky header、空态、数字右对齐、长文本换行）
 *   - 图表使用 recharts（BarChart / LineChart），自动适配 dark 主题
 *   - 关系图保留节点+关系列表式表达，但有空态与层级强化
 *   - chart kind 自动按 series 数与 hint 选择 Bar/Line，未来可暴露 payload.kind 显式指定
 */
import type { AnalysisRenderedBlock } from '@/application/analysis-interaction';

import type { AnalysisInteractionUiRenderInput } from '../analysis-interaction-ui-renderer-registry';

import { BarChartBlock } from './charts/bar-chart-block';
import { DataTableBlock } from './charts/data-table-block';
import { EntityGraphBlock } from './charts/entity-graph-block';
import { LineChartBlock } from './charts/line-chart-block';
import { asItemArray } from './charts/recharts-shared';

export function renderTableBlock({
  renderedBlock,
  className = '',
}: AnalysisInteractionUiRenderInput) {
  return <DataTableBlock block={renderedBlock} className={className} />;
}

export function renderChartBlock({
  renderedBlock,
  className = '',
}: AnalysisInteractionUiRenderInput) {
  const hint =
    typeof renderedBlock.payload.chartKind === 'string'
      ? renderedBlock.payload.chartKind
      : null;
  const seriesCount = asItemArray(renderedBlock.payload.series).length;
  const useLine = hint === 'line' || hint === 'trend' || seriesCount > 1;

  return (
    <div className={className}>
      {useLine ? (
        <LineChartBlock block={renderedBlock} />
      ) : (
        <BarChartBlock block={renderedBlock} />
      )}
    </div>
  );
}

export function renderGraphBlock({
  renderedBlock,
  className = '',
}: AnalysisInteractionUiRenderInput) {
  return (
    <div className={className}>
      <EntityGraphBlock block={renderedBlock} />
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
  const seriesCount = asItemArray(block.payload.series).length;
  return seriesCount > 1 ? (
    <LineChartBlock block={block} />
  ) : (
    <BarChartBlock block={block} />
  );
}

export function renderGraph(block: AnalysisRenderedBlock) {
  return <EntityGraphBlock block={block} />;
}
