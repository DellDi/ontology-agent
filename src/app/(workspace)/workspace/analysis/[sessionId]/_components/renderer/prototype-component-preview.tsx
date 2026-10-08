import { ChartArea, ChartBar, ChartColumn, ChartLine, ChartPie, ChartScatter, CircleGauge, Donut, Layers3, MapPinned, Radar, Table2, Text, Timer } from 'lucide-react';
import { projectPrototypeComponents } from '@/application/prototype-layout/project-layout';
import type { JavaObjectReadResult } from '@/infrastructure/java-backend/object-read-contract';
import { cn } from '@/lib/utils';

type Row = JavaObjectReadResult['page']['rows'][number];
const charts = {
  'single-value-metric': { label: '指标卡', icon: CircleGauge },
  line: { label: '折线图', icon: ChartLine },
  area: { label: '面积图', icon: ChartArea },
  bar: { label: '柱状图', icon: ChartColumn },
  'horizontal-bar': { label: '条形图', icon: ChartBar },
  pie: { label: '饼图', icon: ChartPie },
  donut: { label: '环形图', icon: Donut },
  radar: { label: '雷达图', icon: Radar },
  bubble: { label: '气泡图', icon: ChartScatter },
  table: { label: '表格', icon: Table2 },
  map: { label: '地图', icon: MapPinned },
  'word-cloud': { label: '词云', icon: Text },
  gantt: { label: '甘特图', icon: Timer },
};

export function chartPlaceholder(family: unknown) {
  return charts[family as keyof typeof charts] ?? { label: typeof family === 'string' && family ? family : '图表类型未保留', icon: Layers3 };
}

export function PrototypeComponentPreview({ rows, selected, onSelect, thumbnail = false }: {
  rows: Row[]; selected?: string; onSelect?: (row: Row) => void; thumbnail?: boolean;
}) {
  const { items, diagnostics } = projectPrototypeComponents(rows);
  return <div className={cn('space-y-2', thumbnail && 'w-full')}>
    <div className={cn('relative overflow-hidden rounded-md border border-border bg-background', thumbnail ? 'h-12' : 'aspect-square')}
      role={thumbnail ? undefined : 'group'} aria-label={thumbnail ? undefined : '区域组件栅格布局'} aria-hidden={thumbnail || undefined}
      style={{ backgroundImage: 'linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)', backgroundSize: '8.333333% 8.333333%' }}>
      {items.map((item) => {
        const { icon: Icon } = chartPlaceholder(item.chartFamily);
        const content = <span className={cn('flex h-full w-full items-center justify-center rounded-sm border border-primary/25 bg-primary/10 text-primary', selected === item.objectId && 'border-primary bg-primary/20 ring-2 ring-inset ring-primary')}>
          {item.chartFamily === 'single-value-metric' ? <svg viewBox="0 0 100 60" className="h-3/4 w-3/4 max-w-28" aria-hidden>
            <rect x="10" y="8" width="32" height="5" rx="2" fill="currentColor" opacity=".35" />
            <rect x="10" y="25" width="42" height="16" rx="3" fill="currentColor" opacity=".65" />
            <path d="M67 40 76 31 82 35 91 22 M83 22h8v8" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
            <rect x="10" y="49" width="55" height="3" rx="1.5" fill="currentColor" opacity=".2" />
          </svg> : <Icon className={thumbnail ? 'h-3/5 max-h-5 w-3/5' : 'h-3/5 max-h-20 w-3/5 max-w-24'} strokeWidth={1.5} aria-hidden />}
        </span>;
        const style = { left: `${item.x}%`, top: `${item.y}%`, width: `${item.width}%`, height: `${item.height}%` };
        const row = rows.find((candidate) => candidate.reference.objectId === item.objectId)!;
        return onSelect ? <button key={item.objectId} type="button" aria-label={`选择组件 ${row.properties.componentId ?? item.objectId}`} aria-pressed={selected === item.objectId}
          title={`${chartPlaceholder(item.chartFamily).label} · ${row.properties.componentId ?? item.objectId}`} onClick={() => onSelect(row)}
          className="absolute p-0.5 hover:brightness-95 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" style={style}>{content}</button>
          : <span key={item.objectId} className="absolute p-px" style={style}>{content}</span>;
      })}
      {!items.length ? <span className="absolute inset-0 flex items-center justify-center bg-muted/70 text-center text-[10px] text-muted-foreground">{rows.length ? '位置未保留' : '未读取'}</span> : null}
    </div>
    {!thumbnail ? diagnostics.map((message) => <p key={message} className="break-all text-xs text-muted-foreground" role="status">{message}</p>) : null}
  </div>;
}
