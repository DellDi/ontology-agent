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
import type { ResultDrilldownActions } from '../result-drilldown';

import {
  asItemArray,
  CHART_AXIS_TICK,
  CHART_GRID,
  CHART_PALETTE,
  ChartShell,
  truncateLabel,
} from './recharts-shared';

function extractBarData(block: AnalysisRenderedBlock) {
  const series = asItemArray(block.payload.series);
  const points = series.map(entry => asItemArray(entry.points));
  const labels = [...new Set(points.flatMap(entries => entries.map(point => String(point.label ?? ''))))];
  const byLabel = points.map(entries => new Map(entries.map(point => [String(point.label ?? ''), point.value])));
  return { seriesNames: series.map(entry => String(entry.name)), data: labels.map(label => {
    const row: Record<string, string | number | null> = {
      label,
      shortLabel: truncateLabel(label),
    };
    byLabel.forEach((values, index) => {
      const value = values.get(label);
      row[`value-${index}`] = typeof value === 'number' && Number.isFinite(value) ? value : null;
    });
    return row;
  }) };
}

export function BarChartBlock({
  block,
  flat = false,
  drilldown,
}: {
  block: AnalysisRenderedBlock;
  flat?: boolean;
  drilldown?: ResultDrilldownActions;
}) {
  const { data, seriesNames } = extractBarData(block);
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
            {data.map((point, index) => (
              <Cell
                key={index}
                fill={CHART_PALETTE[(seriesNames.length === 1 ? index : seriesIndex) % CHART_PALETTE.length]}
                {...(drilldown?.has(index, seriesIndex) ? {
                  role: 'button', tabIndex: 0, 'aria-label': `查看${point.label}的支撑对象`,
                  className: 'cursor-pointer focus-visible:outline-none focus-visible:stroke-primary focus-visible:stroke-2',
                  onClick: () => drilldown.open(index, seriesIndex),
                  onKeyDown: (event: React.KeyboardEvent<SVGElement>) => {
                    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); drilldown.open(index, seriesIndex); }
                  },
                } : {})}
              />
            ))}
          </Bar>)}
        </BarChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}
