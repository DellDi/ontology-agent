import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';

import type { WorkspaceHomeModel } from '@/application/workspace/home';
import { Button } from '@/components/ui/button';
import { StatusBanner } from '@/app/_components/status-banner';
import { WorkspaceAnalysisComposer } from './workspace-analysis-composer';

type WorkspaceHomeShellProps = {
  model: WorkspaceHomeModel;
  creationError?: string;
  draftQuestion?: string;
};

export function WorkspaceHomeShell({ model, creationError, draftQuestion }: WorkspaceHomeShellProps) {
  return (
    <section className="mx-auto w-full max-w-4xl" data-testid="workspace-home-shell">
      {model.degradedState ? (
        <StatusBanner tone="warning" title="数据可能不是最新" action={<Button variant="outline" size="sm" asChild><Link href="/workspace">刷新页面</Link></Button>}>
          <p>{model.degradedState.message}</p>
          <p className="mt-1 text-xs">来源：{model.degradedState.source} · {model.degradedState.occurredAt}</p>
        </StatusBanner>
      ) : null}
      {creationError ? <StatusBanner tone="error" className="mb-4">{creationError}</StatusBanner> : null}
      {model.canCreateAnalysis ? (
        <div className="mx-auto flex min-h-[calc(100dvh-8rem)] w-full max-w-[720px] flex-col justify-center py-10 sm:pb-20" id="new-analysis">
          <header className="mb-7 flex items-center justify-between gap-4">
            <h1 className="text-2xl font-medium tracking-tight text-foreground">大屏工作台</h1>
            <Link href="/workspace/data" className="inline-flex items-center gap-1 rounded-sm py-2 text-sm text-muted-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              数据范围<ArrowUpRight aria-hidden="true" className="size-3.5" />
            </Link>
          </header>
          {model.capabilities.some(capability => capability.domainKey === 'easyv' && capability.available) ? <div className="mb-6 border-l-2 border-primary pl-5">
            <Link href="/workspace/screens" className="inline-flex items-center gap-3 py-2 text-lg font-medium hover:text-primary">浏览大屏<ArrowUpRight aria-hidden className="size-4" /></Link>
            <p className="text-sm text-muted-foreground">查看原型结构、模块用途与指标口径</p>
          </div> : null}
          <WorkspaceAnalysisComposer capabilities={model.capabilities} draftQuestion={draftQuestion} hero key={draftQuestion ?? ''} />

        </div>
      ) : (
        <StatusBanner tone="info" title="暂时无法发起分析">{model.emptyState?.description ?? '请联系管理员分配分析范围。'}</StatusBanner>
      )}
    </section>
  );
}
