import Link from 'next/link';
import { notFound } from 'next/navigation';

import { createCompositionRoot, requireOntologyAdminSession } from '@/composition-root';
import { Button } from '@/app/_components/button';
import { FieldTextarea } from '@/app/_components/field';

import {
  AdminCard,
  AdminPageHeader,
  StatusBadge,
  StatusProgressBar,
  formatTimestamp,
} from '../../../../_components/admin-shell';
import {
  CR_STATUS_FLOW,
  getChangeTypeLabel,
  getCompatibilityLabel,
  getCRStatusFlowIndex,
  getCRStatusLabel,
  getTargetObjectTypeLabel,
} from '../../../../_lib/admin-labels';

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

  const { adminUseCases } = createCompositionRoot().ontologyAdminRuntime;
  const detail = await adminUseCases.getChangeRequestDetail(id);
  if (!detail) {
    notFound();
  }

  const { changeRequest: cr, approvalHistory, version } = detail;
  const { capabilities } = state;

  const statusLabel = getCRStatusLabel(cr.status);
  const flowIndex = getCRStatusFlowIndex(cr.status);
  const flowSteps = CR_STATUS_FLOW.map((s) => ({
    label: getCRStatusLabel(s).label,
    status: s,
  }));

  const canSubmit = capabilities.canAuthor && cr.status === 'draft';
  const canReview = capabilities.canReview && cr.status === 'submitted';
  const canPublish =
    capabilities.canPublish &&
    cr.status === 'approved' &&
    !!version &&
    version.status === 'approved' &&
    !version.publishedAt;

  const typeLabel = getChangeTypeLabel(cr.changeType);
  const compatLabel = getCompatibilityLabel(cr.compatibilityType);
  const objectTypeLabel = getTargetObjectTypeLabel(cr.targetObjectType);

  return (
    <section className="space-y-6">
      <AdminPageHeader
        eyebrow="变更申请"
        title={cr.title}
        description={cr.description ?? '本变更申请没有提供描述说明。'}
        trailing={
          <div className="flex flex-col items-end gap-2">
            <StatusBadge tone={statusLabel.tone}>{statusLabel.label}</StatusBadge>
            <span className="text-xs text-muted-foreground">{statusLabel.description}</span>
          </div>
        }
      />

      {flowIndex >= 0 && (
        <AdminCard title="">
          <StatusProgressBar steps={flowSteps} currentIndex={flowIndex} />
        </AdminCard>
      )}

      {error ? (
        <div className="status-banner" data-tone="error">{decodeURIComponent(error)}</div>
      ) : null}
      {success ? (
        <div className="status-banner" data-tone="success">{decodeURIComponent(success)}</div>
      ) : null}

      {(canSubmit || canReview || canPublish) && (
        <AdminCard title="治理操作">
          <div className="action-bar">
            {canSubmit && (
              <form
                method="post"
                action={`/api/admin/ontology/change-requests/${cr.id}/submit`}
                className="inline-flex"
              >
                <Button type="submit">
                  提交审批
                </Button>
              </form>
            )}

            {canReview && <ReviewForm changeRequestId={cr.id} />}

            {canPublish && version && (
              <form
                method="post"
                action={`/api/admin/ontology/versions/${version.id}/publish`}
                className="inline-flex flex-col gap-2"
              >
                <FieldTextarea
                  name="publishNote"
                  placeholder="发布备注（可选）"
                  className="min-h-[60px] w-[280px]"
                />
                <Button type="submit">
                  发布版本
                </Button>
              </form>
            )}
          </div>
        </AdminCard>
      )}

      <AdminCard title="变更概要">
        <div className="grid gap-4 md:grid-cols-2">
          <InfoItem label="目标对象" value={`${objectTypeLabel} / ${cr.targetObjectKey}`} />
          <InfoItem label="变更类型" value={typeLabel} />
          <InfoItem label="兼容性" value={compatLabel.label} note={compatLabel.note} />
          <InfoItem label="影响范围" value={cr.impactScope.length > 0 ? cr.impactScope.join('、') : '未声明'} />
          <InfoItem label="提交人" value={cr.submittedBy} />
          <InfoItem label="提交时间" value={formatTimestamp(cr.submittedAt)} />
          <InfoItem label="最近更新" value={formatTimestamp(cr.updatedAt)} />
          {version && (
            <InfoItem
              label="目标版本"
              value={`${version.semver} · ${version.displayName}`}
              note={`状态：${version.status}${version.publishedAt ? ` · 已发布于 ${formatTimestamp(version.publishedAt)}` : ''}`}
            />
          )}
        </div>
        {cr.compatibilityNote && (
          <div className="mt-4 rounded-lg bg-accent p-4 text-sm">
            <p className="text-xs font-semibold text-primary">兼容说明</p>
            <p className="mt-1 text-[color:var(--ink-700)]">{cr.compatibilityNote}</p>
          </div>
        )}
      </AdminCard>

      <AdminCard title="变更内容">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg bg-muted p-4">
            <p className="text-xs font-semibold tracking-[0.12em] text-primary">变更前</p>
            <pre className="mt-2 whitespace-pre-wrap break-words text-xs leading-6 text-foreground">
              {cr.beforeSummary ? JSON.stringify(cr.beforeSummary, null, 2) : '—'}
            </pre>
          </div>
          <div className="rounded-lg bg-muted p-4">
            <p className="text-xs font-semibold tracking-[0.12em] text-primary">变更后</p>
            <pre className="mt-2 whitespace-pre-wrap break-words text-xs leading-6 text-foreground">
              {cr.afterSummary ? JSON.stringify(cr.afterSummary, null, 2) : '—'}
            </pre>
          </div>
        </div>
      </AdminCard>

      <AdminCard title="审批记录">
        {approvalHistory.length === 0 ? (
          <div className="status-banner" data-tone="info">该变更申请尚未产生审批记录。</div>
        ) : (
          <div className="space-y-3">
            {approvalHistory.map((record) => (
              <div
                key={record.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-lg bg-muted p-4"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground">
                      {record.reviewedBy}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatTimestamp(record.createdAt)}
                    </span>
                  </div>
                  {record.comment && (
                    <p className="mt-2 text-sm leading-6 text-[color:var(--ink-700)]">
                      {record.comment}
                    </p>
                  )}
                </div>
                <StatusBadge tone={record.decision === 'approved' ? 'success' : 'danger'}>
                  {record.decision === 'approved' ? '通过' : '驳回'}
                </StatusBadge>
              </div>
            ))}
          </div>
        )}
      </AdminCard>

      <div className="flex justify-start">
        <Link
          href="/admin/ontology/change-requests"
          className="text-sm text-primary hover:underline"
        >
          ← 返回变更申请列表
        </Link>
      </div>
    </section>
  );
}

function InfoItem({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="rounded-lg bg-muted p-4">
      <p className="text-xs tracking-[0.12em] text-primary">{label}</p>
      <p className="mt-1 text-base font-semibold text-foreground">{value}</p>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

function ReviewForm({ changeRequestId }: { changeRequestId: string }) {
  return (
    <form
      method="post"
      action={`/api/admin/ontology/change-requests/${changeRequestId}/review`}
      className="flex flex-col gap-2"
    >
      <FieldTextarea
        name="comment"
        placeholder="审批意见（必填）"
        required
        className="min-h-[60px] w-[280px]"
      />
      <div className="flex gap-2">
        <Button
          name="decision"
          value="approved"
          type="submit"
        >
          审批通过
        </Button>
        <Button
          variant="secondary"
          name="decision"
          value="rejected"
          type="submit"
        >
          驳回
        </Button>
      </div>
    </form>
  );
}
