'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ScreenReviewPicker } from '../analysis/[sessionId]/_components/renderer/screen-review-picker';
import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ArrowUpRight, ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { projectPrototypeLayout } from '@/application/prototype-layout/project-layout';
import { objectRecordTitle, objectPropertyText } from '@/application/object-collection/presentation';
import { formatShanghaiDateTime } from '@/lib/format-datetime';
import { startCatalogReview, readWorkspaceCatalog, type WorkspaceCatalogRequest, type WorkspaceCatalogResult } from '@/infrastructure/java-backend/workspace-catalog';
import { PrototypeLayoutCanvas } from '../analysis/[sessionId]/_components/renderer/prototype-layout-canvas';
import { MetricDefinition } from '../analysis/[sessionId]/_components/renderer/metric-definition';
import { chartPlaceholder } from '../analysis/[sessionId]/_components/renderer/prototype-component-preview';

type Row = WorkspaceCatalogResult['page']['rows'][number];
function useCatalog(request: WorkspaceCatalogRequest, enabled = true) {
  return useQuery({ queryKey: ['workspace-catalog', request], queryFn: ({ signal }) => readWorkspaceCatalog(request, signal), enabled, retry: false, gcTime: 0 });
}
function useCatalogRelation(appId: string, version: string, relation: 'blocks' | 'components') {
  return useInfiniteQuery({ queryKey: ['workspace-catalog-relation', appId, version, relation], initialPageParam: 0,
    queryFn: ({ signal, pageParam }) => readWorkspaceCatalog({ objectId: appId, datasetVersionSetId: version, relation, limit: 200, offset: pageParam }, signal),
    getNextPageParam: data => data.page.hasMore && data.page.offset + data.page.limit <= 10000 ? data.page.offset + data.page.limit : undefined,
    retry: false, gcTime: 0,
  });
}
function ReadError({ error, retry }: { error: Error; retry: () => void }) {
  return <div role="alert" className="space-y-2 py-4 text-sm"><p className="text-destructive">{error.message}</p><Button variant="outline" size="sm" onClick={retry}>重新读取</Button></div>;
}
function title(row: Row, type: WorkspaceCatalogResult['objectType']) { return objectRecordTitle(row.properties, type); }

export function PrototypeCatalog({ initialObjectId, initialVersion }: { initialObjectId?: string; initialVersion?: string }) {
  const router = useRouter();
  const [reviewing, setReviewing] = useState(false);
  const [draft, setDraft] = useState('');
  const [scope, setScope] = useState({ search: '', offset: 0, datasetVersionSetId: undefined as string | undefined });
  const [selected, setSelected] = useState<{ id: string; version?: string } | null>(initialObjectId ? { id: initialObjectId, version: initialVersion } : null);
  const previewRef = useRef<HTMLDivElement>(null);
  const selectedTrigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (selected?.id && window.matchMedia('(max-width: 1279px)').matches) {
      previewRef.current?.focus({ preventScroll: true });
      previewRef.current?.scrollIntoView({ block: 'start' });
    }
  }, [selected?.id]);
  const list = useCatalog({ ...scope, limit: 12 });
  const data = list.data;
  const move = (offset: number) => setScope({ ...scope, offset, datasetVersionSetId: data?.datasetVersionSetId ?? scope.datasetVersionSetId });
  return <section className="mx-auto w-full max-w-6xl space-y-6" aria-label="大屏目录">
    <header className="flex flex-wrap items-baseline justify-between gap-3">
      <h1 className="text-2xl font-semibold tracking-tight">大屏目录</h1>
      <Link href="/workspace" className="py-2 text-sm text-muted-foreground hover:text-primary">新建分析<ArrowUpRight aria-hidden className="ml-1 inline size-3.5" /></Link>
    </header>
    <form className="flex max-w-md gap-2" onSubmit={event => { event.preventDefault(); setScope({ search: draft.trim(), offset: 0, datasetVersionSetId: undefined }); setSelected(null); }}>
      <div className="relative min-w-0 flex-1"><Search aria-hidden className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input aria-label="搜索大屏名称" placeholder="搜索大屏名称" maxLength={200} value={draft} onChange={event => setDraft(event.target.value)} className="pl-9" /></div>
      <Button type="submit" variant="outline">搜索</Button>
    </form>
    <Button variant="outline" onClick={() => setReviewing(value => !value)}>{reviewing ? '收起检查范围' : '选择大屏一起检查与改进'}</Button>
    {reviewing ? <ScreenReviewPicker data={data} onStartCatalog={async (selection, purpose) => {
      const sessionId = await startCatalogReview(selection, purpose);
      router.push(`/workspace/analysis/${sessionId}`);
    }} /> : null}
    <div className={selected ? 'grid items-start gap-6 xl:grid-cols-[240px_minmax(0,1fr)]' : ''}>
      <div className="space-y-4">
        {list.isPending ? <p role="status" className="py-6 text-sm text-muted-foreground">正在读取大屏…</p> : null}
        {list.error ? <ReadError error={list.error} retry={() => { void list.refetch(); }} /> : null}
        {data ? <>
          {!data.page.rows.length ? <p className="py-8 text-sm text-muted-foreground">{scope.search ? '没有匹配的大屏，请换个名称搜索。' : '当前权限范围内没有大屏原型。'}</p> : reviewing ? null : <ul className="divide-y divide-border">
            {data.page.rows.map(row => <li key={row.reference.objectId}>
              <button type="button" aria-pressed={selected?.id === row.reference.objectId} onClick={event => { selectedTrigger.current = event.currentTarget; setSelected({ id: row.reference.objectId, version: data.datasetVersionSetId }); }}
                className={`w-full space-y-2 rounded-sm px-3 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected?.id === row.reference.objectId ? 'bg-accent' : 'hover:bg-secondary/60'}`}>
                <span className="block text-sm font-medium">{title(row, data.objectType)}</span>
                <span className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>{row.properties.blockCount ?? '—'} 个区域 · {row.properties.componentCount ?? '—'} 个组件</span>
                  {row.properties.createdAt ? <span>{formatShanghaiDateTime(String(row.properties.createdAt))}</span> : null}
                </span>
              </button>
            </li>)}
          </ul>}
          {scope.offset > 0 || data.page.hasMore ? <nav className="flex items-center justify-between text-sm" aria-label="大屏目录分页">
            <Button variant="ghost" size="sm" aria-label="上一页大屏" disabled={!scope.offset} onClick={() => move(Math.max(0, scope.offset - 12))}><ChevronLeft aria-hidden className="size-4" /></Button>
            <span className="text-xs text-muted-foreground">第 {scope.offset / 12 + 1} 页</span>
            <Button variant="ghost" size="sm" aria-label="下一页大屏" disabled={!data.page.hasMore || scope.offset + 12 > 10000} onClick={() => move(scope.offset + 12)}><ChevronRight aria-hidden className="size-4" /></Button>
          </nav> : null}
        </> : null}
      </div>
      {selected ? <div ref={previewRef} tabIndex={-1} className="min-w-0 scroll-mt-5 outline-none"><CatalogPreview key={`${selected.id}:${selected.version}`} appId={selected.id} version={selected.version} onClose={() => { setSelected(null); selectedTrigger.current?.focus(); }} /></div> : null}
    </div>
    {data?.dataContext ? <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">数据出处</summary><p className="mt-2 leading-6">采集于 {formatShanghaiDateTime(data.dataContext.capturedAt)} · {data.dataContext.scopeDescription}</p><p className="break-all">{data.datasetVersionSetId}</p></details> : null}
  </section>;
}

function CatalogPreview({ appId, version, onClose }: { appId: string; version?: string; onClose: () => void }) {
  const layout = useCatalog({ objectId: appId, datasetVersionSetId: version });
  if (!layout.data) return <div>
    <div className="flex justify-end"><Button aria-label="关闭大屏预览" size="icon-sm" variant="ghost" onClick={onClose}><X aria-hidden className="size-4" /></Button></div>
    {layout.error ? <ReadError error={layout.error} retry={() => { void layout.refetch(); }} /> : <p role="status" className="py-6 text-sm text-muted-foreground">正在读取原型结构…</p>}
  </div>;
  return <CatalogStructure key={layout.data.datasetVersionSetId} layout={layout.data} appId={appId} onClose={onClose} />;
}

function CatalogStructure({ layout, appId, onClose }: { layout: WorkspaceCatalogResult; appId: string; onClose: () => void }) {
  const blocks = useCatalogRelation(appId, layout.datasetVersionSetId, 'blocks');
  const components = useCatalogRelation(appId, layout.datasetVersionSetId, 'components');
  const [selected, setSelected] = useState<Row | null>(null);
  const blockRows = blocks.data?.pages.flatMap(page => page.page.rows) ?? [];
  const componentRows = components.data?.pages.flatMap(page => page.page.rows) ?? [];
  const geometry = Object.assign({}, ...components.data?.pages.map(page => page.componentGeometry ?? {}) ?? []);
  const root = layout.page.rows[0];
  const pages = layout.structure?.status === 'available' ? projectPrototypeLayout(layout.structure.layout, blockRows) : [];
  const displayName = title(root, layout.objectType);
  return <div className="min-w-0 space-y-5 border-t border-border pt-5 xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0">
    <header className="flex items-start justify-between gap-3"><div className="space-y-2"><h2 className="text-lg font-semibold">{displayName}</h2><p className="text-xs text-muted-foreground">结构预览 · 非业务实况</p></div><Button aria-label="关闭大屏预览" size="icon-sm" variant="ghost" onClick={onClose}><X aria-hidden className="size-4" /></Button></header>
    {blocks.isPending || components.isPending ? <p role="status" className="text-sm text-muted-foreground">正在读取区域与组件…</p> : null}
    {blocks.error ? <ReadError error={blocks.error} retry={() => { void blocks.refetch(); }} /> : null}
    {components.error ? <ReadError error={components.error} retry={() => { void components.refetch(); }} /> : null}
    {layout.structure?.status === 'parse_failed' ? <p role="alert" className="text-sm text-destructive">原型结构解析失败，当前无法预览。</p> : null}
    {layout.structure?.status === 'not_retained' ? <p className="text-sm text-muted-foreground">此版本未保留原型结构。</p> : null}
    <PrototypeLayoutCanvas pages={pages} blocks={blockRows} components={componentRows} componentGeometry={geometry} pageSemantics={root.properties.pageSemantics}
      selectedBlockId={selected?.reference.objectKey === 'easyv-prototype-component' ? String(selected.properties.blockKey) : selected?.reference.objectId}
      onSelect={setSelected} getLabel={row => blocks.data ? title(row, blocks.data.pages[0].objectType) : '区域'} />
    {blocks.hasNextPage || components.hasNextPage ? <div className="flex flex-wrap gap-3">
      {blocks.hasNextPage ? <Button size="sm" variant="outline" disabled={blocks.isFetchingNextPage} onClick={() => { void blocks.fetchNextPage(); }}>加载更多区域</Button> : null}
      {components.hasNextPage ? <Button size="sm" variant="outline" disabled={components.isFetchingNextPage} onClick={() => { void components.fetchNextPage(); }}>加载更多组件</Button> : null}
    </div> : null}
    {selected ? <CatalogObjectDetails key={`${selected.reference.objectKey}:${selected.reference.objectId}`} row={selected} version={layout.datasetVersionSetId}
      components={componentRows.filter(row => row.properties.blockKey === (selected.properties.blockKey ?? selected.reference.objectId))}
      componentsComplete={!components.isPending && !components.hasNextPage && !components.error} onSelect={setSelected} /> : <p className="text-sm text-muted-foreground">选择区域查看指标与用途。</p>}
    <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-4 text-sm">
      {layout.sourceUrl ? <a href={layout.sourceUrl} target="_blank" rel="noopener noreferrer" className="py-2 text-muted-foreground hover:text-primary">在 EasyV 查看</a> : null}
    </div>
  </div>;
}

function CatalogObjectDetails({ row, version, components, componentsComplete, onSelect }: { row: Row; version: string; components: Row[]; componentsComplete: boolean; onSelect: (row: Row) => void }) {
  const detail = useCatalog({ objectKey: row.reference.objectKey as 'easyv-prototype-block' | 'easyv-prototype-component', objectId: row.reference.objectId, datasetVersionSetId: version });
  if (detail.error) return <ReadError error={detail.error} retry={() => { void detail.refetch(); }} />;
  if (!detail.data) return <p role="status" className="text-sm text-muted-foreground">正在读取指标详情…</p>;
  const object = detail.data.page.rows[0];
  const fields = detail.data.objectType.properties.filter(property => !property.identifier && !property.title && property.type !== 'TIME'
    && (property.prominent || ['metricUnit','aggregationRule','metricDescription'].includes(property.key))
    && object.properties[property.key] != null && object.properties[property.key] !== '' && object.properties[property.key] !== title(object, detail.data!.objectType));
  return <section className="space-y-4 border-t border-border pt-5" aria-label="目录对象详情">
    <h3 className="text-base font-semibold">{title(object, detail.data.objectType)}</h3>
    {object.properties.metricRole === 'core' ? <p className="text-xs font-medium text-primary">核心指标</p> : null}
    <dl className="space-y-3 text-sm">{fields.map(property => <div key={property.key}><dt className="mb-1 text-xs text-muted-foreground">{property.label}</dt><dd className="whitespace-pre-wrap leading-6">{objectPropertyText(property, object.properties[property.key])}</dd></div>)}</dl>
    {object.properties.metricRole === 'core' ? <div className="space-y-4">
      {components.map(component => <CatalogMetricDefinition key={component.reference.objectId} row={component} version={version} />)}
      {!components.length && componentsComplete ? <p className="text-sm text-muted-foreground">该核心区尚未配置指标。</p> : null}
    </div> : null}
    {object.reference.objectKey === 'easyv-prototype-block' && object.properties.metricRole !== 'core' && components.length ? <div className="space-y-2"><h4 className="text-xs text-muted-foreground">指标</h4>
      <div className="flex flex-wrap gap-2">{components.map(component => <Button key={component.reference.objectId} size="sm" variant="outline" onClick={() => onSelect(component)}>{String(component.properties.metricName || chartPlaceholder(component.properties.chartFamily).label)}</Button>)}</div>
    </div> : null}
  </section>;
}

function CatalogMetricDefinition({ row, version }: { row: Row; version: string }) {
  const detail = useCatalog({ objectKey: 'easyv-prototype-component', objectId: row.reference.objectId, datasetVersionSetId: version });
  if (detail.error) return <ReadError error={detail.error} retry={() => { void detail.refetch(); }} />;
  const properties = detail.data?.page.rows[0]?.properties;
  return properties ? <MetricDefinition properties={properties} /> : <p role="status" className="text-sm text-muted-foreground">正在读取指标口径…</p>;
}
