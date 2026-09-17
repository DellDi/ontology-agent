'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowUpRight, Search, Trash2 } from 'lucide-react';

import type { WorkspaceHomeModel } from '@/application/workspace/home';
import { filterWorkspaceHistory, sessionToHistoryItem } from '@/application/workspace/home';
import { JOB_STATUSES } from '@/domain/job-contract/models';
import { Input } from '@/components/ui/input';
import { z } from 'zod';

const FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'running', label: '进行中' },
  { value: 'failed', label: '待处理' },
  { value: 'completed', label: '已完成' },
] as const;

type SessionPage = WorkspaceHomeModel['sessionPage'];
type HistoryItem = WorkspaceHomeModel['historyItems'][number];

// 客户端"加载更多"最小校验：SSR 首屏已用完整 javaWorkspaceHomeSchema 校验同端点。
const pagedSessionsSchema = z.object({
  sessions: z.array(z.object({
    id: z.string().min(1),
    questionText: z.string().min(1),
    savedContext: z.record(z.string(), z.unknown()),
    updatedAt: z.string().min(1),
    latestExecution: z.object({
      executionId: z.string(),
      status: z.enum(JOB_STATUSES),
      conclusionState: z.object({ causes: z.array(z.object({ title: z.string() })) }).nullable(),
      failurePoint: z.object({ title: z.string() }).nullable(),
      capabilityBinding: z.union([
        z.object({ domainKey: z.string(), capabilityKey: z.string() }).passthrough(),
        z.object({ source: z.literal('legacy/unknown') }).passthrough(),
      ]).nullable(),
    }).nullable(),
  })),
  sessionPage: z.object({
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
    hasMore: z.boolean(),
  }),
});
type JavaHomeSession = z.infer<typeof pagedSessionsSchema>['sessions'][number];

function snapshotFromSummary(session: JavaHomeSession) {
  const execution = session.latestExecution;
  if (!execution) return null;
  return {
    executionId: execution.executionId,
    status: execution.status,
    capabilityBinding: execution.capabilityBinding ?? undefined,
    conclusionState: execution.conclusionState,
    failurePoint:
      execution.failurePoint && typeof execution.failurePoint.title === 'string'
        ? { title: execution.failurePoint.title }
        : null,
  };
}

export function WorkspaceSessionList({ items, sessionPage, canCreateAnalysis }: { items: WorkspaceHomeModel['historyItems']; sessionPage: SessionPage; canCreateAnalysis: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState<(typeof FILTERS)[number]['value']>('all');
  const [query, setQuery] = useState('');
  const [extraItems, setExtraItems] = useState<HistoryItem[]>([]);
  const [page, setPage] = useState<SessionPage>(sessionPage);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [deleteError, setDeleteError] = useState<{ id: string; message: string } | null>(null);
  const allItems = [...items, ...extraItems].filter((item) => !deletedIds.has(item.id));
  const visible = filterWorkspaceHistory(allItems, status, query);

  async function deleteSession(item: HistoryItem) {
    setDeletingId(item.id);
    setDeleteError(null);
    try {
      const response = await fetch(`/api/analysis/sessions/${encodeURIComponent(item.id)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (!response.ok) {
        let message = `删除失败（${response.status}）`;
        try {
          const body = await response.json();
          if (typeof body?.error === 'string' && body.error) message = body.error;
        } catch { /* 非 JSON 响应保留默认文案 */ }
        throw new Error(message);
      }
      setDeletedIds((current) => new Set(current).add(item.id));
      setConfirmingId(null);
      router.refresh();
    } catch (error) {
      setDeleteError({ id: item.id, message: error instanceof Error ? error.message : '删除失败，请稍后重试。' });
    } finally {
      setDeletingId(null);
    }
  }

  async function loadMore() {
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const response = await fetch(`/api/workspace/home?sessionOffset=${page.offset + page.limit}&sessionLimit=${page.limit}`, { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`加载失败（${response.status}）`);
      const parsed = pagedSessionsSchema.parse(await response.json());
      const appended = parsed.sessions.map((session) => sessionToHistoryItem(session, snapshotFromSummary(session)));
      setExtraItems((current) => {
        const seen = new Set([...items, ...current].map((item) => item.id));
        return [...current, ...appended.filter((item) => !seen.has(item.id))];
      });
      setPage(parsed.sessionPage);
    } catch {
      setLoadMoreError('加载更多失败，请稍后重试。');
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section id="history" aria-labelledby="history-title" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 id="history-title" className="text-base font-semibold text-foreground">分析记录</h2>
        <div className="relative w-full sm:w-60">
          <Search aria-hidden="true" className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input aria-label="搜索分析记录" placeholder="搜索问题或领域" value={query} onChange={event => setQuery(event.target.value)} className="pl-9" />
        </div>
      </div>
      <div role="group" aria-label="按分析状态筛选" className="flex flex-wrap gap-1 border-b border-border pb-3">
        {FILTERS.map(filter => (
          <button key={filter.value} type="button" aria-pressed={status === filter.value}
            onClick={() => setStatus(filter.value)}
            className={`rounded-md px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${status === filter.value ? 'bg-secondary font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
            {filter.label}<span className="ml-2 tabular-nums text-muted-foreground">{filterWorkspaceHistory(allItems, filter.value, '').length}</span>
          </button>
        ))}
      </div>
      <p className="sr-only" role="status">找到 {visible.length} 条分析记录</p>
      {visible.length ? (
        <ul className="divide-y divide-border">
          {visible.map(item => (
            <li key={item.id}>
              <div className="group flex items-start gap-2">
                <Link href={item.href} className="flex min-w-0 flex-1 items-start gap-4 rounded-sm px-2 py-5 transition-colors hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <div className="min-w-0 flex-1">
                    <h3 className="break-words text-sm font-medium leading-6 text-foreground group-hover:text-primary">{item.title}</h3>
                    {item.failureMessage ? <p className={`mt-1 text-sm leading-6 ${item.derivedStatus === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>{item.failureMessage}</p> : null}
                    <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"><span>{item.domainLabel}</span><span>{item.updatedAtLabel}</span></p>
                  </div>
                  <span className={`mt-1 shrink-0 text-xs ${item.derivedStatus === 'failed' ? 'text-destructive' : item.derivedStatus === 'running' ? 'text-primary' : 'text-muted-foreground'}`}>{item.statusLabel}</span>
                  <ArrowUpRight aria-hidden="true" className="mt-1 hidden size-4 shrink-0 text-muted-foreground sm:block" />
                </Link>
                <button
                  aria-label={`删除会话：${item.title}`}
                  className="mt-5 shrink-0 rounded-md p-1.5 text-muted-foreground/70 transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => { setConfirmingId(item.id); setDeleteError(null); }}
                  type="button"
                >
                  <Trash2 aria-hidden="true" className="size-4" />
                </button>
              </div>
              {confirmingId === item.id ? (
                <div className="mx-2 mb-3 flex flex-wrap items-center gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5">
                  <p className="min-w-0 flex-1 text-xs leading-5 text-foreground">
                    删除这条分析记录？该会话的全部轮次与执行记录将一并删除，不可恢复。
                  </p>
                  {deleteError?.id === item.id ? (
                    <p className="text-xs text-destructive">{deleteError.message}</p>
                  ) : null}
                  <div className="flex shrink-0 gap-2">
                    <button
                      className="rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground transition-opacity disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      disabled={deletingId === item.id}
                      onClick={() => deleteSession(item)}
                      type="button"
                    >
                      {deletingId === item.id ? '删除中…' : '确认删除'}
                    </button>
                    <button
                      className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      disabled={deletingId === item.id}
                      onClick={() => { setConfirmingId(null); setDeleteError(null); }}
                      type="button"
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <div className="py-12 text-center">
          <p className="text-sm font-medium text-foreground">{allItems.length ? '没有匹配的分析' : '还没有分析记录'}</p>
          <p className="mt-2 text-sm text-muted-foreground">{allItems.length ? '调整状态或搜索词后再试。' : canCreateAnalysis ? '在上方输入问题，开始第一轮分析。' : '获得分析权限后即可发起分析。'}</p>
          {allItems.length ? <button type="button" onClick={() => { setQuery(''); setStatus('all'); }} className="mt-4 rounded-sm text-sm text-primary underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring">清除筛选</button> : null}
        </div>
      )}
      {page.hasMore ? (
        <div className="flex flex-col items-center gap-2 pt-2">
          <button type="button" onClick={loadMore} disabled={loadingMore}
            className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {loadingMore ? '加载中…' : `加载更多（已显示 ${allItems.length}/${page.total}）`}
          </button>
          {loadMoreError ? <p className="text-xs text-destructive">{loadMoreError}</p> : null}
        </div>
      ) : page.total > 0 ? (
        <p className="pt-2 text-center text-xs text-muted-foreground">已显示全部 {page.total} 条</p>
      ) : null}
    </section>
  );
}
