import type { changeRequestStatusTone } from '../_components/admin-shell';

type StatusTone = ReturnType<typeof changeRequestStatusTone>;

export type StatusLabel = {
  label: string;
  description: string;
  tone: StatusTone;
};

export const CR_STATUS_LABELS: Record<string, StatusLabel> = {
  draft: {
    label: '草稿',
    description: '已保存，尚未提交审批',
    tone: 'neutral',
  },
  submitted: {
    label: '待审批',
    description: '已提交，等待审批人处理',
    tone: 'warning',
  },
  approved: {
    label: '已通过',
    description: '审批通过，可以发布',
    tone: 'info',
  },
  rejected: {
    label: '已驳回',
    description: '审批未通过，需要修改后重新提交',
    tone: 'danger',
  },
  published: {
    label: '已发布',
    description: '变更已生效',
    tone: 'success',
  },
  superseded: {
    label: '已替代',
    description: '已被更新的变更替代',
    tone: 'neutral',
  },
};

export function getCRStatusLabel(status: string): StatusLabel {
  return CR_STATUS_LABELS[status] ?? {
    label: status,
    description: '',
    tone: 'neutral',
  };
}

export const CHANGE_TYPE_LABELS: Record<string, string> = {
  create: '新建',
  update: '修改',
  delete: '删除',
};

export function getChangeTypeLabel(type: string): string {
  return CHANGE_TYPE_LABELS[type] ?? type;
}

export type CompatibilityLabel = {
  label: string;
  note: string;
};

export const COMPATIBILITY_LABELS: Record<string, CompatibilityLabel> = {
  backward_compatible: {
    label: '向下兼容',
    note: '不影响已有消费方，可安全发布',
  },
  breaking: {
    label: '不兼容变更',
    note: '可能影响已有消费方，需谨慎评估后发布',
  },
};

export function getCompatibilityLabel(type: string): CompatibilityLabel {
  return COMPATIBILITY_LABELS[type] ?? {
    label: type,
    note: '',
  };
}

export const TARGET_OBJECT_TYPE_LABELS: Record<string, string> = {
  entity_definition: '实体定义',
  metric: '指标',
  metric_variant: '指标变体',
  factor: '因素',
  plan_step_template: '计划步骤模板',
  time_semantic: '时间语义',
  causality_edge: '因果边',
  evidence_type: '证据类型',
};

export function getTargetObjectTypeLabel(type: string): string {
  return TARGET_OBJECT_TYPE_LABELS[type] ?? type;
}

export const CR_STATUS_FLOW = ['draft', 'submitted', 'approved', 'published'] as const;

export function getCRStatusFlowIndex(status: string): number {
  const idx = CR_STATUS_FLOW.indexOf(status as (typeof CR_STATUS_FLOW)[number]);
  return idx >= 0 ? idx : -1;
}

export const VERSION_STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  approved: '已批准',
  published: '已发布',
  deprecated: '已废弃',
};

export function getVersionStatusLabel(status: string): string {
  return VERSION_STATUS_LABELS[status] ?? status;
}
