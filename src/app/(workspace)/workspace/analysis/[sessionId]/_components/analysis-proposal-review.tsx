import type { BlockProposalReference } from '@/application/workspace/visual-workspace';
import { blockImprovementStatusLabels, type BlockImprovementView } from '@/infrastructure/java-backend/block-improvement-client';

type ProposalItem = {
  reference: BlockProposalReference;
  view?: BlockImprovementView;
  error?: string;
};

export function AnalysisProposalReview({ current, earlier, unread, turnNumbers, onOpen }: {
  current: ProposalItem[];
  earlier: ProposalItem[];
  unread: ProposalItem[];
  turnNumbers: ReadonlyMap<string, number>;
  onOpen: (reference: BlockProposalReference) => void;
}) {
  const screens = new Map<string, { name: string; items: ProposalItem[] }>();
  let verified = 0;
  let needsAttention = 0;
  for (const item of current) {
    if (!item.view) continue;
    const { applicationId, applicationName, status } = item.view;
    const screen = screens.get(applicationId);
    if (screen) screen.items.push(item);
    else screens.set(applicationId, { name: applicationName, items: [item] });
    if (status === 'verified') verified++;
    if (['context_pending', 'unknown', 'conflict', 'failed'].includes(status)) needsAttention++;
  }

  const rows = (items: ProposalItem[], showScreen = false) => <div className="divide-y divide-border">
    {items.map(({ reference, view }) => {
      if (!view) return null;
      const round = turnNumbers.get(reference.executionId);
      const textChange = view.proposal.textChange;
      const summary = textChange
        ? textChange.beforeTitle !== textChange.afterTitle
          ? `${textChange.beforeTitle} → ${textChange.afterTitle}`
          : `${textChange.beforePurpose} → ${textChange.afterPurpose}`
        : view.proposal.changes.map(change => change.reason).join('；') || view.proposal.diagnosis.themeFit;
      return <button key={`${reference.executionId}:${reference.invocationId}`} type="button"
        className="w-full space-y-1 rounded-sm py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:text-primary"
        onClick={() => onOpen(reference)}>
        <span className="flex items-start justify-between gap-3 text-sm font-medium">
          <span>{view.title}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{blockImprovementStatusLabels[view.status]}</span>
        </span>
        {showScreen || round ? <span className="block text-xs text-muted-foreground">
          {[showScreen ? view.applicationName : null, round ? `第 ${round} 轮` : null].filter(Boolean).join(' · ')}
        </span> : null}
        <span className="line-clamp-2 text-sm leading-6 text-muted-foreground">{summary}</span>
      </button>;
    })}
  </div>;

  return <div className="space-y-5">
    {current.length ? <p className="text-sm text-muted-foreground" role="status">
      已核对 {verified} / {current.length} 条
      {needsAttention ? ` · ${needsAttention} 条需处理异常` : ''}
    </p> : null}
    {[...screens].map(([applicationId, screen]) => <section key={applicationId}
      className="border-t border-border pt-3" aria-label={screen.name}>
      <h3 className="text-sm font-semibold">{screen.name}</h3>
      {rows(screen.items)}
    </section>)}
    {unread.length ? <div className="space-y-2">
      {unread.map(({ reference, error }) => <p key={`${reference.executionId}:${reference.invocationId}`}
        className={error ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}
        role={error ? 'alert' : 'status'}>{error ?? '正在读取建议…'}</p>)}
    </div> : null}
    {earlier.length ? <details className="text-sm">
      <summary className="cursor-pointer text-muted-foreground">历史建议 · {earlier.length}</summary>
      {rows(earlier, true)}
    </details> : null}
  </div>;
}
