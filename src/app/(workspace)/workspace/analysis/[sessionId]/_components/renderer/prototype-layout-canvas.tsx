'use client';

import { useRef, useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Maximize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import type { PrototypeComponentGeometry } from '@/domain/prototype-layout/models';
import type { JavaObjectReadResult } from '@/infrastructure/java-backend/object-read-contract';
import { projectPrototypeLayout, readPrototypeMainContent } from '@/application/prototype-layout/project-layout';
import { cn } from '@/lib/utils';
import { PrototypeMainContentPreview } from './prototype-main-content-preview';
import { PrototypeComponentPreview, type MetricPreviewStyle } from './prototype-component-preview';

type Row = JavaObjectReadResult['page']['rows'][number];

/** 同一份源几何用于目录预览和分析画布；只呈现结构，不生成业务数值。 */
export function PrototypeLayoutCanvas({ pages, blocks, components, componentGeometry, pageSemantics,
  selectedBlockId, onSelect, getLabel, metricStyle = 'number', fitViewport = false,
}: {
  pages: ReturnType<typeof projectPrototypeLayout>; blocks: Row[]; components: Row[];
  componentGeometry?: Record<string, PrototypeComponentGeometry>; pageSemantics: unknown;
  selectedBlockId?: string; onSelect: (row: Row) => void; getLabel: (row: Row) => string;
  metricStyle?: MetricPreviewStyle; fitViewport?: boolean;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [activePanels, setActivePanels] = useState<Record<string, string>>({});
  const [scale, setScale] = useState('fit');
  const expandTrigger = useRef<HTMLButtonElement | null>(null);
  const renderPage = (page: typeof pages[number], enlarged = false) => <>
      {page.items.length && page.width && page.height ? <div className="relative mx-auto min-w-0 overflow-hidden rounded-md bg-muted/40" style={{ aspectRatio: `${page.width} / ${page.height}`, width: enlarged ? scale === 'fit' ? '100%' : `${page.width * Number(scale)}px` : fitViewport ? `min(100%, calc(max(10rem, 100cqh - 7rem) * ${page.width / page.height}))` : undefined }}>
        {page.items.map((item) => {
          const style = { left: `${item.x / page.width! * 100}%`, top: `${item.y / page.height! * 100}%`, width: `${item.width / page.width! * 100}%`, height: `${item.height / page.height! * 100}%` };
          const row = blocks.find((candidate) => candidate.reference.objectId === item.objectId);
          const displayLabel = row ? getLabel(row) : item.label;
          const mainContent = item.kind === 'content' ? readPrototypeMainContent(pageSemantics, page.pageId, item.contentIds ?? []) : null;
          const contentStyle = item.contentBox ? { left: `${(item.contentBox.x-item.x)/item.width*100}%`, top: `${(item.contentBox.y-item.y)/item.height*100}%`, width: `${item.contentBox.width/item.width*100}%`, height: `${item.contentBox.height/item.height*100}%` } : { inset: 0 };
          if (item.panelStates?.length) {
            const active = item.panelStates.find(state => state.objectId === selectedBlockId) ?? item.panelStates.find(state => state.id === activePanels[item.key]) ?? item.panelStates[0];
            const stateRow = blocks.find(row => row.reference.objectId === active.objectId);
            return <div key={item.key} style={style} className="absolute z-[1] flex min-h-0 flex-col overflow-hidden rounded-sm border border-border bg-card">
              <span className="truncate px-2 py-1 text-xs font-medium" title={displayLabel}>{displayLabel}</span>
              <Tabs className="flex min-h-0 flex-1 flex-col" value={active.id} onValueChange={id => { setActivePanels(current => ({ ...current, [item.key]: id })); const row = blocks.find(row => row.reference.objectId === item.panelStates?.find(state => state.id === id)?.objectId); if (row) onSelect(row); }}>
                <TabsList aria-label={`${displayLabel} 面板`} className="h-auto max-w-full justify-start overflow-x-auto rounded-none bg-muted px-1 py-0.5">{item.panelStates.map(state => <TabsTrigger key={state.id} value={state.id} className="min-h-7 shrink-0 px-2 py-1 text-xs">{state.label}</TabsTrigger>)}</TabsList>
              <TabsContent value={active.id} className="mt-0 min-h-0 flex-1">
              <button type="button" aria-label={`选择区域 ${active.label}`} aria-pressed={selectedBlockId === active.objectId} onClick={() => { if (stateRow) onSelect(stateRow); }} className={cn('h-full w-full min-h-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring', selectedBlockId === active.objectId && 'ring-2 ring-inset ring-primary')}>
                <PrototypeComponentPreview rows={components.filter(component => component.properties.blockKey === active.objectId)} geometry={componentGeometry} metricStyle={metricStyle} thumbnail fill />
              </button>
              </TabsContent></Tabs>
            </div>;
          }
          return item.objectId ? <button key={item.key} type="button" title={displayLabel} aria-label={`选择区域 ${displayLabel}`} aria-pressed={item.objectId === selectedBlockId}
            onClick={() => { const row = blocks.find((candidate) => candidate.reference.objectId === item.objectId); if (row) onSelect(row); }}
            className={cn('absolute z-[1] flex flex-col overflow-hidden rounded-sm border border-border/50 bg-card/80 p-1 text-xs text-foreground hover:bg-accent focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring', item.metricRole === 'core' && 'bg-accent/50', item.objectId === selectedBlockId && 'bg-accent ring-2 ring-inset ring-primary')} style={style}>
            <span className="w-full shrink-0 truncate text-center">{displayLabel}</span>
            <span className="pointer-events-none min-h-0 w-full flex-1" aria-hidden>
              <PrototypeComponentPreview rows={components.filter((component) => component.properties.blockKey === item.objectId)} geometry={componentGeometry} metricStyle={metricStyle} thumbnail fill />
            </span>
          </button> : <div key={item.key} style={style} title={item.label} className="absolute flex items-center justify-center overflow-hidden p-1 text-[10px] text-muted-foreground">{mainContent ? <div className="absolute p-1" style={contentStyle}><PrototypeMainContentPreview {...mainContent} chartFamily={item.chartFamily} /></div> : <span className="truncate">{item.label}</span>}</div>;
        })}
      </div> : null}
      {page.diagnostics.map((message) => <p key={message} className="text-xs text-muted-foreground" role="status">{message}</p>)}
    </>;
  return <>
    {pages.map((page, index) => <section className="space-y-2" key={page.key}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-medium text-muted-foreground">页面 {index + 1}{page.width && page.height ? ` · ${page.width} × ${page.height}` : ''}</h4>
        <Button variant="ghost" size="sm" onClick={event => { expandTrigger.current = event.currentTarget; setScale('fit'); setExpanded(index); }} aria-label={`放大查看页面 ${index + 1}`}><Maximize2 aria-hidden className="size-3.5" />放大查看</Button>
      </div>
      {renderPage(page)}
      <details className="text-xs text-muted-foreground"><summary className="w-fit cursor-pointer py-2">区域列表</summary>
        <div className="flex flex-wrap gap-2 py-2">{page.items.filter(item => item.objectId).map(item => {
          const row = blocks.find(row => row.reference.objectId === item.objectId);
          return row ? <Button key={item.key} variant={selectedBlockId === item.objectId ? 'secondary' : 'outline'} size="sm" aria-pressed={selectedBlockId === item.objectId} onClick={() => onSelect(row)}>{getLabel(row)}</Button> : null;
        })}</div>
      </details>
    </section>)}
    <Dialog open={expanded !== null} onOpenChange={open => { if (!open) setExpanded(null); }}>
      <DialogContent aria-describedby={undefined} onCloseAutoFocus={event => { event.preventDefault(); expandTrigger.current?.focus(); }} className="flex h-[92dvh] w-[96vw] max-w-none flex-col gap-3 p-4 sm:max-w-none">
        <div className="flex flex-wrap items-center gap-4 pr-8"><DialogTitle>页面 {(expanded ?? 0) + 1} · 结构预览</DialogTitle>
          <label className="flex items-center gap-2 text-sm">显示比例<select aria-label="画布显示比例" value={scale} onChange={event => setScale(event.target.value)} className="rounded-md border border-input bg-background px-2 py-1.5"><option value="fit">适应宽度</option><option value="1">100%</option><option value="1.5">150%</option></select></label>
        </div>
        <div tabIndex={0} aria-label="放大画布，可滚动查看" className="min-h-0 flex-1 overflow-auto rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{expanded !== null && pages[expanded] ? renderPage(pages[expanded], true) : null}</div>
      </DialogContent>
    </Dialog>
  </>;
}
