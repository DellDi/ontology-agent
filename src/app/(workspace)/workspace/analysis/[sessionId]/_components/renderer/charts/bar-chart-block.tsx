'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { AnalysisRenderedBlock } from '@/application/analysis-interaction';

import {
  asItemArray,
  CHART_AXIS_TICK,
  CHART_GRID,
  CHART_PALETTE,
  ChartShell,
  toNumber,
  truncateLabel,
} from './recharts-shared';

function extractBarData(block: AnalysisRenderedBlock) {
  const series = asItemArray(block.payload.series);
  const firstSeries = series[0] ?? {};
  const rawPoints = asItemArray(firstSeries.points);
  return rawPoints.map((point) => {
    const label =
      typeof point.label === 'string'
        ? point.label
        : String(point.label ?? '');
    return {
      label,
      shortLabel: truncateLabel(label),
      value: toNumber(point.value, 0),
    };
  });
}

export function BarChartBlock({ block }: { block: AnalysisRenderedBlock }) {
  const data = extractBarData(block);
  const title =
    typeof block.title === 'string' && block.title.trim().length > 0
      ? block.title
      : '指标对比';

  return (
    <ChartShell title={title} isEmpty={data.length === 0}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 8, right: 12, bottom: 8, left: 0 }}
        >
          <CartesianGrid {...CHART_GRID} vertical={false} />
          <XAxis
            dataKey="shortLabel"
            tick={CHART_AXIS_TICK}
            stroke="var(--line-300)"
            interval={0}
            angle={data.length > 6 ? -20 : 0}
            textAnchor={data.length > 6 ? 'end' : 'middle'}
            height={data.length > 6 ? 50 : 30}
          />
          <YAxis tick={CHART_AXIS_TICK} stroke="var(--line-300)" width={42} />
          <Tooltip
            cursor={{ fill: 'var(--surface-50)' }}
            contentStyle={{
              borderRadius: 8,
              border: '1px solid var(--line-200)',
              background: 'var(--card)',
              color: 'var(--foreground)',
              fontSize: 12,
            }}
            labelFormatter={(_label, payload) => {
              const original = payload?.[0]?.payload as { label?: string };
              return original?.label ?? '';
            }}
          />
          <Bar dataKey="value" radius={[4, 4, 0, 0]}>
            {data.map((_, index) => (
              <Cell
                key={index}
                fill={CHART_PALETTE[index % CHART_PALETTE.length]}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}
