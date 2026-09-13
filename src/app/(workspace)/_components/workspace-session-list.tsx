'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowUpRight, Search } from 'lucide-react';

import type { WorkspaceHomeModel } from '@/application/workspace/home';
import { filterWorkspaceHistory } from '@/application/workspace/home';
import { Input } from '@/components/ui/input';

const FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'running', label: '进行中' },
  { value: 'failed', label: '待处理' },
  { value: 'completed', label: '已完成' },
] as const;

export function WorkspaceSessionList({ items, canCreateAnalysis }: { items: WorkspaceHomeModel['historyItems']; canCreateAnalysis: boolean }) {
  const [status, setStatus] = useState<(typeof FILTERS)[number]['value']>('all');
  const [query, setQuery] = useState('');
  const visible = filterWorkspaceHistory(items, status, query);

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
            {filter.label}<span className="ml-2 tabular-nums text-muted-foreground">{filterWorkspaceHistory(items, filter.value, '').length}</span>
          </button>
        ))}
      </div>
      <p className="sr-only" role="status">找到 {visible.length} 条分析记录</p>
      {visible.length ? (
        <ul className="divide-y divide-border">
          {visible.map(item => (
            <li key={item.id}>
              <Link href={item.href} className="group flex items-start gap-4 rounded-sm px-2 py-5 transition-colors hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <div className="min-w-0 flex-1">
                  <h3 className="break-words text-sm font-medium leading-6 text-foreground group-hover:text-primary">{item.title}</h3>
                  {item.failureMessage ? <p className={`mt-1 text-sm leading-6 ${item.derivedStatus === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>{item.failureMessage}</p> : null}
                  <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"><span>{item.domainLabel}</span><span>{item.updatedAtLabel}</span></p>
                </div>
                <span className={`mt-1 shrink-0 text-xs ${item.derivedStatus === 'failed' ? 'text-destructive' : item.derivedStatus === 'running' ? 'text-primary' : 'text-muted-foreground'}`}>{item.statusLabel}</span>
                <ArrowUpRight aria-hidden="true" className="mt-1 hidden size-4 shrink-0 text-muted-foreground sm:block" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="py-12 text-center">
          <p className="text-sm font-medium text-foreground">{items.length ? '没有匹配的分析' : '还没有分析记录'}</p>
          <p className="mt-2 text-sm text-muted-foreground">{items.length ? '调整状态或搜索词后再试。' : canCreateAnalysis ? '在上方输入问题，开始第一轮分析。' : '获得分析权限后即可发起分析。'}</p>
          {items.length ? <button type="button" onClick={() => { setQuery(''); setStatus('all'); }} className="mt-4 rounded-sm text-sm text-primary underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring">清除筛选</button> : null}
        </div>
      )}
    </section>
  );
}
