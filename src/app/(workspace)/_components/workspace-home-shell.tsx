import Link from 'next/link';

import type { WorkspaceHomeModel } from '@/application/workspace/home';
import { Button } from '@/app/_components/workbench/button';
import { StatusBanner } from '@/app/_components/workbench/status-banner';
import { WorkspaceAnalysisComposer } from './workspace-analysis-composer';
import { WorkspaceSessionList } from './workspace-session-list';

type WorkspaceHomeShellProps = {
  model: WorkspaceHomeModel;
  creationError?: string;
  draftQuestion?: string;
};

export function WorkspaceHomeShell({ model, creationError, draftQuestion }: WorkspaceHomeShellProps) {
  return (
    <section className="mx-auto max-w-4xl space-y-10" data-testid="workspace-home-shell">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">分析工作台</h1>
          <p className="mt-2 text-sm text-muted-foreground">从业务问题出发，用数据验证判断。</p>
        </div>
        <details className="w-full border-b border-border pb-3 text-sm">
          <summary className="cursor-pointer rounded-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            能力与范围 · {model.capabilities.filter(capability => capability.available).length} 项可用
          </summary>
          <p className="mt-3 text-xs text-muted-foreground">仅列出当前环境已启用的能力。可发起表示已获授权；实际分析还需要可用的数据。</p>
          {model.capabilities.length ? (
            <ul className="mt-3 divide-y divide-border">
              {model.capabilities.map(capability => (
                <li key={`${capability.domainKey}:${capability.capabilityKey}`} className="py-3">
                  <p className="font-medium text-foreground">{capability.displayName}<span className="ml-3 text-xs font-normal text-muted-foreground">{capability.available ? '可发起' : '不可用'}</span></p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{capability.scopeDescription}</p>
                </li>
              ))}
            </ul>
          ) : <p className="mt-3 text-muted-foreground">当前环境尚未开放分析能力，请联系管理员。</p>}
        </details>
      </header>

      {model.degradedState ? (
        <StatusBanner tone="warning" title="数据可能不是最新" action={<Button variant="secondary" size="sm" asChild><Link href="/workspace">刷新页面</Link></Button>}>
          <p>{model.degradedState.message}</p>
          <p className="mt-1 text-xs">来源：{model.degradedState.source} · {model.degradedState.occurredAt}</p>
        </StatusBanner>
      ) : null}

      <section id="new-analysis" aria-label="新建分析">
        {creationError ? <StatusBanner tone="error" className="mb-4">{creationError}</StatusBanner> : null}
        {model.canCreateAnalysis ? (
          <WorkspaceAnalysisComposer key={draftQuestion ?? ''} capabilities={model.capabilities} draftQuestion={draftQuestion} />
        ) : <StatusBanner tone="info" title="暂时无法发起分析">{model.emptyState?.description ?? '请联系管理员分配分析范围。'}</StatusBanner>}
      </section>

      <WorkspaceSessionList items={model.historyItems} canCreateAnalysis={model.canCreateAnalysis} />
    </section>
  );
}
