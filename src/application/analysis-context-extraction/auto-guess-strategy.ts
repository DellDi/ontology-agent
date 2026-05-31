import type { ContextExtractionResult } from './use-cases';

/**
 * 自动猜测决策：
 * - execute：置信度充足，直接执行
 * - execute-with-confirmation：中等置信度，执行前展示抽取摘要供用户确认
 * - block：置信度过低或需澄清，阻止执行并说明原因
 */
export type AutoGuessDecision =
  | { action: 'execute'; reason: string }
  | { action: 'execute-with-confirmation'; reason: string; summary: string }
  | { action: 'block'; reason: string };

function buildConfirmationSummary(result: ContextExtractionResult): string {
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
  if (context.comparison.value && context.comparison.state !== 'missing') {
    parts.push(`比较：${context.comparison.value}`);
  }
  return parts.join('；') || '上下文信息不足，请补充。';
}

/**
 * 根据抽取结果决定是否可以自动执行分析：
 * - needsClarification=true → 强制 block
 * - confidence ≥ 0.7 → execute
 * - confidence ≥ 0.4 → execute-with-confirmation（附带抽取摘要）
 * - confidence < 0.4 → block
 */
export function resolveAutoGuessDecision(
  result: ContextExtractionResult,
): AutoGuessDecision {
  if (result.needsClarification) {
    return {
      action: 'block',
      reason: 'LLM 标记需要澄清，请先与用户确认分析上下文。',
    };
  }

  if (result.confidence >= 0.7) {
    return {
      action: 'execute',
      reason: `整体置信度 ${result.confidence.toFixed(2)} ≥ 0.7，可直接执行。`,
    };
  }

  if (result.confidence >= 0.4) {
    const summary = buildConfirmationSummary(result);
    return {
      action: 'execute-with-confirmation',
      reason: `整体置信度 ${result.confidence.toFixed(2)} 介于 0.4–0.7 之间，建议向用户确认。`,
      summary,
    };
  }

  return {
    action: 'block',
    reason: `整体置信度 ${result.confidence.toFixed(2)} < 0.4，无法可靠执行。`,
  };
}
