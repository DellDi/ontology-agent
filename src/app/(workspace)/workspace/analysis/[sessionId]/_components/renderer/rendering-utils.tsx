import type { AnalysisRenderedBlock } from '@/application/analysis-interaction';

export function getToneClassName(tone: unknown) {
  switch (tone) {
    case 'success':
      return 'bg-emerald-50';
    case 'error':
      return 'bg-rose-50';
    case 'info':
      return 'bg-sky-50';
    default:
      return 'bg-[color:var(--sky-50)]';
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
  return (
    <p className="text-xs font-medium tracking-[0.12em] text-[color:var(--brand-700)]">
      {block.title ?? block.label ?? fallback}
    </p>
  );
}
