'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import type { ApprovalDecision } from '@/domain/ontology/governance';
import { Button } from '@/app/_components/button';
import { FieldTextarea } from '@/app/_components/field';
import {
  AdminCard,
  AdminPageHeader,
  StatusBadge,
  StatusProgressBar,
  formatTimestamp,
} from '../../../_components/admin-shell';
import {
  CR_STATUS_FLOW,
  getChangeTypeLabel,
  getCompatibilityLabel,
  getCRStatusFlowIndex,
  getCRStatusLabel,
  getTargetObjectTypeLabel,
} from '../../../_lib/admin-labels';
import {
  getAdminApiErrorMessage,
  getChangeRequestDetail,
  ontologyAdminQueryKeys,
  publishVersion,
  reviewChangeRequest,
  submitChangeRequest,
  type ChangeRequestDetailData,
} from '../_lib/admin-api';

type ChangeRequestDetailClientProps = {
  changeRequestId: string;
  initialData: ChangeRequestDetailData;
};

export function ChangeRequestDetailClient({
  changeRequestId,
  initialData,
}: ChangeRequestDetailClientProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [reviewComment, setReviewComment] = useState('');
  const [publishNote, setPublishNote] = useState('');

  const { data = initialData } = useQuery({
    queryKey: ontologyAdminQueryKeys.changeRequests.detail(changeRequestId),
    queryFn: () => getChangeRequestDetail(changeRequestId),
    initialData,
  });

  const { changeRequest: cr, approvalHistory, version, capabilities } = data;
  const statusLabel = getCRStatusLabel(cr.status);
  const flowIndex = getCRStatusFlowIndex(cr.status);
  const flowSteps = CR_STATUS_FLOW.map((status) => ({
    label: getCRStatusLabel(status).label,
    status,
  }));

  const canSubmit = capabilities.canAuthor && cr.status === 'draft';
  const canReview = capabilities.canReview && cr.status === 'submitted';
  const canPublish =
    capabilities.canPublish &&
    cr.status === 'approved' &&
    !!version &&
    version.status === 'approved' &&
    !version.publishedAt;

  const detailQueryKey = ontologyAdminQueryKeys.changeRequests.detail(changeRequestId);

  const submitMutation = useMutation({
    mutationFn: () => submitChangeRequest(cr.id),
    onSuccess(result) {
      queryClient.setQueryData<ChangeRequestDetailData>(detailQueryKey, (current) =>
        current
          ? {
              ...current,
              changeRequest: result.changeRequest,
            }
          : current,
      );
      void queryClient.invalidateQueries({
        queryKey: ontologyAdminQueryKeys.changeRequests.all,
      });
      toast.success(result.message);
    },
    onError(error) {
      toast.error(getAdminApiErrorMessage(error));
    },
  });

  const reviewMutation = useMutation({
    mutationFn: (decision: ApprovalDecision) =>
      reviewChangeRequest({
        id: cr.id,
        decision,
        comment: reviewComment,
      }),
    onSuccess(result) {
      queryClient.setQueryData<ChangeRequestDetailData>(detailQueryKey, (current) =>
        current
          ? {
              ...current,
              changeRequest: result.changeRequest,
              approvalHistory: [...current.approvalHistory, result.approvalRecord],
            }
          : current,
      );
      setReviewComment('');
      void queryClient.invalidateQueries({
        queryKey: ontologyAdminQueryKeys.changeRequests.all,
      });
      toast.success(result.message);
    },
    onError(error) {
      toast.error(getAdminApiErrorMessage(error));
    },
  });

  const publishMutation = useMutation({
    mutationFn: () => {
      if (!version) {
        throw new Error('目标版本不存在，无法发布。');
      }
      return publishVersion({
        versionId: version.id,
        publishNote,
      });
    },
    onSuccess(result) {
      void queryClient.invalidateQueries({
        queryKey: ontologyAdminQueryKeys.changeRequests.all,
      });
      void queryClient.invalidateQueries({
        queryKey: ontologyAdminQueryKeys.publishes.list(),
      });
      toast.success(result.message);
      router.push('/admin/ontology/publishes');
    },
    onError(error) {
      toast.error(getAdminApiErrorMessage(error));
    },
  });

  const isMutating = useMemo(
    () => submitMutation.isPending || reviewMutation.isPending || publishMutation.isPending,
    [publishMutation.isPending, reviewMutation.isPending, submitMutation.isPending],
  );

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

      {flowIndex >= 0 ? (
        <AdminCard title="">
          <StatusProgressBar steps={flowSteps} currentIndex={flowIndex} />
        </AdminCard>
      ) : null}

      {(canSubmit || canReview || canPublish) && (
        <AdminCard title="治理操作">
          <div className="flex flex-wrap items-start gap-3 py-4">
            {canSubmit ? (
              <Button
                type="button"
                disabled={isMutating}
                onClick={() => submitMutation.mutate()}
              >
                {submitMutation.isPending ? '提交中...' : '提交审批'}
              </Button>
            ) : null}

            {canReview ? (
              <div className="flex flex-col gap-2">
                <FieldTextarea
                  name="comment"
                  placeholder="审批意见（必填）"
                  value={reviewComment}
                  onChange={(event) => setReviewComment(event.target.value)}
                  className="min-h-[60px] w-[280px]"
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    disabled={isMutating}
                    onClick={() => reviewMutation.mutate('approved')}
                  >
                    {reviewMutation.isPending ? '处理中...' : '审批通过'}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={isMutating}
                    onClick={() => reviewMutation.mutate('rejected')}
                  >
                    驳回
                  </Button>
                </div>
              </div>
            ) : null}

            {canPublish && version ? (
              <div className="inline-flex flex-col gap-2">
                <FieldTextarea
                  name="publishNote"
                  placeholder="发布备注（可选）"
                  value={publishNote}
                  onChange={(event) => setPublishNote(event.target.value)}
                  className="min-h-[60px] w-[280px]"
                />
                <AlertDialog.Root>
                  <AlertDialog.Trigger asChild>
                    <Button type="button" disabled={isMutating}>
                      {publishMutation.isPending ? '发布中...' : '发布版本'}
                    </Button>
                  </AlertDialog.Trigger>
                  <AlertDialog.Portal>
                    <AlertDialog.Overlay className="fixed inset-0 z-40 bg-black/45" />
                    <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,420px)] -translate-x-1/2 -translate-y-1/2 rounded-md border border-border bg-card p-6 shadow-[var(--shadow-panel)]">
                      <AlertDialog.Title className="text-lg font-semibold text-foreground">
                        确认发布版本 {version.semver}
                      </AlertDialog.Title>
                      <AlertDialog.Description className="mt-3 text-sm leading-6 text-muted-foreground">
                        发布后该版本会切换为当前生效版本，关联已通过变更申请会进入已发布状态。此操作不可逆。
                      </AlertDialog.Description>
                      <div className="mt-6 flex justify-end gap-3">
                        <AlertDialog.Cancel asChild>
                          <Button type="button" variant="secondary">
                            取消
                          </Button>
                        </AlertDialog.Cancel>
                        <AlertDialog.Action asChild>
                          <Button
                            type="button"
                            disabled={publishMutation.isPending}
                            onClick={() => publishMutation.mutate()}
                          >
                            确认发布
                          </Button>
                        </AlertDialog.Action>
                      </div>
                    </AlertDialog.Content>
                  </AlertDialog.Portal>
                </AlertDialog.Root>
              </div>
            ) : null}
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
          {version ? (
            <InfoItem
              label="目标版本"
              value={`${version.semver} · ${version.displayName}`}
              note={`状态：${version.status}${version.publishedAt ? ` · 已发布于 ${formatTimestamp(version.publishedAt)}` : ''}`}
            />
          ) : null}
        </div>
        {cr.compatibilityNote ? (
          <div className="mt-4 rounded-lg bg-accent p-4 text-sm">
            <p className="text-xs font-semibold text-primary">兼容说明</p>
            <p className="mt-1 text-muted-foreground">{cr.compatibilityNote}</p>
          </div>
        ) : null}
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
          <div
            className="rounded-md border border-[color:var(--brand-300)]/40 bg-[color:color-mix(in_srgb,var(--brand-500)_10%,transparent)] px-4 py-3 text-sm leading-6 text-foreground"
            role="status"
            aria-live="polite"
          >
            该变更申请尚未产生审批记录。
          </div>
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
                  {record.comment ? (
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {record.comment}
                    </p>
                  ) : null}
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
      {note ? <p className="mt-1 text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}
