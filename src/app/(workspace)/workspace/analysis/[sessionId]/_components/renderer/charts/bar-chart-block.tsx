'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { AnalysisRenderedBlock } from '@/application/analysis-interaction';
import { chartSeriesView } from '@/application/analysis-interaction/chart-table-view';
import type { ResultDrilldownActions } from '../result-drilldown';

import {
  CHART_AXIS_TICK,
  CHART_GRID,
  CHART_PALETTE,
  ChartShell,
  truncateLabel,
} from './recharts-shared';

export function BarChartBlock({
  block,
  flat = false,
  drilldown,
}: {
  block: AnalysisRenderedBlock;
  flat?: boolean;
  drilldown?: ResultDrilldownActions;
}) {
  const { data: rows, seriesNames, pointRows } = chartSeriesView(block.payload);
  const data = rows.map(row => ({ ...row, shortLabel: truncateLabel(row.label) }));
  const title =
    typeof block.title === 'string' && block.title.trim().length > 0
      ? block.title
      : '指标对比';

  return (
    <ChartShell flat={flat} title={title} isEmpty={data.length === 0}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 8, right: 12, bottom: 8, left: 0 }}
        >
          <CartesianGrid {...CHART_GRID} vertical={false} />
          <XAxis
            dataKey="shortLabel"
            tick={CHART_AXIS_TICK}
            stroke="var(--input)"
            interval={0}
            angle={data.length > 6 ? -20 : 0}
            textAnchor={data.length > 6 ? 'end' : 'middle'}
            height={data.length > 6 ? 50 : 30}
          />
          <YAxis tick={CHART_AXIS_TICK} stroke="var(--input)" width={42} />
          <Tooltip
            cursor={{ fill: 'var(--secondary)' }}
            contentStyle={{
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--card)',
              color: 'var(--foreground)',
              fontSize: 12,
            }}
            labelFormatter={(_label, payload) => {
              const original = payload?.[0]?.payload as { label?: string };
              return original?.label ?? '';
            }}
          />
          {seriesNames.length > 1 ? <Legend /> : null}
          {seriesNames.map((name, seriesIndex) => <Bar key={`series-${seriesIndex}`} name={name} dataKey={`value-${seriesIndex}`} radius={[4, 4, 0, 0]}>
            {data.map((point, index) => {
              const sourceRow = pointRows[index][seriesIndex];
              return (
              <Cell
                key={index}
                fill={CHART_PALETTE[(seriesNames.length === 1 ? index : seriesIndex) % CHART_PALETTE.length]}
                {...(sourceRow !== null && drilldown?.has(sourceRow, seriesIndex) ? {
                  role: 'button', tabIndex: 0, 'aria-label': `查看${point.label}的支撑对象`,
                  className: 'cursor-pointer focus-visible:outline-none focus-visible:stroke-primary focus-visible:stroke-2',
                  onClick: () => drilldown.open(sourceRow!, seriesIndex),
                  onKeyDown: (event: React.KeyboardEvent<SVGElement>) => {
                    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); drilldown.open(sourceRow!, seriesIndex); }
                  },
                } : {})}
              />
            ); })}
          </Bar>)}
        </BarChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}
