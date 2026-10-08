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
import type { ResultDrilldownActions } from '../result-drilldown';

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

export function BarChartBlock({
  block,
  flat = false,
  drilldown,
}: {
  block: AnalysisRenderedBlock;
  flat?: boolean;
  drilldown?: ResultDrilldownActions;
}) {
  const data = extractBarData(block);
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
          <Bar dataKey="value" radius={[4, 4, 0, 0]}>
            {data.map((point, index) => (
              <Cell
                key={index}
                fill={CHART_PALETTE[index % CHART_PALETTE.length]}
                {...(drilldown?.has(index, 0) ? {
                  role: 'button', tabIndex: 0, 'aria-label': `查看${point.label}的支撑对象`,
                  className: 'cursor-pointer focus-visible:outline-none focus-visible:stroke-primary focus-visible:stroke-2',
                  onClick: () => drilldown.open(index, 0),
                  onKeyDown: (event: React.KeyboardEvent<SVGElement>) => {
                    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); drilldown.open(index, 0); }
                  },
                } : {})}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}
