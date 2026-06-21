import Link from 'next/link';

import {
  CHANGE_TYPES,
  COMPATIBILITY_TYPES,
  TARGET_OBJECT_TYPES,
} from '@/domain/ontology/governance';
import { createCompositionRoot, requireOntologyAdminSession } from '@/composition-root';

import {
  AdminCard,
  AdminPageHeader,
} from '../../../../_components/admin-shell';
import {
  COMPATIBILITY_LABELS,
  CHANGE_TYPE_LABELS,
  TARGET_OBJECT_TYPE_LABELS,
} from '../../../../_lib/admin-labels';

export default async function NewChangeRequestPage() {
  const state = await requireOntologyAdminSession('/admin/ontology/change-requests/new');
  if (state.accessDeniedMessage) return null;

  if (!state.capabilities.canAuthor) {
    return (
      <section className="space-y-6">
        <AdminPageHeader
          eyebrow="变更申请"
          title="权限不足"
          description="您没有创建变更申请的权限。"
        />
        <AdminCard title="">
          <p className="text-sm text-[color:var(--ink-600)]">
            请联系管理员获取变更申请的创建权限。
          </p>
          <Link href="/admin/ontology/change-requests" className="secondary-button mt-4 inline-block">
            返回变更申请列表
          </Link>
        </AdminCard>
      </section>
    );
  }

  const { adminUseCases } = createCompositionRoot().ontologyAdminRuntime;
  const versions = await adminUseCases.listVersions(20);

  if (versions.length === 0) {
    return (
      <section className="space-y-6">
        <AdminPageHeader
          eyebrow="变更申请"
          title="无法创建"
          description="当前没有可用的目标版本，请先通过 bootstrap 流程创建首个版本。"
        />
        <Link href="/admin/ontology/change-requests" className="secondary-button inline-block">
          返回变更申请列表
        </Link>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <AdminPageHeader
        eyebrow="变更申请"
        title="新建变更申请"
        description="填写变更信息后保存为草稿，确认无误后再提交进入审批流程。"
        trailing={
          <Link href="/admin/ontology/change-requests" className="secondary-button">
            返回列表
          </Link>
        }
      />

      <AdminCard
        title="基本信息"
        description="变更申请的核心标识与说明"
      >
        <form
          method="post"
          action="/api/admin/ontology/change-requests"
          className="space-y-6"
        >
          <div className="form-group">
            <label className="block">
              <span className="field-label">标题 <span className="text-[color:var(--danger-500)]">*</span></span>
              <input className="field-input" name="title" required maxLength={200} placeholder="简要描述本次变更的内容" />
              <span className="field-helper">变更申请的标题，用于在列表中快速识别</span>
            </label>
          </div>

          <div className="form-group">
            <label className="block">
              <span className="field-label">描述</span>
              <textarea className="field-input min-h-[100px]" name="description" placeholder="详细说明变更的背景、目的和预期效果" />
              <span className="field-helper">可选。提供更详细的变更说明，帮助审批人理解变更意图</span>
            </label>
          </div>

          <div className="form-group-title">变更目标</div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="field-label">目标版本 <span className="text-[color:var(--danger-500)]">*</span></span>
              <select className="field-input" name="ontologyVersionId" required>
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.semver} · {v.displayName} · {v.status}
                  </option>
                ))}
              </select>
              <span className="field-helper">变更将应用到的目标版本</span>
            </label>

            <label className="block">
              <span className="field-label">目标对象类型 <span className="text-[color:var(--danger-500)]">*</span></span>
              <select className="field-input" name="targetObjectType" required>
                {TARGET_OBJECT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TARGET_OBJECT_TYPE_LABELS[t] ?? t}
                  </option>
                ))}
              </select>
              <span className="field-helper">本次变更涉及的治理对象类型</span>
            </label>

            <label className="block">
              <span className="field-label">业务键 <span className="text-[color:var(--danger-500)]">*</span></span>
              <input className="field-input" name="targetObjectKey" required placeholder="如：metrics.revenue" />
              <span className="field-helper">变更对象的唯一业务标识符</span>
            </label>

            <label className="block">
              <span className="field-label">变更类型 <span className="text-[color:var(--danger-500)]">*</span></span>
              <select className="field-input" name="changeType" required>
                {CHANGE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {CHANGE_TYPE_LABELS[t] ?? t}
                  </option>
                ))}
              </select>
              <span className="field-helper">本次变更的操作类型</span>
            </label>
          </div>

          <div className="form-group-title">影响评估</div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="field-label">兼容性 <span className="text-[color:var(--danger-500)]">*</span></span>
              <select className="field-input" name="compatibilityType" required>
                {COMPATIBILITY_TYPES.map((t) => {
                  const compatLabel = COMPATIBILITY_LABELS[t];
                  return (
                    <option key={t} value={t}>
                      {compatLabel?.label ?? t}
                    </option>
                  );
                })}
              </select>
              <span className="field-helper">
                {COMPATIBILITY_TYPES.map((t) => {
                  const compatLabel = COMPATIBILITY_LABELS[t];
                  return compatLabel ? `${compatLabel.label}：${compatLabel.note}` : null;
                }).filter(Boolean).join('；')}
              </span>
            </label>

            <label className="block">
              <span className="field-label">影响范围</span>
              <input className="field-input" name="impactScope" placeholder="metrics.x, factors.y" />
              <span className="field-helper">受本次变更影响的其他对象，多个用逗号或换行分隔</span>
            </label>
          </div>

          <div className="form-group">
            <label className="block">
              <span className="field-label">兼容说明</span>
              <textarea className="field-input min-h-[80px]" name="compatibilityNote" placeholder="说明兼容性评估的依据和注意事项" />
              <span className="field-helper">可选。对兼容性选择的补充说明</span>
            </label>
          </div>

          <div className="form-group-title">变更内容</div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="field-label">变更前摘要</span>
              <textarea
                className="field-input min-h-[120px] font-mono text-xs"
                name="beforeSummary"
                placeholder='{"calculation":"by_amount"}'
              />
              <span className="field-helper">变更前的配置或定义，JSON 格式</span>
            </label>

            <label className="block">
              <span className="field-label">变更后摘要</span>
              <textarea
                className="field-input min-h-[120px] font-mono text-xs"
                name="afterSummary"
                placeholder='{"calculation":"by_count"}'
              />
              <span className="field-helper">变更后的配置或定义，JSON 格式</span>
            </label>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-[color:var(--line-200)] pt-6">
            <Link href="/admin/ontology/change-requests" className="secondary-button">
              取消
            </Link>
            <button className="primary-button" type="submit">
              保存为草稿
            </button>
          </div>
        </form>
      </AdminCard>
    </section>
  );
}
