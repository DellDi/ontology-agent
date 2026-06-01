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

/**
 * 将细粒度事件流归并为按步骤聚合的卡片列表。
 *
 * 同一 step.id 的多个事件（step-started, step-lifecycle, tool-*, step-completed）
 * 归并为一张卡片，状态按优先级：failed > completed > running。
 */
export function reduceEventsToStepCards(
  events: readonly AnalysisExecutionStreamEvent[],
): ReducedStepCard[] {
  const stepMap = new Map<string, ReducedStepCard>();

  for (const event of events) {
    const stepId = event.step?.id;
    const hasRenderBlocks = event.renderBlocks && event.renderBlocks.length > 0;

    if (!stepId) {
      // 无 step 但有 renderBlocks 的事件 → 归入执行级卡片
      if (hasRenderBlocks) {
        const execCardKey = '__execution_level__';
        const existing = stepMap.get(execCardKey);
        if (existing) {
          existing.renderBlocks = [
            ...(existing.renderBlocks ?? []),
            ...event.renderBlocks,
          ];
        } else {
          stepMap.set(execCardKey, {
            stepId: execCardKey,
            stepLabel: event.stage?.label ?? '执行级结果',
            stageLabel: event.stage?.label ?? '执行结果',
            status: 'completed',
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

  return Array.from(stepMap.values());
}
