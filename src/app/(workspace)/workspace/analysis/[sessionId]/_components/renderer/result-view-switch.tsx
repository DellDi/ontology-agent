'use client';

import { useMemo, useState, type ReactNode } from 'react';

import type { AnalysisRenderedBlock } from '@/application/analysis-interaction';
import { chartTableView, shiftDrilldownColumns, type DrilldownAccess } from '@/application/analysis-interaction/chart-table-view';
import { Button } from '@/components/ui/button';

import { DataTableBlock } from './charts/data-table-block';

const VIEWS = [{ key: 'chart', label: '图表' }, { key: 'table', label: '表格' }] as const;

/** 由已保存的图表数据生成的精确读数；不重新查询、不重新选型。 */
export function ResultTableView({ block, drilldown, embedded = false }: {
  block: AnalysisRenderedBlock; drilldown: DrilldownAccess; embedded?: boolean;
}) {
  const table = chartTableView(block.payload);
  if (!table) return null;
  return <DataTableBlock flat={embedded} drilldown={shiftDrilldownColumns(drilldown)}
    block={{ ...block, kind: 'table', payload: { ...table, presentationReason: '与图表读取同一份保存的结果，数值与顺序一致，可逐项查看精确数字。' } }} />;
}

/** 视图切换只改变展示：数据、下钻绑定、冻结版本与权限均来自同一保存结果。 */
export function ResultViewSwitch({ block, drilldown, embedded = false, chart }: {
  block: AnalysisRenderedBlock; drilldown: DrilldownAccess; embedded?: boolean; chart: ReactNode;
}) {
  const available = useMemo(() => chartTableView(block.payload) !== null, [block.payload]);
  const [view, setView] = useState<(typeof VIEWS)[number]['key']>('chart');
  if (!available) return <>{chart}</>;
  return <div className="space-y-2">
    <div role="group" aria-label="结果视图" className="flex gap-1">
      {VIEWS.map((item) => <Button key={item.key} type="button" size="sm" variant={view === item.key ? 'secondary' : 'ghost'}
        aria-pressed={view === item.key} onClick={() => setView(item.key)}>{item.label}</Button>)}
    </div>
    {view === 'chart' ? chart : <ResultTableView block={block} drilldown={drilldown} embedded={embedded} />}
  </div>;
}
