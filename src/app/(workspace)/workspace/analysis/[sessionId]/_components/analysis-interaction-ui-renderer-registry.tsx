'use client';

import type { ReactNode } from 'react';

import type { AnalysisRenderedBlock } from '@/application/analysis-interaction';

export type AnalysisInteractionUiRenderInput = {
  renderedBlock: AnalysisRenderedBlock;
  className?: string;
};

export type AnalysisInteractionUiRendererDescriptor = {
  kind: string;
  render: (input: AnalysisInteractionUiRenderInput) => ReactNode;
};

export type AnalysisInteractionUiRendererRegistry = {
  register: (descriptor: AnalysisInteractionUiRendererDescriptor) => void;
  resolve: (kind: string) => AnalysisInteractionUiRendererDescriptor | null;
  render: (input: AnalysisInteractionUiRenderInput) => ReactNode;
  fallback: (input: AnalysisInteractionUiRenderInput) => ReactNode;
};

function getToneClassName(tone: unknown) {
  switch (tone) {
    case 'success':
      return 'bg-emerald-50';
    case 'error':
      return 'bg-rose-50';
    case 'info':
      return 'bg-sky-50';
    default:
      return 'bg-[color:var(--sky-50)]/80';
  }
}

function getString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function getItems(value: unknown): Record<string, unknown>[] {
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

function renderTitle(block: AnalysisRenderedBlock, fallback?: string) {
  return (
    <p className="text-xs font-medium tracking-[0.18em] text-[color:var(--brand-700)] uppercase">
      {block.title ?? block.label ?? fallback}
    </p>
  );
}

function renderTable(block: AnalysisRenderedBlock) {
  const columns = Array.isArray(block.payload.columns)
    ? block.payload.columns.map((column) => String(column))
    : [];
  const rows = Array.isArray(block.payload.rows)
    ? block.payload.rows.map((row) =>
        Array.isArray(row) ? row.map((cell) => String(cell)) : [],
      )
    : [];

  return (
    <div className="mt-3 overflow-x-auto">
      <table className="min-w-full text-left text-sm text-[color:var(--ink-900)]">
        <thead>
          <tr className="border-b border-[color:var(--line-200)] text-[color:var(--ink-600)]">
            {columns.map((column) => (
              <th className="px-3 py-2 font-medium" key={column}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr
              className="border-b border-[color:var(--line-200)] last:border-b-0"
              key={`${block.source.eventId ?? block.source.sourceType}-row-${rowIndex}`}
            >
              {row.map((cell, cellIndex) => (
                <td
                  className="px-3 py-2"
                  key={`${block.source.eventId ?? block.source.sourceType}-cell-${rowIndex}-${cellIndex}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderChart(block: AnalysisRenderedBlock) {
  const series = getItems(block.payload.series);
  const firstSeries = series[0];
  const points = getItems(firstSeries?.points);
  const maxValue = Math.max(
    1,
    ...points.map((point) =>
      typeof point.value === 'number' ? point.value : Number(point.value) || 0,
    ),
  );

  return (
    <div className="mt-3 space-y-3">
      {points.map((point) => {
        const value =
          typeof point.value === 'number' ? point.value : Number(point.value) || 0;
        const width = Math.max(6, Math.round((value / maxValue) * 100));

        return (
          <div key={getString(point.label, String(value))}>
            <div className="flex items-center justify-between gap-3 text-xs text-[color:var(--ink-600)]">
              <span>{getString(point.label)}</span>
              <span>{value}</span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-white">
              <div
                className="h-2 rounded-full bg-[color:var(--brand-500)]"
                style={{ width: `${width}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function renderGraph(block: AnalysisRenderedBlock) {
  const nodes = getItems(block.payload.nodes);
  const edges = getItems(block.payload.edges);

  return (
    <div className="mt-3 space-y-3 text-sm text-[color:var(--ink-900)]">
      <div className="flex flex-wrap gap-2">
        {nodes.map((node) => (
          <span
            className="rounded-full bg-white px-3 py-1 text-xs text-[color:var(--ink-700)]"
            key={getString(node.id, getString(node.label))}
          >
            {getString(node.label)}
          </span>
        ))}
      </div>
      {edges.length > 0 ? (
        <ul className="space-y-1 text-xs text-[color:var(--ink-600)]">
          {edges.map((edge, index) => (
            <li key={`${getString(edge.source)}-${getString(edge.target)}-${index}`}>
              {getString(edge.source)} → {getString(edge.target)}
              {edge.label ? ` · ${String(edge.label)}` : ''}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function renderStatusBlock({ renderedBlock, className = '' }: AnalysisInteractionUiRenderInput) {
  return (
    <div className={`${className} rounded-2xl p-4 ${getToneClassName(renderedBlock.payload.tone)}`}>
      {renderTitle(renderedBlock)}
      <p className="mt-2 text-sm font-medium text-[color:var(--ink-900)]">
        {getString(renderedBlock.payload.value)}
      </p>
    </div>
  );
}

function renderKvListBlock({ renderedBlock, className = '' }: AnalysisInteractionUiRenderInput) {
  const items = getItems(renderedBlock.payload.items);
  return (
    <div className={`${className} rounded-2xl bg-[color:var(--sky-50)]/80 p-4`}>
      {renderTitle(renderedBlock)}
      <dl className="mt-3 grid gap-2 md:grid-cols-2">
        {items.map((item) => (
          <div key={getString(item.label)}>
            <dt className="text-xs text-[color:var(--ink-600)]">
              {getString(item.label)}
            </dt>
            <dd className="mt-1 text-sm text-[color:var(--ink-900)]">
              {getString(item.value)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function renderToolListBlock({ renderedBlock, className = '' }: AnalysisInteractionUiRenderInput) {
  const items = getItems(renderedBlock.payload.items);
  return (
    <div className={`${className} rounded-2xl bg-[color:var(--sky-50)]/80 p-4`}>
      {renderTitle(renderedBlock, '工具调用')}
      <ul className="mt-3 space-y-2 text-sm text-[color:var(--ink-900)]">
        {items.map((item) => (
          <li key={`${getString(item.toolName)}-${getString(item.objective)}`}>
            {getString(item.toolName)} · {getString(item.objective)} ·{' '}
            {getToolStatusLabel(item.status)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function renderMarkdownBlock({ renderedBlock, className = '' }: AnalysisInteractionUiRenderInput) {
  const titleBlock =
    renderedBlock.title === '阶段说明'
      ? { ...renderedBlock, title: '推理摘要' }
      : renderedBlock;

  return (
    <div className={`${className} rounded-2xl bg-[color:var(--sky-50)]/80 p-4`}>
      {renderTitle(titleBlock)}
      <p className="mt-2 text-sm leading-7 text-[color:var(--ink-600)]">
        {getString(renderedBlock.payload.content)}
      </p>
    </div>
  );
}

function renderTableBlock({ renderedBlock, className = '' }: AnalysisInteractionUiRenderInput) {
  return (
    <div className={`${className} rounded-2xl bg-[color:var(--sky-50)]/80 p-4`}>
      {renderTitle(renderedBlock)}
      {renderTable(renderedBlock)}
    </div>
  );
}

function renderChartBlock({ renderedBlock, className = '' }: AnalysisInteractionUiRenderInput) {
  return (
    <div className={`${className} rounded-2xl bg-[color:var(--sky-50)]/80 p-4`}>
      {renderTitle(renderedBlock)}
      {renderChart(renderedBlock)}
    </div>
  );
}

function renderGraphBlock({ renderedBlock, className = '' }: AnalysisInteractionUiRenderInput) {
  return (
    <div className={`${className} rounded-2xl bg-[color:var(--sky-50)]/80 p-4`}>
      {renderTitle(renderedBlock)}
      {renderGraph(renderedBlock)}
    </div>
  );
}

function renderEvidenceCardBlock({
  renderedBlock,
  className = '',
}: AnalysisInteractionUiRenderInput) {
  const evidence = getItems(renderedBlock.payload.evidence);
  return (
    <div className={`${className} rounded-2xl bg-[color:var(--sky-50)]/80 p-4`}>
      {renderTitle(renderedBlock)}
      <p className="mt-2 text-sm leading-7 text-[color:var(--ink-700)]">
        {getString(renderedBlock.payload.summary)}
      </p>
      <ul className="mt-3 space-y-2 text-sm text-[color:var(--ink-900)]">
        {evidence.map((item) => (
          <li key={getString(item.label)}>
            {getString(item.label)}：{getString(item.summary)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function renderTimelineBlock({ renderedBlock, className = '' }: AnalysisInteractionUiRenderInput) {
  const items = getItems(renderedBlock.payload.items);
  return (
    <div className={`${className} rounded-2xl bg-[color:var(--sky-50)]/80 p-4`}>
      {renderTitle(renderedBlock)}
      <ol className="mt-3 space-y-2 text-sm text-[color:var(--ink-900)]">
        {items.map((item) => (
          <li key={getString(item.id)}>
            {getString(item.title)} · {getString(item.status)}
            {item.summary ? ` · ${String(item.summary)}` : ''}
          </li>
        ))}
      </ol>
    </div>
  );
}

function renderApprovalStateBlock({
  renderedBlock,
  className = '',
}: AnalysisInteractionUiRenderInput) {
  return (
    <div className={`${className} rounded-2xl bg-[color:var(--sky-50)]/80 p-4`}>
      {renderTitle(renderedBlock)}
      <p className="mt-2 text-sm font-medium text-[color:var(--ink-900)]">
        {getString(renderedBlock.payload.state)}
        {renderedBlock.payload.owner ? ` · ${String(renderedBlock.payload.owner)}` : ''}
      </p>
      {renderedBlock.payload.reason ? (
        <p className="mt-2 text-sm text-[color:var(--ink-600)]">
          {String(renderedBlock.payload.reason)}
        </p>
      ) : null}
    </div>
  );
}

function renderSkillsStateBlock({
  renderedBlock,
  className = '',
}: AnalysisInteractionUiRenderInput) {
  const items = getItems(renderedBlock.payload.items);
  return (
    <div className={`${className} rounded-2xl bg-[color:var(--sky-50)]/80 p-4`}>
      {renderTitle(renderedBlock)}
      <ul className="mt-3 space-y-2 text-sm text-[color:var(--ink-900)]">
        {items.map((item) => (
          <li key={getString(item.skillName)}>
            {getString(item.skillName)} · {getString(item.status)}
            {item.summary ? ` · ${String(item.summary)}` : ''}
          </li>
        ))}
      </ul>
    </div>
  );
}

function renderFallbackBlock({
  renderedBlock,
  className = '',
}: AnalysisInteractionUiRenderInput) {
  return (
    <div className={`${className} rounded-2xl border border-amber-100 bg-amber-50/80 p-4`}>
      {renderTitle(renderedBlock, 'Fallback')}
      <p className="mt-2 text-sm leading-7 text-amber-900">
        未支持的分析块：{getString(renderedBlock.payload.originalKind, renderedBlock.kind)}
      </p>
      <p className="mt-1 text-xs text-amber-700">
        {getString(renderedBlock.payload.reason, 'renderer fallback')}
      </p>
    </div>
  );
}

export function createAnalysisInteractionUiRendererRegistry(
  descriptors: readonly AnalysisInteractionUiRendererDescriptor[] = [],
): AnalysisInteractionUiRendererRegistry {
  const byKind = new Map<string, AnalysisInteractionUiRendererDescriptor>();

  const registry: AnalysisInteractionUiRendererRegistry = {
    register(nextDescriptor) {
      byKind.set(nextDescriptor.kind, nextDescriptor);
    },
    resolve(kind) {
      return byKind.get(kind) ?? null;
    },
    render(input) {
      const nextDescriptor = byKind.get(input.renderedBlock.kind);
      if (nextDescriptor) {
        return nextDescriptor.render(input);
      }

      return registry.fallback({
        ...input,
        renderedBlock: {
          ...input.renderedBlock,
          kind: 'fallback-block',
          payload: {
            ...input.renderedBlock.payload,
            originalKind: input.renderedBlock.kind,
            reason: 'ui renderer not registered',
          },
        },
      });
    },
    fallback(input) {
      return renderFallbackBlock(input);
    },
  };

  for (const nextDescriptor of descriptors) {
    registry.register(nextDescriptor);
  }

  return registry;
}

export function createDefaultAnalysisInteractionUiRendererRegistry() {
  return createAnalysisInteractionUiRendererRegistry([
    { kind: 'status', render: renderStatusBlock },
    { kind: 'kv-list', render: renderKvListBlock },
    { kind: 'tool-list', render: renderToolListBlock },
    { kind: 'markdown', render: renderMarkdownBlock },
    { kind: 'table', render: renderTableBlock },
    { kind: 'chart', render: renderChartBlock },
    { kind: 'graph', render: renderGraphBlock },
    { kind: 'evidence-card', render: renderEvidenceCardBlock },
    { kind: 'timeline', render: renderTimelineBlock },
    { kind: 'approval-state', render: renderApprovalStateBlock },
    { kind: 'skills-state', render: renderSkillsStateBlock },
    { kind: 'fallback-block', render: renderFallbackBlock },
  ]);
}

let defaultAnalysisInteractionUiRendererRegistry:
  | AnalysisInteractionUiRendererRegistry
  | null = null;

export function getDefaultAnalysisInteractionUiRendererRegistry() {
  if (!defaultAnalysisInteractionUiRendererRegistry) {
    defaultAnalysisInteractionUiRendererRegistry =
      createDefaultAnalysisInteractionUiRendererRegistry();
  }

  return defaultAnalysisInteractionUiRendererRegistry;
}
