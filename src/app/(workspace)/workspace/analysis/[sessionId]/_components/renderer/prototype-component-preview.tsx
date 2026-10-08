import { Binary, ChartArea, ChartBar, ChartColumn, ChartLine, ChartPie, ChartScatter, Donut, CircleHelp, MapPinned, Radar, Table2, Text, Timer } from 'lucide-react';
import type { ReactNode } from 'react';
import type { PrototypeComponentGeometry } from '@/domain/prototype-layout/models';
import { projectPrototypeComponents } from '@/application/prototype-layout/project-layout';
import type { JavaObjectReadResult } from '@/infrastructure/java-backend/object-read-contract';
import { cn } from '@/lib/utils';

type Row = JavaObjectReadResult['page']['rows'][number];
const charts = {
  'single-value-metric': { label: '单值指标', icon: Binary },
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
  return Object.hasOwn(charts, String(family)) ? charts[family as keyof typeof charts]
    : { label: typeof family === 'string' && family ? `未支持：${family}` : '图表类型未保留', icon: CircleHelp };
}

export type MetricPreviewStyle = 'number' | 'flip';
const flipPlaceholder = <>
  {[1, 2, 3].map((digit, index) => <g key={digit} transform={`translate(${8 + index * 29}, 5)`}>
    <rect width="26" height="40" rx="4" fill="currentColor" fillOpacity=".08" stroke="currentColor" strokeOpacity=".3" />
    <path d="M0 20h26" stroke="currentColor" strokeOpacity=".2" />
    <text x="13" y="29" textAnchor="middle" fill="currentColor" fontFamily="ui-monospace, monospace" fontSize="27" fontWeight="600">{digit}</text>
  </g>)}
</>;
const numberPlaceholder = <>
  <rect x="10" y="6" width="80" height="38" rx="5" fill="currentColor" fillOpacity=".05" />
  <path d="M20 14h20" stroke="currentColor" strokeWidth="2" strokeOpacity=".35" />
  <text x="20" y="36" fill="currentColor" fontFamily="ui-monospace, monospace" fontSize="24" fontWeight="600">123</text>
</>;
const axes = <path d="M12 6v36h78" fill="none" stroke="currentColor" strokeOpacity=".3" />;
// 固定图形仅说明图表类型，不展示或暗示真实业务数值。
const shapes: Record<string, ReactNode> = {
  line: <>{axes}<path d="m15 33 15-12 16 7 15-18 14 10 12-13" fill="none" stroke="currentColor" strokeWidth="2.5" />{[[15,33],[30,21],[46,28],[61,10],[75,20],[87,7]].map(([x,y]) => <circle key={x} cx={x} cy={y} r="2" fill="currentColor" />)}</>,
  area: <>{axes}<path d="m15 33 15-12 16 7 15-18 14 10 12-13v35H15Z" fill="currentColor" fillOpacity=".18" /><path d="m15 33 15-12 16 7 15-18 14 10 12-13" fill="none" stroke="currentColor" strokeWidth="2" /></>,
  bar: <>{axes}{[18,30,24,35,15].map((height,index) => <rect key={index} x={20+index*14} y={42-height} width="9" height={height} rx="1" fill="currentColor" fillOpacity={.4+index*.12} />)}</>,
  'horizontal-bar': <>{axes}{[60,43,70,30].map((width,index) => <rect key={index} x="12" y={8+index*9} width={width} height="6" rx="1" fill="currentColor" fillOpacity={.4+index*.15} />)}</>,
  pie: <><circle cx="50" cy="25" r="20" fill="currentColor" fillOpacity=".18" /><path d="M50 25V5a20 20 0 0 1 17.32 30Z" fill="currentColor" fillOpacity=".75" /><path d="m50 25 17.32 10a20 20 0 0 1-34.64 0Z" fill="currentColor" fillOpacity=".4" /><path d="M50 5v20l17.32 10M50 25 32.68 35" stroke="var(--background)" strokeWidth="1.5" fill="none" /></>,
  donut: <><circle cx="50" cy="25" r="18" fill="none" stroke="currentColor" strokeOpacity=".15" strokeWidth="7" /><circle cx="50" cy="25" r="18" fill="none" stroke="currentColor" strokeWidth="7" strokeDasharray="73.5 113.1" transform="rotate(-90 50 25)" /><text x="50" y="29" textAnchor="middle" fill="currentColor" fontSize="11" fontWeight="600">65%</text></>,
  radar: <><path d="m50 4 22 16-8 25H36l-8-25ZM50 14l12 9-4 13H42l-4-13Z" fill="none" stroke="currentColor" strokeOpacity=".25" /><path d="m50 4v21m22-5-22 5 14 20m-14-20-14 20m14-20-22-5" fill="none" stroke="currentColor" strokeOpacity=".2" /><path d="m50 10 17 11-11 17-17 4-7-22Z" fill="currentColor" fillOpacity=".2" stroke="currentColor" strokeWidth="1.5" /></>,
  bubble: <>{axes}{[[25,31,5],[41,15,7],[60,29,9],[79,12,4]].map(([x,y,r]) => <circle key={x} cx={x} cy={y} r={r} fill="currentColor" fillOpacity=".2" stroke="currentColor" strokeWidth="1" />)}</>,
  table: <><rect x="10" y="5" width="80" height="40" rx="2" fill="none" stroke="currentColor" strokeOpacity=".5" /><path d="M10 6h80v9H10Z" fill="currentColor" fillOpacity=".2" /><path d="M10 15h80M10 25h80M10 35h80M37 5v40M66 5v40" stroke="currentColor" strokeOpacity=".3" />{[19,29,39].flatMap((y) => [17,44,73].map((x) => <path key={`${x}:${y}`} d={`M${x} ${y}h10`} stroke="currentColor" strokeOpacity=".5" strokeWidth="2" />))}</>,
  map: <><path d="m12 17 16-9 17 7 18-6 24 12-10 17-22-3-14 8-16-10-14 2Z" fill="currentColor" fillOpacity=".13" stroke="currentColor" strokeOpacity=".5" /><path d="m28 8 4 23m13-16 10 20m8-26 2 20" stroke="currentColor" strokeOpacity=".3" />{[[32,22],[55,25],[72,21]].map(([x,y]) => <g key={x}><circle cx={x} cy={y} r="5" fill="currentColor" fillOpacity=".2" /><circle cx={x} cy={y} r="2" fill="currentColor" /></g>)}</>,
  'word-cloud': <g fill="currentColor" textAnchor="middle"><text x="50" y="28" fontSize="17" fontWeight="600">数据</text><text x="25" y="13" fontSize="10" opacity=".6">趋势</text><text x="72" y="12" fontSize="9" opacity=".7">分析</text><text x="32" y="43" fontSize="10" opacity=".65">业务</text><text x="75" y="41" fontSize="8" opacity=".55">增长</text></g>,
  gantt: <>{axes}<path d="M32 6v36M52 6v36M72 6v36" stroke="currentColor" strokeOpacity=".12" />{[[15,9,28],[32,20,34],[52,31,32]].map(([x,y,width]) => <rect key={x} x={x} y={y} width={width} height="7" rx="2" fill="currentColor" fillOpacity=".6" />)}</>,
};

export function ComponentGlyph({ family, metricStyle = 'number', className }: { family: string; metricStyle?: MetricPreviewStyle; className?: string }) {
  return <svg viewBox="0 0 100 50" className={cn('h-3/4 w-4/5 max-w-40', className)} aria-hidden>
    {family === 'single-value-metric' ? metricStyle === 'flip' ? flipPlaceholder : numberPlaceholder
      : Object.hasOwn(shapes, family) ? shapes[family] : <text x="50" y="35" textAnchor="middle" fill="currentColor" fontSize="30">?</text>}
  </svg>;
}

export function PrototypeComponentPreview({ rows, geometry, metricStyle = 'number', selected, onSelect, thumbnail = false }: {
  rows: Row[]; geometry?: Record<string, PrototypeComponentGeometry>; metricStyle?: MetricPreviewStyle;
  selected?: string; onSelect?: (row: Row) => void; thumbnail?: boolean;
}) {
  const { items, diagnostics } = projectPrototypeComponents(rows, geometry);
  const unsupported = [...new Set(rows.map((row) => row.properties.chartFamily).filter((family) => !Object.hasOwn(charts, String(family))))];
  return <div className={cn('space-y-2', thumbnail && 'w-full')}>
    <div className={cn('relative overflow-hidden rounded-md border border-border bg-background', thumbnail ? 'h-12' : 'aspect-square')}
      role={thumbnail ? undefined : 'group'} aria-label={thumbnail ? undefined : '区域组件布局'} aria-hidden={thumbnail || undefined}>
      {items.map((item) => {
        const content = <span className={cn('flex h-full w-full items-center justify-center rounded-sm border border-primary/25 bg-primary/10 text-primary', selected === item.objectId && 'border-primary bg-primary/20 ring-2 ring-inset ring-primary')}>
          <ComponentGlyph family={item.chartFamily} metricStyle={metricStyle} />
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
    {!thumbnail ? unsupported.map((family) => <p key={String(family)} className="break-all text-xs text-muted-foreground" role="status">{typeof family === 'string' && family ? `尚未支持 ${family} 的图表占位，已保留其位置和对象。` : '源数据未保留图表类型，已保留其位置和对象。'}</p>) : null}
  </div>;
}
