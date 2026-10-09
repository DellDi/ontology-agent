'use client';

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
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

export function LineChartBlock({
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
      : '趋势';

  return (
    <ChartShell flat={flat} title={title} isEmpty={data.length === 0}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 8, right: 12, bottom: 8, left: 0 }}
        >
          <CartesianGrid {...CHART_GRID} vertical={false} />
          <XAxis
            dataKey="shortLabel"
            tick={CHART_AXIS_TICK}
            stroke="var(--input)"
            interval="preserveStartEnd"
          />
          <YAxis tick={CHART_AXIS_TICK} stroke="var(--input)" width={42} />
          <Tooltip
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
          {seriesNames.length > 1 ? (
            <Legend
              wrapperStyle={{ fontSize: 12, color: 'var(--muted-foreground)' }}
            />
          ) : null}
          {seriesNames.map((name, index) => {
            const dot = ({ cx, cy, index: row }: { cx?: number; cy?: number; index?: number }) => {
              const sourceRow = row === undefined ? null : pointRows[row]?.[index];
              if (sourceRow == null || cx == null || cy == null) return <g />;
              const interactive = drilldown?.has(sourceRow, index);
              return <circle cx={cx} cy={cy} r={4} fill={CHART_PALETTE[index % CHART_PALETTE.length]}
                role={interactive ? 'button' : undefined} tabIndex={interactive ? 0 : undefined}
                aria-label={interactive ? `查看${data[row!]?.label}的${name}支撑对象` : undefined}
                className={interactive ? 'cursor-pointer focus-visible:outline-none focus-visible:stroke-primary focus-visible:stroke-2' : undefined}
                onClick={interactive ? () => drilldown?.open(sourceRow, index) : undefined}
                onKeyDown={interactive ? event => { if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault(); drilldown?.open(sourceRow, index);
                } } : undefined} />;
            };
            return (
            <Line
              key={`series-${index}`}
              name={name}
              type="monotone"
              dataKey={`value-${index}`}
              connectNulls={false}
              stroke={CHART_PALETTE[index % CHART_PALETTE.length]}
              strokeWidth={2}
              dot={drilldown ? dot : { r: 3 }}
              activeDot={drilldown ? dot : { r: 5 }}
            />
          ); })}
        </LineChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}
