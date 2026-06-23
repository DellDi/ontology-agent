'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import {
  CHANGE_TYPES,
  COMPATIBILITY_TYPES,
  TARGET_OBJECT_TYPES,
} from '@/domain/ontology/governance';
import type { OntologyVersion } from '@/domain/ontology/models';
import { Button } from '@/app/_components/button';
import {
  Field,
  FieldHelper,
  FieldInput,
  FieldLabel,
  FieldTextarea,
} from '@/app/_components/field';
import { AdminCard, AdminPageHeader } from '../../../_components/admin-shell';
import {
  CHANGE_TYPE_LABELS,
  COMPATIBILITY_LABELS,
  TARGET_OBJECT_TYPE_LABELS,
  getVersionStatusLabel,
} from '../../../_lib/admin-labels';
import {
  createChangeRequest,
  getAdminApiErrorMessage,
  ontologyAdminQueryKeys,
  submitChangeRequest,
} from '../_lib/admin-api';

type SubmitMode = 'draft' | 'submit';

export function NewChangeRequestClient({ versions }: { versions: OntologyVersion[] }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);
  const [submitMode, setSubmitMode] = useState<SubmitMode>('draft');

  const mutation = useMutation({
    mutationFn: async (mode: SubmitMode) => {
      if (!formRef.current) {
        throw new Error('表单尚未准备好。');
      }
      const formData = new FormData(formRef.current);
      const created = await createChangeRequest(formData);

      if (mode === 'submit') {
        const submitted = await submitChangeRequest(created.changeRequest.id);
        return {
          changeRequestId: submitted.changeRequest.id,
          message: submitted.message,
        };
      }

      return {
        changeRequestId: created.changeRequest.id,
        message: created.message,
      };
    },
    onSuccess(result) {
      void queryClient.invalidateQueries({
        queryKey: ontologyAdminQueryKeys.changeRequests.all,
      });
      toast.success(result.message);
      router.push(`/admin/ontology/change-requests/${result.changeRequestId}`);
    },
    onError(error) {
      toast.error(getAdminApiErrorMessage(error));
    },
  });

  const isSubmitting = mutation.isPending;

  function submit(mode: SubmitMode) {
    if (!formRef.current?.reportValidity()) {
      return;
    }

    setSubmitMode(mode);
    mutation.mutate(mode);
  }

  return (
    <section className="space-y-6">
      <AdminPageHeader
        eyebrow="变更申请"
        title="新建变更申请"
        description="填写变更信息后可保存为草稿，也可以一次性保存并提交审批。"
        trailing={
          <Button variant="secondary" asChild>
            <Link href="/admin/ontology/change-requests">
              返回列表
            </Link>
          </Button>
        }
      />

      <AdminCard
        title="基本信息"
        description="变更申请的核心标识与说明"
      >
        <form ref={formRef} className="space-y-6" onSubmit={(event) => event.preventDefault()}>
          <Field required>
            <FieldLabel>标题</FieldLabel>
            <FieldInput name="title" required maxLength={200} placeholder="简要描述本次变更的内容" />
            <FieldHelper>变更申请的标题，用于在列表中快速识别</FieldHelper>
          </Field>

          <Field>
            <FieldLabel>描述</FieldLabel>
            <FieldTextarea name="description" placeholder="详细说明变更的背景、目的和预期效果" className="min-h-[100px]" />
            <FieldHelper>可选。提供更详细的变更说明，帮助审批人理解变更意图</FieldHelper>
          </Field>

          <div className="border-b border-border pb-2 text-sm font-semibold text-foreground">变更目标</div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="block text-sm font-semibold text-foreground">目标版本 <span className="text-destructive">*</span></span>
              <select className="h-11 w-full rounded-md border border-input bg-card px-3.5 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/40" name="ontologyVersionId" required>
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.semver} · {v.displayName} · {getVersionStatusLabel(v.status)}
                  </option>
                ))}
              </select>
              <span className="mt-1.5 block text-xs leading-5 text-muted-foreground">变更将应用到的目标版本</span>
            </label>

            <label className="block">
              <span className="block text-sm font-semibold text-foreground">目标对象类型 <span className="text-destructive">*</span></span>
              <select className="h-11 w-full rounded-md border border-input bg-card px-3.5 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/40" name="targetObjectType" required>
                {TARGET_OBJECT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TARGET_OBJECT_TYPE_LABELS[t] ?? t}
                  </option>
                ))}
              </select>
              <span className="mt-1.5 block text-xs leading-5 text-muted-foreground">本次变更涉及的治理对象类型</span>
            </label>

            <label className="block">
              <span className="block text-sm font-semibold text-foreground">业务键 <span className="text-destructive">*</span></span>
              <FieldInput name="targetObjectKey" required placeholder="如：metrics.revenue" />
              <span className="mt-1.5 block text-xs leading-5 text-muted-foreground">变更对象的唯一业务标识符</span>
            </label>

            <label className="block">
              <span className="block text-sm font-semibold text-foreground">变更类型 <span className="text-destructive">*</span></span>
              <select className="h-11 w-full rounded-md border border-input bg-card px-3.5 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/40" name="changeType" required>
                {CHANGE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {CHANGE_TYPE_LABELS[t] ?? t}
                  </option>
                ))}
              </select>
              <span className="mt-1.5 block text-xs leading-5 text-muted-foreground">本次变更的操作类型</span>
            </label>
          </div>

          <div className="border-b border-border pb-2 text-sm font-semibold text-foreground">影响评估</div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="block text-sm font-semibold text-foreground">兼容性 <span className="text-destructive">*</span></span>
              <select className="h-11 w-full rounded-md border border-input bg-card px-3.5 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/40" name="compatibilityType" required>
                {COMPATIBILITY_TYPES.map((t) => {
                  const compatLabel = COMPATIBILITY_LABELS[t];
                  return (
                    <option key={t} value={t}>
                      {compatLabel?.label ?? t}
                    </option>
                  );
                })}
              </select>
              <span className="mt-1.5 block text-xs leading-5 text-muted-foreground">
                {COMPATIBILITY_TYPES.map((t) => {
                  const compatLabel = COMPATIBILITY_LABELS[t];
                  return compatLabel ? `${compatLabel.label}：${compatLabel.note}` : null;
                }).filter(Boolean).join('；')}
              </span>
            </label>

            <label className="block">
              <span className="block text-sm font-semibold text-foreground">影响范围</span>
              <FieldInput name="impactScope" placeholder="metrics.x, factors.y" />
              <span className="mt-1.5 block text-xs leading-5 text-muted-foreground">受本次变更影响的其他对象，多个用逗号或换行分隔</span>
            </label>
          </div>

          <Field>
            <FieldLabel>兼容说明</FieldLabel>
            <FieldTextarea name="compatibilityNote" placeholder="说明兼容性评估的依据和注意事项" className="min-h-[80px]" />
            <FieldHelper>可选。对兼容性选择的补充说明</FieldHelper>
          </Field>

          <div className="border-b border-border pb-2 text-sm font-semibold text-foreground">变更内容</div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="block text-sm font-semibold text-foreground">变更前摘要</span>
              <FieldTextarea
                name="beforeSummary"
                placeholder='{"calculation":"by_amount"}'
                className="min-h-[120px] font-mono text-xs"
              />
              <span className="mt-1.5 block text-xs leading-5 text-muted-foreground">变更前的配置或定义，JSON 格式</span>
            </label>

            <label className="block">
              <span className="block text-sm font-semibold text-foreground">变更后摘要</span>
              <FieldTextarea
                name="afterSummary"
                placeholder='{"calculation":"by_count"}'
                className="min-h-[120px] font-mono text-xs"
              />
              <span className="mt-1.5 block text-xs leading-5 text-muted-foreground">变更后的配置或定义，JSON 格式</span>
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border pt-6">
            <Button variant="secondary" asChild>
              <Link href="/admin/ontology/change-requests">
                取消
              </Link>
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={isSubmitting}
              onClick={() => submit('draft')}
            >
              {isSubmitting && submitMode === 'draft' ? '保存中...' : '保存为草稿'}
            </Button>
            <Button
              type="button"
              disabled={isSubmitting}
              onClick={() => submit('submit')}
            >
              {isSubmitting && submitMode === 'submit' ? '提交中...' : '保存并提交审批'}
            </Button>
          </div>
        </form>
      </AdminCard>
    </section>
  );
}
