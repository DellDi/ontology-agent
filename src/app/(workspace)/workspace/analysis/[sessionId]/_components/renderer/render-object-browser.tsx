'use client';

import { useState } from 'react';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Layers3, Loader2 } from 'lucide-react';
import { z } from 'zod';

import { projectPrototypeLayout } from '@/application/prototype-layout/project-layout';
import { readAnalysisObjects } from '@/infrastructure/java-backend/object-read-client';
import { javaObjectReadRequestSchema, type JavaObjectReadRequest, type JavaObjectReadResult } from '@/infrastructure/java-backend/object-read-contract';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatShanghaiDateTime } from '@/lib/format-datetime';
import { SchemeAssessmentPanel } from './scheme-assessment-panel';
import { chartPlaceholder, ComponentGlyph, PrototypeComponentPreview, type MetricPreviewStyle } from './prototype-component-preview';
import type { AnalysisInteractionUiRenderInput } from '../analysis-interaction-ui-renderer-registry';

type SelectObject = AnalysisInteractionUiRenderInput['onObjectSelect'];
type Row = JavaObjectReadResult['page']['rows'][number];
type Type = JavaObjectReadResult['objectType'];
type Context = Pick<JavaObjectReadRequest, 'executionId' | 'datasetVersionSetId'> & { sessionId: string };

const browserPayload = z.object({
  datasetVersionSetId: javaObjectReadRequestSchema.shape.datasetVersionSetId,
  objectKey: javaObjectReadRequestSchema.shape.objectKey, filters: javaObjectReadRequestSchema.shape.filters,
  drilldownId: javaObjectReadRequestSchema.shape.drilldownId,
  scopeDescription: z.string().min(1), role: z.enum(['primary', 'supporting']).optional(),
}).strict();

function useObjectRead(context: Context, query: Omit<JavaObjectReadRequest, 'executionId' | 'datasetVersionSetId'>, enabled = true) {
  const body = { executionId: context.executionId, datasetVersionSetId: context.datasetVersionSetId, ...query };
  return useQuery({ queryKey: ['analysis-object', context.sessionId, body],
    queryFn: ({ signal }) => readAnalysisObjects(context.sessionId, body, signal), enabled,
    retry: false, staleTime: 0, gcTime: 0 });
}

function useRelated(context: Context, objectId: string, relation: string, objectKey: JavaObjectReadRequest['objectKey'] = 'easyv-prototype-layout') {
  return useInfiniteQuery({ queryKey: ['analysis-object-relation', context, objectKey, objectId, relation],
    initialPageParam: 0,
    queryFn: ({ signal, pageParam }) => readAnalysisObjects(context.sessionId, {
      executionId: context.executionId, datasetVersionSetId: context.datasetVersionSetId,
      objectKey, objectId, relation, limit: 200, offset: pageParam,
    }, signal),
    getNextPageParam: (page) => page.page.hasMore && page.page.offset + page.page.limit <= 10000
      ? page.page.offset + page.page.limit : undefined,
    enabled: !!objectId, retry: false, staleTime: 0, gcTime: 0,
  });
}

function Notice({ error }: { error: Error }) {
  return <p className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-3 text-sm text-destructive" role="alert">{error.message}</p>;
}
function Pending({ children }: { children: string }) {
  return <p className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground" role="status"><Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />{children}</p>;
}
function label(row: Row) {
  return String(row.properties.componentId ?? row.properties.blockId ?? row.properties.appId ?? row.reference.objectId);
}
function regionLabel(row: Row) {
  const id = String(row.properties.blockId ?? row.reference.objectId).replace(/^page-\d+__/, '');
  return id.replace(/^(foot|footer|left|right|header)(?:_|$)/, (_, position: string) =>
    `${({ foot: '底部', footer: '底部', left: '左侧', right: '右侧', header: '顶部' } as Record<string, string>)[position]} `).replaceAll('_', ' · ');
}
function ObjectList({ title, rows, selected, onSelect, hasMore, loading, onMore }: {
  title: string; rows: Row[]; selected: Row | null; onSelect: (row: Row) => void;
  hasMore?: boolean; loading?: boolean; onMore?: () => void;
}) {
  return <section className="space-y-2">
    <h4 className="text-xs font-semibold text-muted-foreground">{title} · {rows.length}{hasMore ? '+' : ''}</h4>
    <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
      {!rows.length ? <p className="px-3 py-3 text-xs text-muted-foreground">本轮冻结数据中没有关联对象。</p> : rows.map((row) => <button
        key={row.reference.objectId} type="button" aria-pressed={selected?.reference.objectId === row.reference.objectId && selected.reference.objectKey === row.reference.objectKey}
        onClick={() => onSelect(row)} className={cn('flex w-full flex-col items-start gap-1 border-b border-border/50 px-3 py-2.5 text-left text-xs last:border-0 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
          selected?.reference.objectId === row.reference.objectId && selected.reference.objectKey === row.reference.objectKey && 'bg-primary/10 text-primary')}>
        <span className="min-w-0 break-all font-medium">{label(row)}</span><span className="break-all text-muted-foreground">{String(row.properties.chartFamily ?? row.properties.blockSize ?? row.properties.parseStatus ?? '')}</span>
      </button>)}
    </div>
    {hasMore && onMore ? <Button type="button" variant="outline" size="sm" disabled={loading} onClick={onMore}>{loading ? '正在读取…' : '加载更多'}</Button> : null}
  </section>;
}

function ComponentComposition({ context, object, summary, onSelect }: {
  context: Context; object: Row; summary: NonNullable<JavaObjectReadResult['componentSummary']>; onSelect: (row: Row) => void;
}) {
  const [groupIndex, setGroupIndex] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);
  const group = groupIndex === null ? null : summary.groups[groupIndex];
  const components = useObjectRead(context, { objectKey: object.reference.objectKey, objectId: object.reference.objectId,
    relation: 'components', filters: group ? [group.filter] : [], limit: 20, offset }, !!group);
  return <section className="space-y-3" aria-label="组件类型构成">
    <div className="flex items-baseline justify-between gap-2"><h4 className="text-xs font-semibold">组件类型构成</h4>
      <span className="text-xs text-muted-foreground">全部 {summary.total} 个组件</span></div>
    <p className="text-[10px] leading-4 text-muted-foreground">按所选{object.reference.objectKey === 'easyv-prototype-layout' ? '原型' : '区域'}的全部组件统计，点击数量查看对应组件。</p>
    {summary.groups.length ? <div className="grid grid-cols-2 gap-2">{summary.groups.map((item, index) => <button
      key={item.chartFamily ?? 'missing-family'} type="button" aria-pressed={index === groupIndex}
      aria-label={`查看${chartPlaceholder(item.chartFamily).label} ${item.count} 个组件`}
      onClick={() => { setGroupIndex(index); setOffset(0); }}
      className={cn('flex min-w-0 items-center gap-2 rounded-lg border border-border px-3 py-2.5 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', index === groupIndex && 'border-primary bg-primary/5')}>
      <ComponentGlyph family={item.chartFamily ?? ''} metricStyle="number" className="h-5 w-7 shrink-0 text-primary" />
      <span className="min-w-0 flex-1 break-words text-xs">{chartPlaceholder(item.chartFamily).label}</span>
      <span className="shrink-0 text-lg font-semibold tabular-nums">{item.count}</span>
    </button>)}</div> : <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">所选对象在本轮数据版本中没有组件。</p>}
    {group ? <div className="space-y-2 rounded-lg bg-muted/30 p-3">
      <p className="text-xs font-medium">{chartPlaceholder(group.chartFamily).label} · 共 {group.count} 个</p>
      {components.isPending ? <Pending>正在读取对应组件…</Pending> : null}
      {components.error ? <Notice error={components.error} /> : null}
      {components.data ? <>
        <ObjectList title="对应组件" rows={components.data.page.rows} selected={null} onSelect={onSelect} />
        <div className="flex items-center justify-between gap-2"><span className="text-[10px] text-muted-foreground">第 {Math.floor(offset / 20) + 1} 页</span>
          <div className="flex gap-1"><Button type="button" variant="ghost" size="sm" aria-label="上一页对应组件" disabled={offset === 0} onClick={() => setOffset(offset - 20)}><ChevronLeft className="size-4" /></Button>
            <Button type="button" variant="ghost" size="sm" aria-label="下一页对应组件" disabled={!components.data.page.hasMore || offset + 20 > 10000} onClick={() => setOffset(offset + 20)}><ChevronRight className="size-4" /></Button></div>
        </div>
      </> : null}
    </div> : null}
  </section>;
}

function PrototypeDetail({ context, root, onObjectSelect }: { context: Context; root: Row; onObjectSelect?: SelectObject }) {
  const layoutId = typeof root.properties.appId === 'string' ? root.properties.appId : '';
  const layout = useObjectRead(context, { objectKey: 'easyv-prototype-layout', objectId: layoutId }, !!layoutId);
  const blocks = useRelated(context, layoutId, 'blocks');
  const components = useRelated(context, layoutId, 'components');
  const [focus, updateFocus] = useState<Row>(root);
  const [metricStyle, setMetricStyle] = useState<MetricPreviewStyle>('number');
  const [relation, setRelation] = useState<Type['links'][number] | null>(null);
  const setFocus = (row: Row) => { updateFocus(row); setRelation(null); };
  // 滚动发布时，旧 API 没有 dataContext；确认服务具备新契约后再请求构成统计。
  const detail = useObjectRead(context, { objectKey: focus.reference.objectKey, objectId: focus.reference.objectId,
    includeComponentSummary: layout.data?.dataContext && (focus.reference.objectKey === 'easyv-prototype-block'
      || focus.reference.objectKey === 'easyv-prototype-layout' && focus.properties.parseStatus === 'ok') ? true : undefined });
  const blockRows = blocks.data?.pages.flatMap((page) => page.page.rows) ?? [];
  const componentRows = components.data?.pages.flatMap((page) => page.page.rows) ?? [];
  const componentGeometry = components.data?.pages.some((page) => page.componentGeometry !== undefined)
    ? Object.assign({}, ...components.data.pages.map((page) => page.componentGeometry)) : undefined;
  const selected = detail.data?.page.rows[0] ?? focus;
  const focusedBlock = selected.reference.objectKey === 'easyv-prototype-block' ? selected.reference.objectId
    : selected.reference.objectKey === 'easyv-prototype-component' ? selected.properties.blockKey : null;
  const selectedBlock = typeof focusedBlock === 'string' ? focusedBlock : blockRows[0]?.reference.objectId;
  const selectedRegion = blockRows.find((row) => row.reference.objectId === selectedBlock);
  const regionComponents = useRelated(context, selectedBlock ?? '', 'components', 'easyv-prototype-block');
  const regionComponentRows = regionComponents.data?.pages.flatMap((page) => page.page.rows) ?? [];
  const regionGeometry = regionComponents.data?.pages.some((page) => page.componentGeometry !== undefined)
    ? Object.assign({}, ...regionComponents.data.pages.map((page) => page.componentGeometry)) : undefined;
  const structure = layout.data?.structure;
  const pages = structure?.status === 'available' ? projectPrototypeLayout(structure.layout, blockRows) : [];
  const type: Type | undefined = detail.data?.objectType;
  const related = useObjectRead(context, { objectKey: focus.reference.objectKey, objectId: focus.reference.objectId,
    relation: relation?.key, limit: 20 }, relation !== null);

  if (!layoutId) return <p role="alert" className="text-sm text-destructive">对象缺少所属应用 ID，无法定位原型。</p>;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2">
      <span className="text-sm font-medium">原型 {layoutId}</span>
      <Button type="button" variant="ghost" size="sm" onClick={() => { const row = layout.data?.page.rows[0]; if (row) setFocus(row); }} disabled={!layout.data}>版式属性</Button>
    </div>
    {layout.isPending || blocks.isPending ? <Pending>正在读取版式结构…</Pending> : null}
    {layout.error ? <Notice error={layout.error} /> : null}
    {blocks.error ? <Notice error={blocks.error} /> : null}
    {structure?.status === 'not_retained' ? <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">本轮使用的历史版本未保留布局树。可以查看对象属性；重新采集并发布后，新分析才能展示结构图。</p> : null}
    {structure?.status === 'parse_failed' ? <p className="rounded-lg border border-destructive/25 p-4 text-sm text-destructive">源原型结构解析失败。请在版式属性中查看解析错误代码。</p> : null}
    {!blocks.isPending && !blocks.error ? pages.map((page, index) => <section className="space-y-2" key={page.key}>
      <h4 className="text-xs font-medium text-muted-foreground">页面 {index + 1}{page.width && page.height ? ` · ${page.width} × ${page.height}` : ''} · 结构示意</h4>
      {page.items.length && page.width && page.height ? <div className="relative min-w-0 overflow-hidden rounded-lg border border-border bg-muted/30" style={{ aspectRatio: `${page.width} / ${page.height}` }}>
        {page.items.map((item) => {
          const style = { left: `${item.x / page.width! * 100}%`, top: `${item.y / page.height! * 100}%`, width: `${item.width / page.width! * 100}%`, height: `${item.height / page.height! * 100}%` };
          return item.objectId ? <button key={item.key} type="button" title={item.label} aria-label={`选择区域 ${item.label}`} aria-pressed={item.objectId === selectedBlock}
            onClick={() => { const row = blockRows.find((candidate) => candidate.reference.objectId === item.objectId); if (row) setFocus(row); }}
            className={cn('absolute flex items-center justify-center overflow-hidden rounded-sm border border-primary/30 bg-primary/5 p-1 text-[10px] text-primary hover:bg-primary/15 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring', item.objectId === selectedBlock && 'border-primary bg-primary/20 ring-2 ring-inset ring-primary')} style={style}>
            <span className="truncate">{item.label}</span>
          </button> : <div key={item.key} style={style} title={item.label} className="absolute flex items-center justify-center overflow-hidden border border-dashed border-muted-foreground/40 p-1 text-[10px] text-muted-foreground"><span className="truncate">{item.kind === 'content' ? '主视觉' : item.label}</span></div>;
        })}
      </div> : null}
      {page.diagnostics.map((message) => <p key={message} className="text-xs text-muted-foreground" role="status">{message}</p>)}
    </section>) : null}
    {blocks.data?.pages.at(-1)?.page.hasMore ? <p className="text-xs text-muted-foreground">区域尚未读取完整，加载更多后补齐对象关联。</p> : null}
    <p className="text-xs leading-5 text-muted-foreground">选择区域，查看它的组件结构。图形和数字均为示意，不代表实际业务数据。</p>
    {blocks.data ? <div className="@container">
    <div className="grid items-start gap-3 @min-[320px]:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
      <section className="min-w-0 space-y-2" aria-label="原型区域列表">
        <h4 className="text-xs font-semibold text-muted-foreground">区域 · {blockRows.length}{blocks.hasNextPage ? '+' : ''}</h4>
        <div className="max-h-96 overflow-y-auto rounded-lg border border-border">
          {!blockRows.length ? <p className="px-3 py-3 text-xs text-muted-foreground">本轮冻结数据中没有关联区域。</p> : null}
          {blockRows.map((row) => <button key={row.reference.objectId} type="button" aria-label={`选择区域 ${label(row)}`} aria-pressed={row.reference.objectId === selectedBlock}
            title={label(row)} onClick={() => setFocus(row)} className={cn('flex w-full flex-col items-start gap-2 border-b border-border/50 px-2 py-3 text-left last:border-0 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring', row.reference.objectId === selectedBlock && 'bg-primary/10 text-primary')}>
            <PrototypeComponentPreview rows={componentRows.filter((component) => component.properties.blockKey === row.reference.objectId)} geometry={componentGeometry} metricStyle={metricStyle} thumbnail />
            <span className="min-w-0 space-y-1"><span className="block break-all text-xs font-medium">{regionLabel(row)}</span><span className="block whitespace-nowrap text-[10px] text-muted-foreground">{String(row.properties.componentCount ?? '—')} 个组件</span></span>
          </button>)}
        </div>
        {components.error ? <Notice error={components.error} /> : null}
        {components.hasNextPage ? <Button type="button" variant="ghost" size="sm" disabled={components.isFetchingNextPage} onClick={() => { void components.fetchNextPage(); }}>补齐结构缩略图</Button> : null}
        {blocks.hasNextPage ? <Button type="button" variant="outline" size="sm" disabled={blocks.isFetchingNextPage} onClick={() => { void blocks.fetchNextPage(); }}>加载更多区域</Button> : null}
      </section>
      <section className="min-w-0 space-y-3" aria-label="所选区域组件">
        <div className="space-y-1"><h4 className="break-all text-xs font-semibold">{selectedRegion ? regionLabel(selectedRegion) : '区域组件'}</h4>
          <p className="text-[10px] text-muted-foreground">{regionComponents.isPending ? '组件结构' : `${regionComponentRows.length}${regionComponents.hasNextPage ? '+' : ''} 个组件 · ${regionGeometry === undefined ? '近似栅格布局' : '源比例布局'}`}</p></div>
        {selectedBlock && regionComponents.isPending ? <Pending>正在读取区域组件…</Pending> : null}
        {regionComponents.error ? <Notice error={regionComponents.error} /> : null}
        {regionComponents.data ? <>
          {regionComponentRows.some((row) => row.properties.chartFamily === 'single-value-metric') ? <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-1" role="group" aria-label="单值指标示意样式">
              <span className="mr-1 text-[10px] text-muted-foreground">单值指标示意</span>
              {(['number', 'flip'] as const).map((style) => <Button key={style} type="button" size="sm" variant={metricStyle === style ? 'secondary' : 'ghost'} className="h-7 px-2 text-[10px]" aria-pressed={metricStyle === style} onClick={() => setMetricStyle(style)}>{style === 'number' ? '数字卡' : '翻牌器'}</Button>)}
            </div>
            <p className="text-[10px] leading-4 text-muted-foreground">源数据未区分这两种样式，可切换查看示意。</p>
          </div> : null}
          {regionComponentRows.length ? <PrototypeComponentPreview rows={regionComponentRows} geometry={regionGeometry} metricStyle={metricStyle} selected={selected.reference.objectId} onSelect={setFocus} />
            : <p className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">该区域没有关联组件。</p>}
          <div className="space-y-1.5">{regionComponentRows.map((row, index) => {
            const { label: chartLabel } = chartPlaceholder(row.properties.chartFamily);
            return <button key={row.reference.objectId} type="button" aria-label={`查看组件 ${label(row)}`} aria-pressed={selected.reference.objectId === row.reference.objectId}
              onClick={() => setFocus(row)} className={cn('flex w-full items-center gap-2 rounded-lg border border-border bg-background px-2 py-2 text-left text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', selected.reference.objectId === row.reference.objectId && 'border-primary bg-primary/10 text-primary')}>
              <ComponentGlyph family={String(row.properties.chartFamily ?? '')} metricStyle={metricStyle} className="h-5 w-8 shrink-0 text-primary" /><span className="min-w-0 flex-1 break-all">{chartLabel}</span><span className="text-[10px] text-muted-foreground">{index + 1}</span>
            </button>;
          })}</div>
          {regionComponents.hasNextPage ? <Button type="button" variant="outline" size="sm" disabled={regionComponents.isFetchingNextPage} onClick={() => { void regionComponents.fetchNextPage(); }}>加载更多组件</Button> : null}
        </> : null}
      </section>
    </div>
    </div> : null}
    <section className="space-y-3 border-t border-border pt-4" aria-label="所选对象属性">
      <h4 className="text-sm font-semibold">{type?.label ?? '对象属性'} · {label(selected)}</h4>
      {onObjectSelect ? <Button type="button" size="sm" variant="outline" disabled={!detail.data?.page.rows[0] || !type}
        onClick={() => { if (detail.data?.page.rows[0] && type) onObjectSelect({ executionId: detail.data.executionId,
          datasetVersionSetId: detail.data.datasetVersionSetId, reference: selected.reference }, `${type.label} · ${label(selected)}`); }}>
        针对这个对象追问
      </Button> : null}
      {detail.isPending ? <Pending>正在读取对象属性…</Pending> : null}
      {detail.error ? <Notice error={detail.error} /> : null}
      {selected.reference.objectKey === 'easyv-prototype-layout' && selected.properties.parseStatus !== 'ok'
        ? <p className="text-xs text-muted-foreground">原型结构未成功解析，暂无组件构成统计。解析状态与错误码见下方属性。</p> : null}
      {detail.data?.componentSummary ? <ComponentComposition key={`${context.executionId}:${context.datasetVersionSetId}:${selected.reference.objectKey}:${selected.reference.objectId}`}
        context={context} object={selected} summary={detail.data.componentSummary} onSelect={setFocus} /> : null}
      {type ? <dl className="grid grid-cols-[minmax(5rem,auto)_minmax(0,1fr)] gap-x-4 gap-y-2 text-xs">
        {type.properties.map((property) => <div key={property.key} className="contents"><dt className="text-muted-foreground">{property.label}</dt><dd className="break-all">{String(selected.properties[property.key] ?? '未提供')}</dd></div>)}
      </dl> : null}
      {selected.reference.objectKey === 'easyv-prototype-block' && detail.data?.page.rows[0] ? <SchemeAssessmentPanel key={`${selected.reference.objectId}:${selected.reference.productVersionId}`} sessionId={context.sessionId}
        selection={{ executionId: context.executionId, datasetVersionSetId: context.datasetVersionSetId, reference: selected.reference }} /> : null}
      {type?.links.length ? <div className="flex flex-wrap gap-2">{type.links.map((link) => <Button key={link.key} type="button" variant="outline" size="sm"
        aria-pressed={relation?.key === link.key} onClick={() => setRelation(link)}>查看{link.targetLabel}</Button>)}</div> : null}
      {relation ? <div className="space-y-2">{related.isPending ? <Pending>正在读取关联对象…</Pending> : null}
        {related.error ? <Notice error={related.error} /> : null}
        {related.data ? <><ObjectList title={relation.targetLabel} rows={related.data.page.rows} selected={selected} onSelect={setFocus} />
          {related.data.page.hasMore ? <p className="text-xs text-muted-foreground">显示前 20 个关联对象。完整区域和组件可在上方列表中继续加载。</p> : null}</> : null}
      </div> : null}
      <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">数据出处与版本</summary>
        {detail.data?.dataContext ? <div className="mt-2 space-y-1 leading-5">
          <p>集合捕获时间：{formatShanghaiDateTime(detail.data.dataContext.capturedAt)}（北京时间）</p>
          <p>有效权限范围：{detail.data.dataContext.scopeDescription}</p>
          <p>组件构成只统计所选原型或区域。集合捕获时间表示本轮数据版本的捕获时间；原型创建时间是源属性，均不代表组件最后编辑时间。</p>
        </div> : null}
        <p className="mt-2 break-all leading-5">对象：{selected.reference.objectId}<br />产品版本：{selected.reference.productVersionId}<br />冻结集合：{context.datasetVersionSetId}<br />来源执行：{context.executionId}</p>
      </details>
    </section>
  </div>;
}

function ObjectBrowser({ context, objectKey, filters, drilldownId, scopeDescription, onObjectSelect }: {
  context: Context; objectKey: JavaObjectReadRequest['objectKey']; filters: JavaObjectReadRequest['filters']; drilldownId?: string | null; scopeDescription: string; onObjectSelect?: SelectObject;
}) {
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Row | null>(null);
  const list = useObjectRead(context, { objectKey, filters, drilldownId, limit: 20, offset });
  const root = selected ?? list.data?.page.rows[0];
  return <div className="space-y-5" data-testid="analysis-object-browser">
    <p className="text-xs leading-5 text-muted-foreground">{scopeDescription}</p>
    {list.isPending ? <Pending>正在读取本轮对象…</Pending> : null}
    {list.error ? <Notice error={list.error} /> : null}
    {list.data ? <>
      {!list.data.page.rows.length ? <div className="rounded-xl border border-dashed border-border p-6 text-center"><Layers3 className="mx-auto mb-3 size-6 text-muted-foreground" aria-hidden /><p className="text-sm font-medium">当前范围没有可查看的对象</p><p className="mt-1 text-xs text-muted-foreground">可以调整分析条件后重新发起分析。</p></div> : <ObjectList title={list.data.objectType.label} rows={list.data.page.rows} selected={root ?? null} onSelect={setSelected} />}
      <div className="flex items-center justify-between gap-2"><span className="text-xs text-muted-foreground">第 {Math.floor(offset / 20) + 1} 页</span><div className="flex gap-1">
        <Button type="button" size="sm" variant="ghost" aria-label="上一页对象" disabled={!offset || list.isFetching} onClick={() => { setOffset(offset - 20); setSelected(null); }}><ChevronLeft className="size-4" /></Button>
        <Button type="button" size="sm" variant="ghost" aria-label="下一页对象" disabled={!list.data.page.hasMore || offset >= 10000 || list.isFetching} onClick={() => { setOffset(offset + 20); setSelected(null); }}><ChevronRight className="size-4" /></Button>
      </div></div>
    </> : null}
    {root ? <PrototypeDetail key={`${root.reference.objectKey}:${root.reference.objectId}`} context={context} root={root} onObjectSelect={onObjectSelect} /> : null}
  </div>;
}

export function renderObjectBrowserBlock({ renderedBlock, onObjectSelect }: AnalysisInteractionUiRenderInput) {
  const payload = browserPayload.safeParse(renderedBlock.payload);
  const { sessionId, executionId } = renderedBlock.source;
  if (!payload.success || !sessionId || !executionId) return <p role="alert" className="text-sm text-destructive">原型查看入口缺少有效的执行上下文，无法读取对象。</p>;
  return <ObjectBrowser key={`${executionId}:${payload.data.drilldownId ?? 'query-scope'}`} context={{ sessionId, executionId, datasetVersionSetId: payload.data.datasetVersionSetId }}
    objectKey={payload.data.objectKey} filters={payload.data.filters} drilldownId={payload.data.drilldownId} scopeDescription={payload.data.scopeDescription} onObjectSelect={onObjectSelect} />;
}
