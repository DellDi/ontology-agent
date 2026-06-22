import type { AnalysisRenderedBlock } from '@/application/analysis-interaction';

export function getToneClassName(tone: unknown) {
  // 全部走 color-mix + 主题 token，自动响应 dark
  switch (tone) {
    case 'success':
      return 'bg-[color:color-mix(in_srgb,var(--success-500)_10%,transparent)] border border-[color:var(--success-500)]/30';
    case 'error':
      return 'bg-[color:color-mix(in_srgb,var(--danger-500)_10%,transparent)] border border-[color:var(--danger-500)]/30';
    case 'warning':
      return 'bg-[color:color-mix(in_srgb,var(--warning-500)_12%,transparent)] border border-[color:var(--warning-500)]/30';
    case 'info':
      return 'bg-[color:color-mix(in_srgb,var(--brand-500)_10%,transparent)] border border-[color:var(--brand-300)]/40';
    default:
      return 'bg-card border border-border';
  }
}

export function getString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

export function getItems(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          !!item && typeof item === 'object' && !Array.isArray(item),
      )
    : [];
}

export function getToolStatusLabel(status: unknown) {
  switch (status) {
    case 'completed':
      return '已完成';
    case 'failed':
      return '已失败';
    case 'running':
      return '执行中';
    default:
      return '已选择';
  }
}

export function renderTitle(block: AnalysisRenderedBlock, fallback?: string) {
  const text = block.title ?? block.label ?? fallback;
  if (!text) return null;
  return (
    <p className="text-xs font-semibold tracking-[0.1em] uppercase text-[color:var(--brand-700)]">
      {text}
    </p>
  );
}
