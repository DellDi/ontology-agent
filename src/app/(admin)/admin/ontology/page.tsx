import Link from 'next/link';

import { getOntologyAdminRuntime } from '@/infrastructure/ontology-admin';
import { requireOntologyAdminSession } from '@/infrastructure/session/admin-auth';

import {
  AdminCard,
  AdminPageHeader,
  StatusBadge,
  changeRequestStatusTone,
  formatTimestamp,
} from '../../_components/admin-shell';

export default async function OntologyAdminOverviewPage() {
  const state = await requireOntologyAdminSession('/admin/ontology');
  if (state.accessDeniedMessage) {
    return null;
  }

  const { adminUseCases } = getOntologyAdminRuntime();
  const overview = await adminUseCases.loadOverview();

  return (
    <section className="space-y-6">
      <AdminPageHeader
        eyebrow="Governance Overview"
        title="本体治理概览"
        description="查看当前生效版本、待审批事项与最近发布记录，是治理后台的默认入口。"
        trailing={
          <div className="rounded-full border border-[color:var(--line-200)] bg-white/80 px-4 py-2 text-sm font-medium text-[color:var(--brand-700)] shadow-[var(--shadow-soft)]">
            {overview.currentPublishedVersion
              ? `当前生效：${overview.currentPublishedVersion.semver}`
              : '当前无生效版本'}
          </div>
        }
      />

      {overview.riskNotes.length > 0 ? (
        <article className="status-banner" data-tone="warning">
          <p className="font-semibold text-[color:var(--ink-900)]">需关注的治理风险</p>
          <ul className="mt-2 list-disc pl-5 text-sm leading-6 text-[color:var(--ink-700)]">
            {overview.riskNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </article>
      ) : null}

      <article className="grid gap-4 md:grid-cols-2">
        <AdminCard
          title="当前生效版本"
          description="默认运行时只认 published 版本，未发布版本不会进入业务路径。"
        >
          {overview.currentPublishedVersion ? (
            <div className="rounded-3xl bg-white/76 p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-lg font-semibold text-[color:var(--ink-900)]">
                    {overview.currentPublishedVersion.displayName}
                  </p>
                  <p className="text-sm text-[color:var(--ink-600)]">
                    版本号 {overview.currentPublishedVersion.semver}
                  </p>
                </div>
                <StatusBadge tone="success">已发布</StatusBadge>
              </div>
              <p className="mt-3 text-xs text-[color:var(--ink-600)]">
                发布时间：{formatTimestamp(overview.currentPublishedVersion.publishedAt)}
              </p>
            </div>
          ) : (
            <div className="status-banner" data-tone="info">
              当前没有任何已发布版本。请联系治理负责人通过变更申请 → 审批 → 发布的最小闭环创建首个版本。
            </div>
          )}
        </AdminCard>

        <AdminCard
          title="待办与下一步"
          description="审批与发布是当前最容易堵塞的两个环节。"
        >
          <div className="rounded-3xl bg-white/76 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-[color:var(--ink-600)]">待审批变更</span>
              <StatusBadge tone={overview.pendingChangeRequests.length > 0 ? 'warning' : 'neutral'}>
                {overview.pendingChangeRequests.length}
              </StatusBadge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-[color:var(--ink-600)]">已审批待发布</span>
              <StatusBadge tone={overview.approvedAwaitingPublish.length > 0 ? 'info' : 'neutral'}>
                {overview.approvedAwaitingPublish.length}
              </StatusBadge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-[color:var(--ink-600)]">最近发布</span>
              <span className="text-sm font-medium text-[color:var(--ink-900)]">
                {overview.recentPublishes[0]
                  ? formatTimestamp(overview.recentPublishes[0].createdAt)
                  : '—'}
              </span>
            </div>
            <Link
              href="/admin/ontology/change-requests"
              className="primary-button mt-3 inline-flex w-full justify-center"
            >
              进入变更申请
            </Link>
          </div>
        </AdminCard>
      </article>

      <AdminCard
        title="最近变更申请"
        description="只展示最近 10 条；完整列表与筛选请进入变更申请页面。"
      >
        {overview.recentChangeRequests.length === 0 ? (
          <div className="status-banner" data-tone="info">还没有任何变更申请记录。</div>
        ) : (
          <div className="grid gap-3">
            {overview.recentChangeRequests.map((cr) => (
              <Link
                key={cr.id}
                href={`/admin/ontology/change-requests/${cr.id}`}
                className="rounded-3xl border border-[color:var(--line-200)] bg-white/76 p-5 transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-soft)]"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-base font-semibold text-[color:var(--ink-900)]">{cr.title}</p>
                    <p className="text-xs text-[color:var(--ink-600)]">
                      {cr.targetObjectType} / {cr.targetObjectKey} · {cr.changeType} ·
                      {' '}
                      {cr.compatibilityType}
                    </p>
                  </div>
                  <StatusBadge tone={changeRequestStatusTone(cr.status)}>{cr.status}</StatusBadge>
                </div>
                <p className="mt-2 text-xs text-[color:var(--ink-600)]">
                  提交人 {cr.submittedBy} · 更新于 {formatTimestamp(cr.updatedAt)}
                </p>
              </Link>
            ))}
          </div>
        )}
      </AdminCard>
    </section>
  );
}
