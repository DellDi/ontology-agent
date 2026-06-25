import type { AnalysisRenderedBlock } from '@/application/analysis-interaction';

export function getToneClassName(tone: unknown) {
  // 全部走 shadcn 语义色 + 透明度，自动响应 dark
  switch (tone) {
    case 'success':
      return 'bg-emerald-500/10 border border-emerald-500/30';
    case 'error':
      return 'bg-rose-500/10 border border-rose-500/30';
    case 'warning':
      return 'bg-amber-500/10 border border-amber-500/30';
    case 'info':
      return 'bg-primary/10 border border-primary/30';
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
    <p className="text-xs font-semibold tracking-[0.1em] uppercase text-primary">
      {text}
    </p>
  );
}
