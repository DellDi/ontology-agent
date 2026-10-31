import Link from 'next/link';

import {
  getGovernanceOverview,
  requireJavaOntologyAdminSession,
} from '@/infrastructure/java-backend';
import { Button } from '@/components/ui/button';

import {
  AdminCard,
  AdminPageHeader,
  StatusBadge,
  formatTimestamp,
} from '../../_components/admin-shell';
import { getCRStatusLabel } from '../../_lib/admin-labels';

export default async function OntologyAdminOverviewPage() {
  const state = await requireJavaOntologyAdminSession('/admin/ontology');
  if (state.accessDeniedMessage) {
    return null;
  }

  const overview = await getGovernanceOverview();

  return (
    <section className="space-y-6">
      <AdminPageHeader
        eyebrow="治理总览"
        title="本体治理概览"

      />

      <article className="grid gap-4 md:grid-cols-2">
        <AdminCard
          title="当前生效版本"
        >
          {overview.currentPublishedVersion ? (
            <div className="py-1">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-lg font-semibold text-foreground">
                    {overview.currentPublishedVersion.displayName}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    版本号 {overview.currentPublishedVersion.semver}
                  </p>
                </div>
                <StatusBadge tone="success">已发布</StatusBadge>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                发布时间：{formatTimestamp(overview.currentPublishedVersion.publishedAt)}
              </p>
            </div>
          ) : (
            <div
              className="rounded-md border border-[color:var(--brand-300)]/40 bg-[color:color-mix(in_srgb,var(--brand-500)_10%,transparent)] px-4 py-3 text-sm leading-6 text-foreground"
              role="status"
              aria-live="polite"
            >
              当前没有任何已发布版本。请联系治理负责人通过变更申请 → 审批 → 发布的最小闭环创建首个版本。
            </div>
          )}
        </AdminCard>

        <AdminCard
          title="待办"
        >
          <div className="space-y-4 py-1">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">待审批变更</span>
              <StatusBadge tone={overview.pendingReviewCount > 0 ? 'warning' : 'neutral'}>
                {overview.pendingReviewCount}
              </StatusBadge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">已审批待发布</span>
              <StatusBadge tone={overview.approvedAwaitingPublishCount > 0 ? 'info' : 'neutral'}>
                {overview.approvedAwaitingPublishCount}
              </StatusBadge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">最近发布</span>
              <span className="text-sm font-medium text-foreground">
                {overview.recentPublishes[0]
                  ? formatTimestamp(overview.recentPublishes[0].createdAt)
                  : '—'}
              </span>
            </div>
            <Button
              asChild
              className="mt-3 inline-flex"
            >
              <Link href="/admin/ontology/change-requests">
                进入变更申请
              </Link>
            </Button>
          </div>
        </AdminCard>
      </article>

      <AdminCard
        title="最近变更申请"
        description="最近 10 条"
      >
        {overview.recentChangeRequests.length === 0 ? (
          <div
            className="py-3 text-sm text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            还没有任何变更申请记录。
          </div>
        ) : (
          <div className="grid gap-3">
            {overview.recentChangeRequests.map((cr) => {
              const statusLabel = getCRStatusLabel(cr.status);
              return (
                <Link
                  key={cr.id}
                  href={`/admin/ontology/change-requests/${cr.id}`}
                  className="rounded-lg border border-border bg-card p-5 transition hover:bg-muted hover:shadow-[var(--shadow-soft)]"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-base font-semibold text-foreground">{cr.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {cr.targetObjectType} / {cr.targetObjectKey} · {cr.changeType} ·
                        {' '}
                        {cr.compatibilityType}
                      </p>
                    </div>
                    <StatusBadge tone={statusLabel.tone}>{statusLabel.label}</StatusBadge>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    提交人 {cr.submittedBy} · 更新于 {formatTimestamp(cr.updatedAt)}
                  </p>
                </Link>
              );
            })}
          </div>
        )}
      </AdminCard>
    </section>
  );
}
