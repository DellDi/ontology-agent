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

import {
  asItemArray,
  CHART_AXIS_TICK,
  CHART_GRID,
  CHART_PALETTE,
  ChartShell,
  toNumber,
  truncateLabel,
} from './recharts-shared';

type SeriesView = {
  name: string;
  pointsByLabel: Map<string, number>;
};

function extractMultiSeries(block: AnalysisRenderedBlock): {
  data: Array<Record<string, number | string>>;
  seriesNames: string[];
} {
  const rawSeries = asItemArray(block.payload.series);
  const seriesViews: SeriesView[] = rawSeries.map((series, index) => {
    const name =
      typeof series.name === 'string' && series.name
        ? series.name
        : `系列 ${index + 1}`;
    const pointsByLabel = new Map<string, number>();
    for (const point of asItemArray(series.points)) {
      const label =
        typeof point.label === 'string' ? point.label : String(point.label ?? '');
      pointsByLabel.set(label, toNumber(point.value, 0));
    }
    return { name, pointsByLabel };
  });

  // 取所有点的并集作为 x 轴
  const labelOrder: string[] = [];
  for (const series of seriesViews) {
    for (const label of series.pointsByLabel.keys()) {
      if (!labelOrder.includes(label)) {
        labelOrder.push(label);
      }
    }
  }

  const data = labelOrder.map((label) => {
    const row: Record<string, number | string> = {
      label,
      shortLabel: truncateLabel(label),
    };
    for (const series of seriesViews) {
      row[series.name] = series.pointsByLabel.get(label) ?? 0;
    }
    return row;
  });

  return { data, seriesNames: seriesViews.map((series) => series.name) };
}

export function LineChartBlock({ block }: { block: AnalysisRenderedBlock }) {
  const { data, seriesNames } = extractMultiSeries(block);
  const title =
    typeof block.title === 'string' && block.title.trim().length > 0
      ? block.title
      : '趋势';

  return (
    <ChartShell title={title} isEmpty={data.length === 0}>
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
          {seriesNames.map((name, index) => (
            <Line
              key={name}
              type="monotone"
              dataKey={name}
              stroke={CHART_PALETTE[index % CHART_PALETTE.length]}
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}
