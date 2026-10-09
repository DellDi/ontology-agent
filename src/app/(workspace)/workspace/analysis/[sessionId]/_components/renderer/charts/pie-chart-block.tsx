'use client';

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { AnalysisRenderedBlock } from '@/application/analysis-interaction';
import type { ResultDrilldownActions } from '../result-drilldown';
import { CHART_PALETTE, ChartShell } from './recharts-shared';

export function PieChartBlock({ block, flat = false, drilldown }: {
  block: AnalysisRenderedBlock;
  flat?: boolean;
  drilldown?: ResultDrilldownActions;
}) {
  const series = block.payload.series as { name: string; points: { label: string; value: number }[] }[];
  const data = series[0].points;
  return (
    <ChartShell flat={flat} title={block.title} isEmpty={data.length === 0}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="label" outerRadius={85} isAnimationActive={false}>
            {data.map((point, index) => (
              <Cell key={`${point.label}-${index}`} fill={CHART_PALETTE[index % CHART_PALETTE.length]}
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
          </Pie>
          <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--foreground)' }} />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}
