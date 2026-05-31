import type { ContextExtractionResult } from './use-cases';

/**
 * 自动猜测决策（产品方向：始终执行 + 展示假设 + 允许修正）：
 * - execute：置信度充足，直接执行
 * - execute-with-assumptions：置信度不足但仍执行，显式展示系统理解供用户修正
 */
export type AutoGuessDecision =
  | { action: 'execute'; reason: string }
  | {
      action: 'execute-with-assumptions';
      reason: string;
      summary: string;
      assumptions: string[];
    };

function buildAssumptionSummary(result: ContextExtractionResult): string {
  const parts: string[] = [];
  const { context } = result;
  if (context.targetMetric.value && context.targetMetric.state !== 'missing') {
    parts.push(`指标：${context.targetMetric.value}`);
  }
  if (context.entity.value && context.entity.state !== 'missing') {
    parts.push(`实体：${context.entity.value}`);
  }
  if (context.timeRange.value && context.timeRange.state !== 'missing') {
    parts.push(`时间：${context.timeRange.value}`);
  }
  if (
    context.comparison.value &&
    context.comparison.state !== 'missing' &&
    context.comparison.value !== '无需比较'
  ) {
    parts.push(`比较：${context.comparison.value}`);
  }
  return parts.join('；') || '系统未能识别足够的分析上下文。';
}

/**
 * 根据抽取结果决定执行策略。
 *
 * 产品方向："自动猜测，带假设可修正" — 始终执行分析，
 * 置信度不足时在主界面轻量展示系统理解，并提供"修改理解"入口。
 */
export function resolveAutoGuessDecision(
  result: ContextExtractionResult,
): AutoGuessDecision {
  if (result.confidence >= 0.7 && !result.needsClarification) {
    return {
      action: 'execute',
      reason: `整体置信度 ${result.confidence.toFixed(2)} ≥ 0.7，可直接执行。`,
    };
  }

  const summary = buildAssumptionSummary(result);
  return {
    action: 'execute-with-assumptions',
    reason: result.needsClarification
      ? 'LLM 标记需要澄清，但仍以最佳猜测执行并展示假设。'
      : `整体置信度 ${result.confidence.toFixed(2)} < 0.7，以最佳猜测执行并展示假设。`,
    summary,
    assumptions: result.assumptions,
  };
}
