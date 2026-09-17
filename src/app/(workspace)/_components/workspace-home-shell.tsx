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

      <WorkspaceSessionList items={model.historyItems} sessionPage={model.sessionPage} canCreateAnalysis={model.canCreateAnalysis} />
    </section>
  );
}
