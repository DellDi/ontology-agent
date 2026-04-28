import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getOntologyAdminRuntime } from '@/infrastructure/ontology-admin';
import { requireOntologyAdminSession } from '@/infrastructure/session/admin-auth';

import {
  AdminCard,
  AdminPageHeader,
  StatusBadge,
  changeRequestStatusTone,
  formatTimestamp,
} from '../../../../_components/admin-shell';

type CRDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function readParam(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0];
  return undefined;
}

export default async function OntologyAdminChangeRequestDetailPage({
  params,
  searchParams,
}: CRDetailPageProps) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const error = readParam(sp.error);
  const success = readParam(sp.ok);

  const state = await requireOntologyAdminSession(`/admin/ontology/change-requests/${id}`);
  if (state.accessDeniedMessage) return null;

  const { adminUseCases } = getOntologyAdminRuntime();
  const detail = await adminUseCases.getChangeRequestDetail(id);
  if (!detail) {
    notFound();
  }

  const { changeRequest: cr, approvalHistory, version } = detail;
  const { capabilities } = state;

  const canSubmit = capabilities.canAuthor && cr.status === 'draft';
  const canReview = capabilities.canReview && cr.status === 'submitted';
  const canPublish =
    capabilities.canPublish &&
    cr.status === 'approved' &&
    !!version &&
    version.status === 'approved' &&
    !version.publishedAt;

  return (
    <section className="space-y-6">
      <AdminPageHeader
        eyebrow={`Change Request · ${cr.status}`}
        title={cr.title}
        description={cr.description ?? '本变更申请没有提供描述说明。'}
        trailing={<StatusBadge tone={changeRequestStatusTone(cr.status)}>{cr.status}</StatusBadge>}
      />

      {error ? (
        <div className="status-banner" data-tone="error">{decodeURIComponent(error)}</div>
      ) : null}
      {success ? (
        <div className="status-banner" data-tone="success">{decodeURIComponent(success)}</div>
      ) : null}

      <AdminCard title="目标对象与影响范围">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-3xl bg-white/76 p-4 text-sm">
            <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--brand-700)]">目标对象</p>
            <p className="mt-1 text-base font-semibold text-[color:var(--ink-900)]">
              {cr.targetObjectType} / {cr.targetObjectKey}
            </p>
            <p className="text-xs text-[color:var(--ink-600)]">
              变更类型：{cr.changeType} · 兼容性：{cr.compatibilityType}
            </p>
            {cr.compatibilityNote ? (
              <p className="mt-2 text-xs text-[color:var(--ink-600)]">兼容说明：{cr.compatibilityNote}</p>
            ) : null}
          </div>
          <div className="rounded-3xl bg-white/76 p-4 text-sm">
            <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--brand-700)]">影响范围</p>
            {cr.impactScope.length === 0 ? (
              <p className="mt-1 text-sm text-[color:var(--ink-600)]">未声明影响范围</p>
            ) : (
              <ul className="mt-1 list-disc pl-5 text-sm leading-6 text-[color:var(--ink-900)]">
                {cr.impactScope.map((scope) => (
                  <li key={scope}>{scope}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </AdminCard>

      <AdminCard title="变更前后摘要">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-3xl bg-white/76 p-4 text-sm">
            <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--brand-700)]">变更前</p>
            <pre className="mt-2 whitespace-pre-wrap break-words text-xs leading-6 text-[color:var(--ink-900)]">
              {cr.beforeSummary ? JSON.stringify(cr.beforeSummary, null, 2) : '—'}
            </pre>
          </div>
          <div className="rounded-3xl bg-white/76 p-4 text-sm">
            <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--brand-700)]">变更后</p>
            <pre className="mt-2 whitespace-pre-wrap break-words text-xs leading-6 text-[color:var(--ink-900)]">
              {cr.afterSummary ? JSON.stringify(cr.afterSummary, null, 2) : '—'}
            </pre>
          </div>
        </div>
      </AdminCard>

      <AdminCard title="提交与时间线">
        <div className="grid gap-3 md:grid-cols-3 text-sm">
          <div className="rounded-3xl bg-white/76 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--brand-700)]">提交人</p>
            <p className="mt-1 text-base text-[color:var(--ink-900)]">{cr.submittedBy}</p>
          </div>
          <div className="rounded-3xl bg-white/76 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--brand-700)]">提交时间</p>
            <p className="mt-1 text-base text-[color:var(--ink-900)]">{formatTimestamp(cr.submittedAt)}</p>
          </div>
          <div className="rounded-3xl bg-white/76 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--brand-700)]">最近更新</p>
            <p className="mt-1 text-base text-[color:var(--ink-900)]">{formatTimestamp(cr.updatedAt)}</p>
          </div>
        </div>
        {version ? (
          <p className="text-xs text-[color:var(--ink-600)]">
            目标版本：{version.semver} · {version.displayName} · 当前状态 {version.status}
            {version.publishedAt ? ` · 已发布于 ${formatTimestamp(version.publishedAt)}` : ''}
          </p>
        ) : null}
      </AdminCard>

      <AdminCard title="审批历史">
        {approvalHistory.length === 0 ? (
          <div className="status-banner" data-tone="info">该变更申请尚未产生审批记录。</div>
        ) : (
          <div className="grid gap-2">
            {approvalHistory.map((record) => (
              <div
                key={record.id}
                className="rounded-2xl bg-white/76 p-4 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-[color:var(--ink-900)]">
                      {record.reviewedBy}
                    </p>
                    <p className="text-xs text-[color:var(--ink-600)]">
                      {formatTimestamp(record.createdAt)}
                    </p>
                  </div>
                  <StatusBadge tone={record.decision === 'approved' ? 'success' : 'danger'}>
                    {record.decision}
                  </StatusBadge>
                </div>
                {record.comment ? (
                  <p className="mt-2 text-xs leading-6 text-[color:var(--ink-700)]">
                    {record.comment}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </AdminCard>

      <AdminCard
        title="治理操作"
        description="根据当前角色与状态决定可执行的操作。所有操作通过受控服务端用例执行并写入审计事件。"
      >
        <div className="flex flex-wrap gap-3">
          {canSubmit ? (
            <form
              method="post"
              action={`/api/admin/ontology/change-requests/${cr.id}/submit`}
              className="inline-flex"
            >
              <button className="primary-button" type="submit">
                提交进入审批
              </button>
            </form>
          ) : null}

          {canReview ? (
            <ReviewForm changeRequestId={cr.id} />
          ) : null}

          {canPublish && version ? (
            <form
              method="post"
              action={`/api/admin/ontology/versions/${version.id}/publish`}
              className="inline-flex flex-col gap-2"
            >
              <textarea
                name="publishNote"
                placeholder="发布备注（可选）"
                className="field-input min-h-[60px] w-[280px]"
              />
              <button className="primary-button" type="submit">
                发布该版本
              </button>
            </form>
          ) : null}

          {!canSubmit && !canReview && !canPublish ? (
            <p className="text-sm text-[color:var(--ink-600)]">
              当前状态或角色下没有可执行的治理操作。
            </p>
          ) : null}
        </div>

        <p className="text-xs text-[color:var(--ink-600)]">
          <Link className="underline" href="/admin/ontology/change-requests">
            返回变更申请列表
          </Link>
        </p>
      </AdminCard>
    </section>
  );
}

function ReviewForm({ changeRequestId }: { changeRequestId: string }) {
  return (
    <form
      method="post"
      action={`/api/admin/ontology/change-requests/${changeRequestId}/review`}
      className="flex flex-col gap-2"
    >
      <textarea
        name="comment"
        placeholder="审批意见（必填）"
        required
        className="field-input min-h-[60px] w-[280px]"
      />
      <div className="flex gap-2">
        <button
          className="primary-button"
          name="decision"
          value="approved"
          type="submit"
        >
          审批通过
        </button>
        <button
          className="secondary-button"
          name="decision"
          value="rejected"
          type="submit"
        >
          驳回
        </button>
      </div>
    </form>
  );
}
