import type { AnalysisExecutionStreamEvent } from '@/domain/analysis-execution/stream-models';

export type ReducedStepCard = {
  stepId: string;
  stepLabel: string;
  stageLabel: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  renderBlocks: AnalysisExecutionStreamEvent['renderBlocks'];
};

export type ReduceEventsInput = {
  events: readonly AnalysisExecutionStreamEvent[];
  executionStatus?: 'running' | 'completed' | 'failed';
};

/**
 * 将细粒度事件流归并为按步骤聚合的卡片列表。
 *
 * 同一 step.id 的多个事件（step-started, step-lifecycle, tool-*, step-completed）
 * 归并为一张卡片，状态按优先级：failed > completed > running。
 *
 * 当 executionStatus 为终态（completed / failed）时，所有仍处于 running 的
 * step 卡片会被收敛为对应终态，避免执行结束后仍显示"执行中"。
 */
export function reduceEventsToStepCards(
  input: ReduceEventsInput | readonly AnalysisExecutionStreamEvent[],
): ReducedStepCard[] {
  // 兼容旧的直接传 events 数组的调用方式（'events' in 区分对象与数组）
  const isLegacyArray = !('events' in input);
  const events: readonly AnalysisExecutionStreamEvent[] = isLegacyArray
    ? input
    : input.events;
  const executionStatus: 'running' | 'completed' | 'failed' | undefined =
    isLegacyArray ? undefined : input.executionStatus;
  const stepMap = new Map<string, ReducedStepCard>();

  for (const event of events) {
    const stepId = event.step?.id;
    const hasRenderBlocks = event.renderBlocks && event.renderBlocks.length > 0;

    if (!stepId) {
      // 无 step 但有 renderBlocks 的事件 → 归入执行级卡片
      if (hasRenderBlocks && event.renderBlocks) {
        const execCardKey = '__execution_level__';
        const existing = stepMap.get(execCardKey);
        // 执行级卡片状态：取事件自身的 status（如 execution-status 的 completed/failed）
        const eventLevelStatus: 'running' | 'completed' | 'failed' =
          event.status === 'failed'
            ? 'failed'
            : event.status === 'completed'
              ? 'completed'
              : 'running';
        if (existing) {
          existing.renderBlocks = [
            ...(existing.renderBlocks ?? []),
            ...event.renderBlocks,
          ];
          // 状态升级（failed > completed > running）
          const priority = { running: 0, completed: 1, failed: 2 };
          if (priority[eventLevelStatus] > priority[existing.status]) {
            existing.status = eventLevelStatus;
          }
        } else {
          stepMap.set(execCardKey, {
            stepId: execCardKey,
            stepLabel: event.stage?.label ?? '执行级结果',
            stageLabel: event.stage?.label ?? '执行结果',
            status: eventLevelStatus,
            startedAt: event.timestamp,
            renderBlocks: event.renderBlocks,
          });
        }
      }
      // 无 step 且无 renderBlocks 的事件（如 execution-status）— 跳过
      continue;
    }

    const existing = stepMap.get(stepId);

    // 从当前事件推导状态（failed 优先于 completed）
    let eventStatus: 'running' | 'completed' | 'failed' = 'running';
    if (event.status === 'failed' || event.step?.status === 'failed') {
      eventStatus = 'failed';
    } else if (
      event.status === 'completed' ||
      event.step?.status === 'completed' ||
      event.kind === 'step-completed'
    ) {
      eventStatus = 'completed';
    }

    // 推导显示标签
    const stepLabel = event.step?.title ?? event.message ?? '执行步骤';
    const stageLabel =
      event.stage?.label ??
      (event.kind === 'stage-result' ? '阶段结果' : '执行中');

    if (!existing) {
      stepMap.set(stepId, {
        stepId,
        stepLabel,
        stageLabel,
        status: eventStatus,
        startedAt: event.timestamp,
        completedAt: eventStatus !== 'running' ? event.timestamp : undefined,
        renderBlocks: event.renderBlocks ?? [],
      });
    } else {
      // 升级状态（failed > completed > running）
      const statusPriority = { running: 0, completed: 1, failed: 2 };
      if (statusPriority[eventStatus] > statusPriority[existing.status]) {
        existing.status = eventStatus;
      }
      if (eventStatus !== 'running') {
        existing.completedAt = event.timestamp;
      }
      // 累积 stage-result 的 renderBlocks
      if (event.renderBlocks?.length) {
        existing.renderBlocks = [
          ...(existing.renderBlocks ?? []),
          ...event.renderBlocks,
        ];
      }
      // 更新为更具描述性的标签
      if (event.step?.title) {
        existing.stepLabel = event.step.title;
      }
      if (event.stage?.label) {
        existing.stageLabel = event.stage.label;
      }
    }
  }

  // 如果 execution 已进入终态，将所有仍处于 running 的 step 收敛为终态
  if (executionStatus === 'completed' || executionStatus === 'failed') {
    for (const card of stepMap.values()) {
      if (card.status === 'running') {
        card.status = executionStatus;
        card.completedAt = card.startedAt;
      }
    }
  }

  return Array.from(stepMap.values());
}
