import { Layers3 } from 'lucide-react';
import { mainContentHasMap, type PrototypeMainContent } from '@/application/prototype-layout/project-layout';

// 中性地图构图样片，不使用行政边界、真实站点、风险等级或业务数值。
const regions = [
  'M104 84 176 55 242 80 221 135 154 154 104 124Z',
  'M242 80 314 58 373 88 348 142 281 155 221 135Z',
  'M373 88 443 68 505 110 478 161 412 174 348 142Z',
  'M104 124 154 154 221 135 243 201 205 248 132 219 83 173Z',
  'M221 135 281 155 348 142 370 205 322 258 269 249 243 201Z',
  'M348 142 412 174 478 161 502 210 450 252 384 265 370 205Z',
];
const points = [[164,116],[288,112],[426,128],[162,196],[291,204],[428,217]];

function SpatialComposition() {
  return <svg viewBox="0 0 600 320" className="h-full w-full" aria-hidden="true">
    <g fill="none" stroke="currentColor" strokeOpacity=".08">
      <ellipse cx="296" cy="185" rx="248" ry="112" />
      <ellipse cx="296" cy="185" rx="205" ry="89" />
      <path d="M55 185h490M296 45v250" strokeDasharray="3 7" />
    </g>
    <g stroke="var(--background)" strokeWidth="3" strokeLinejoin="round">
      {regions.map((d,index) => <path key={d} d={d} fill="currentColor" fillOpacity={[.13,.2,.11,.18,.28,.17][index]} />)}
    </g>
    <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M164 116Q224 62 288 112Q366 63 426 128" strokeOpacity=".55" />
      <path d="M164 116Q244 129 291 204Q365 260 428 217" strokeOpacity=".7" />
      <path d="M162 196Q206 250 291 204Q366 123 426 128" strokeOpacity=".45" strokeDasharray="4 5" />
    </g>
    {points.map(([x,y]) => <g key={x+':'+y}>
      <circle cx={x} cy={y} r="12" fill="currentColor" fillOpacity=".08" />
      <circle cx={x} cy={y} r="5" fill="var(--background)" stroke="currentColor" strokeWidth="1.5" />
      <circle cx={x} cy={y} r="2" fill="currentColor" />
    </g>)}
    <g fill="none" stroke="currentColor" strokeOpacity=".4">
      <path d="M69 76V59h17M514 76V59h-17M69 264v17h17M514 264v17h-17" />
      <path d="M522 239v-27m-5 8 5-8 5 8" />
    </g>
  </svg>;
}

function MetricComposition({ metrics }: { metrics: NonNullable<PrototypeMainContent['metrics']> }) {
  return <svg viewBox="0 0 600 320" className="h-full w-full" aria-hidden="true">
    <circle cx="300" cy="160" r="96" fill="none" stroke="currentColor" strokeOpacity=".12" strokeDasharray="3 6" />
    {metrics.map((metric,index) => {
      const angle = -Math.PI / 2 + index / metrics.length * Math.PI * 2;
      const x = 300 + Math.cos(angle) * 180; const y = 160 + Math.sin(angle) * 95;
      return <g key={metric.id ?? index}>
        <path d={`M300 160L${x} ${y}`} stroke="currentColor" strokeOpacity=".3" />
        <rect x={x-65} y={y-22} width="130" height="44" rx="8" fill="var(--background)" stroke="currentColor" strokeOpacity=".3" />
        <text x={x} y={y+4} textAnchor="middle" fill="currentColor" fontSize="12">{metric.name || '未记录指标名称'}</text>
      </g>;
    })}
    <circle cx="300" cy="160" r="32" fill="var(--background)" stroke="currentColor" strokeOpacity=".4" />
    <text x="300" y="164" textAnchor="middle" fill="currentColor" fontSize="12">主视觉</text>
  </svg>;
}

export function PrototypeMainContentPreview({ content, diagnostic, chartFamily }: {
  content: PrototypeMainContent | null; diagnostic: string | null; chartFamily?: string;
}) {
  const isMap = chartFamily === 'map' || (content ? mainContentHasMap(content) : false);
  return <div className="@container flex h-full w-full flex-col overflow-hidden rounded-md bg-primary/[.025] p-[3%]" data-testid="prototype-main-content-preview">
    <div className="flex shrink-0 items-start justify-between gap-2">
      <h5 className="truncate text-[clamp(8px,2.8cqw,16px)] font-semibold text-foreground">{content?.title || '主视觉'}</h5>
      <span title={isMap ? '非真实地理与业务数据' : '按源文案展示指标构成'} className="hidden shrink-0 text-xs text-muted-foreground @min-[360px]:block">{isMap ? '地图构图示意' : '指标构成示意'}</span>
    </div>
    <div className="min-h-0 flex-1 text-[color:var(--chart-teal)]" title={content?.description ?? undefined}>
      {isMap ? <SpatialComposition /> : content?.metrics?.length ? <MetricComposition metrics={content.metrics} /> : <div className="flex h-full items-center justify-center text-primary/30"><Layers3 aria-hidden="true" className="h-1/3 w-1/3" strokeWidth={.8} /></div>}
    </div>
    {content?.metrics?.length ? <ul className="hidden shrink-0 flex-wrap justify-center @min-[360px]:flex gap-x-4 gap-y-1 text-[clamp(6px,2cqw,11px)] text-foreground/80" aria-label="主视觉指标">
      {content.metrics.map((metric,index) => <li key={metric.id ?? index} title={metric.description ?? undefined}>{metric.name || '未记录指标名称'}</li>)}
    </ul> : null}
    {diagnostic ? <p className="mt-1.5 text-xs leading-snug text-destructive" role="status">{diagnostic}</p> : null}
  </div>;
}
