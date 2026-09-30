import Link from 'next/link';

import type { WorkspaceHomeModel } from '@/application/workspace/home';
import { Button } from '@/components/ui/button';
import { StatusBanner } from '@/app/_components/status-banner';
import { WorkspaceAnalysisComposer } from './workspace-analysis-composer';
import { WorkspaceSessionList } from './workspace-session-list';

type WorkspaceHomeShellProps = {
  model: WorkspaceHomeModel;
  creationError?: string;
  draftQuestion?: string;
};

/** 时段问候语（服务端渲染一次，无 hydration 差异） */
function heroGreeting() {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了';
  if (hour < 12) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

export function WorkspaceHomeShell({ model, creationError, draftQuestion }: WorkspaceHomeShellProps) {
  const isEmpty = model.sessionPage.total === 0 && model.historyItems.length === 0;

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
        isEmpty ? (
          /* 空会话首页：居中 hero——问候语 + 输入卡片 + 推荐问题 */
          <div className="flex min-h-[68vh] flex-col items-center justify-center" id="new-analysis">
            <h1 className="text-2xl font-medium tracking-tight text-foreground sm:text-3xl">
              {heroGreeting()}，{model.viewerName}
            </h1>
            <p className="mt-3 text-sm text-muted-foreground">
              从你有权限的范围开始今天的分析
            </p>
            <div className="mt-8 w-full max-w-2xl">
              <WorkspaceAnalysisComposer capabilities={model.capabilities} draftQuestion={draftQuestion} hero key={draftQuestion ?? ''} />
            </div>
          </div>
        ) : (
          <div className="space-y-10">
            <section id="new-analysis" aria-label="新建分析">
              <WorkspaceAnalysisComposer key={draftQuestion ?? ''} capabilities={model.capabilities} draftQuestion={draftQuestion} />
            </section>
            <WorkspaceSessionList items={model.historyItems} sessionPage={model.sessionPage} canCreateAnalysis={model.canCreateAnalysis} />
          </div>
        )
      ) : (
        <StatusBanner tone="info" title="暂时无法发起分析">{model.emptyState?.description ?? '请联系管理员分配分析范围。'}</StatusBanner>
      )}
    </section>
  );
}
