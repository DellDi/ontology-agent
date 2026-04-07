import { validateAnalysisExecutionJobData } from '@/domain/analysis-execution/models';

export const JOB_TYPES = ['health-check', 'analysis-execution'] as const;

export type JobType = (typeof JOB_TYPES)[number];

export const JOB_STATUSES = [
  'pending',
  'processing',
  'completed',
  'failed',
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export type JobPayload = {
  type: JobType;
  data: Record<string, unknown>;
};

export type Job = {
  id: string;
  type: JobType;
  status: JobStatus;
  data: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export type JobSubmission = {
  type: JobType;
  data?: Record<string, unknown>;
};

export class InvalidJobPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidJobPayloadError';
  }
}

export function validateJobPayload(payload: unknown): JobPayload {
  if (!payload || typeof payload !== 'object') {
    throw new InvalidJobPayloadError('任务载荷必须是一个对象。');
  }

  const candidate = payload as Record<string, unknown>;

  if (
    typeof candidate.type !== 'string' ||
    !JOB_TYPES.includes(candidate.type as JobType)
  ) {
    throw new InvalidJobPayloadError(
      `不支持的任务类型: ${String(candidate.type)}。支持的类型: ${JOB_TYPES.join(', ')}`,
    );
  }

  const data =
    candidate.data !== undefined && candidate.data !== null
      ? candidate.data
      : {};

  if (typeof data !== 'object' || Array.isArray(data)) {
    throw new InvalidJobPayloadError('任务数据必须是一个键值对象。');
  }

  const normalizedPayload = {
    type: candidate.type as JobType,
    data: data as Record<string, unknown>,
  };

  if (normalizedPayload.type === 'analysis-execution') {
    validateAnalysisExecutionJobData(normalizedPayload.data);
  }

  return normalizedPayload;
}

const JOB_TYPE_LABELS: Record<JobType, string> = {
  'health-check': '健康检查',
  'analysis-execution': '分析执行',
};

export function getJobTypeLabel(type: JobType): string {
  return JOB_TYPE_LABELS[type];
}

const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  pending: '等待中',
  processing: '处理中',
  completed: '已完成',
  failed: '已失败',
};

export function getJobStatusLabel(status: JobStatus): string {
  return JOB_STATUS_LABELS[status];
}
