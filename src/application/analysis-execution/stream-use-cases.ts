import { randomUUID } from 'node:crypto';

import { validateAnalysisExecutionJobData } from '@/domain/analysis-execution/models';
import {
  getExecutionStatusLabel,
  getExecutionStatusTone,
  type AnalysisExecutionStreamEvent,
} from '@/domain/analysis-execution/stream-models';
import type { AnalysisExecutionSnapshot } from '@/domain/analysis-execution/persistence-models';
import type { Job } from '@/domain/job-contract/models';

import type { AnalysisExecutionEventStore } from './stream-ports';

export type AnalysisExecutionStreamReadModel = {
  sessionId: string;
  executionId: string;
  currentStatus: AnalysisExecutionStreamEvent['status'] | null;
  hasEvents: boolean;
  events: AnalysisExecutionStreamEvent[];
};

export type AnalysisExecutionStreamAccessResolution =
  | { allowed: true; source: 'snapshot' | 'job' }
  | { allowed: false; status: 404; reason: string };

export function resolveAnalysisExecutionStreamAccess(input: {
  sessionId: string;
  ownerUserId: string;
  executionId: string;
  snapshot: Pick<
    AnalysisExecutionSnapshot,
    'sessionId' | 'ownerUserId' | 'executionId'
  > | null;
  job: Pick<Job, 'id' | 'type' | 'data'> | null;
}): AnalysisExecutionStreamAccessResolution {
  if (
    input.snapshot &&
    input.snapshot.sessionId === input.sessionId &&
    input.snapshot.ownerUserId === input.ownerUserId &&
    input.snapshot.executionId === input.executionId
  ) {
    return { allowed: true, source: 'snapshot' };
  }

  if (input.job?.id === input.executionId && input.job.type === 'analysis-execution') {
    try {
      const jobData = validateAnalysisExecutionJobData(input.job.data);
      if (
        jobData.sessionId === input.sessionId &&
        jobData.ownerUserId === input.ownerUserId
      ) {
        return { allowed: true, source: 'job' };
      }
    } catch {
      return {
        allowed: false,
        status: 404,
        reason: 'execution job data is invalid',
      };
    }
  }

  return {
    allowed: false,
    status: 404,
    reason: 'execution does not belong to session',
  };
}

export function createAnalysisExecutionStreamUseCases({
  eventStore,
}: {
  eventStore: AnalysisExecutionEventStore;
}) {
  return {
    async publishEvent(input: {
      sessionId: string;
      executionId: string;
      kind: AnalysisExecutionStreamEvent['kind'];
      status?: AnalysisExecutionStreamEvent['status'];
      message?: string;
      step?: AnalysisExecutionStreamEvent['step'];
      stage?: AnalysisExecutionStreamEvent['stage'];
      renderBlocks: AnalysisExecutionStreamEvent['renderBlocks'];
      metadata?: Record<string, unknown>;
    }) {
      return await eventStore.append(input);
    },

    async publishExecutionStatus(input: {
      sessionId: string;
      executionId: string;
      status: NonNullable<AnalysisExecutionStreamEvent['status']>;
      message: string;
      metadata?: Record<string, unknown>;
    }) {
      return await eventStore.append({
        sessionId: input.sessionId,
        executionId: input.executionId,
        kind: 'execution-status',
        status: input.status,
        message: input.message,
        metadata: input.metadata,
        renderBlocks: [
          {
            type: 'status',
            title: '执行状态',
            value: getExecutionStatusLabel(input.status),
            tone: getExecutionStatusTone(input.status),
          },
          {
            type: 'kv-list',
            title: '执行元数据',
            items: [
              {
                label: 'Execution ID',
                value: input.executionId,
              },
              {
                label: '时间',
                value: new Date().toISOString(),
              },
            ],
          },
          {
            type: 'markdown',
            title: '状态说明',
            content: input.message,
          },
        ],
      });
    },

    async listExecutionEvents({
      sessionId,
      executionId,
    }: {
      sessionId: string;
      executionId?: string;
    }) {
      const events = await eventStore.listBySession(sessionId);

      return events.filter((event) =>
        executionId ? event.executionId === executionId : true,
      );
    },

    async buildReadModel({
      sessionId,
      executionId,
    }: {
      sessionId: string;
      executionId: string;
    }): Promise<AnalysisExecutionStreamReadModel> {
      const events = await this.listExecutionEvents({
        sessionId,
        executionId,
      });

      const latestStatusEvent = [...events]
        .reverse()
        .find((event) => event.kind === 'execution-status' && event.status);

      return {
        sessionId,
        executionId,
        currentStatus: latestStatusEvent?.status ?? null,
        hasEvents: events.length > 0,
        events,
      };
    },

    createStageResultEvent(input: {
      sessionId: string;
      executionId: string;
      step: NonNullable<AnalysisExecutionStreamEvent['step']>;
      tools: { toolName: string; objective: string; status: 'selected' | 'running' | 'completed' | 'failed' }[];
      processedStepCount: number;
      totalStepCount: number;
      message: string;
    }): AnalysisExecutionStreamEvent {
      return {
        id: randomUUID(),
        sessionId: input.sessionId,
        executionId: input.executionId,
        sequence: 0,
        kind: 'stage-result',
        timestamp: new Date().toISOString(),
        message: input.message,
        step: input.step,
        stage: {
          key: input.step.id,
          label: `步骤 ${input.step.order}`,
          status: input.step.status,
        },
        renderBlocks: [
          {
            type: 'status',
            title: '阶段状态',
            value: input.step.status === 'completed' ? '已完成' : input.step.status === 'failed' ? '已失败' : '执行中',
            tone:
              input.step.status === 'completed'
                ? 'success'
                : input.step.status === 'failed'
                  ? 'error'
                  : 'info',
          },
          {
            type: 'kv-list',
            title: '阶段结果',
            items: [
              { label: '当前步骤', value: input.step.title },
              {
                label: '进度',
                value: `${input.processedStepCount}/${input.totalStepCount}`,
              },
            ],
          },
          {
            type: 'tool-list',
            title: '工具调用',
            items: input.tools,
          },
          {
            type: 'markdown',
            title: '阶段说明',
            content: input.message,
          },
        ],
      };
    },
  };
}
