'use client';

import type { AnalysisRenderedBlock } from '@/application/analysis-interaction';

type AnalysisInteractionRenderedBlockProps = {
  renderedBlock: AnalysisRenderedBlock;
  className?: string;
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

export function AnalysisInteractionRenderedBlock({
  renderedBlock,
  className = '',
}: AnalysisInteractionRenderedBlockProps) {
  const block = renderedBlock;
  const wrapperClassName = `${className} rounded-2xl bg-[color:var(--sky-50)]/80 p-4`;

  if (block.kind === 'status') {
    return (
      <div className={`${className} rounded-2xl p-4 ${getToneClassName(block.payload.tone)}`}>
        {renderTitle(block)}
        <p className="mt-2 text-sm font-medium text-[color:var(--ink-900)]">
          {getString(block.payload.value)}
        </p>
      </div>
    );
  }

  if (block.kind === 'kv-list') {
    const items = getItems(block.payload.items);
    return (
      <div className={wrapperClassName}>
        {renderTitle(block)}
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

  if (block.kind === 'tool-list') {
    const items = getItems(block.payload.items);
    return (
      <div className={wrapperClassName}>
        {renderTitle(block, '工具调用')}
        <ul className="mt-3 space-y-2 text-sm text-[color:var(--ink-900)]">
          {items.map((item) => (
            <li key={`${getString(item.toolName)}-${getString(item.objective)}`}>
              {getString(item.toolName)} · {getString(item.objective)} ·{' '}
              {getString(item.status)}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (block.kind === 'markdown') {
    return (
      <div className={wrapperClassName}>
        {renderTitle(block.title === '阶段说明' ? { ...block, title: '推理摘要' } : block)}
        <p className="mt-2 text-sm leading-7 text-[color:var(--ink-600)]">
          {getString(block.payload.content)}
        </p>
      </div>
    );
  }

  if (block.kind === 'table') {
    return (
      <div className={wrapperClassName}>
        {renderTitle(block)}
        {renderTable(block)}
      </div>
    );
  }

  if (block.kind === 'chart') {
    return (
      <div className={wrapperClassName}>
        {renderTitle(block)}
        {renderChart(block)}
      </div>
    );
  }

  if (block.kind === 'graph') {
    return (
      <div className={wrapperClassName}>
        {renderTitle(block)}
        {renderGraph(block)}
      </div>
    );
  }

  if (block.kind === 'evidence-card') {
    const evidence = getItems(block.payload.evidence);
    return (
      <div className={wrapperClassName}>
        {renderTitle(block)}
        <p className="mt-2 text-sm leading-7 text-[color:var(--ink-700)]">
          {getString(block.payload.summary)}
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

  if (block.kind === 'timeline') {
    const items = getItems(block.payload.items);
    return (
      <div className={wrapperClassName}>
        {renderTitle(block)}
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

  if (block.kind === 'approval-state') {
    return (
      <div className={wrapperClassName}>
        {renderTitle(block)}
        <p className="mt-2 text-sm font-medium text-[color:var(--ink-900)]">
          {getString(block.payload.state)}
          {block.payload.owner ? ` · ${String(block.payload.owner)}` : ''}
        </p>
        {block.payload.reason ? (
          <p className="mt-2 text-sm text-[color:var(--ink-600)]">
            {String(block.payload.reason)}
          </p>
        ) : null}
      </div>
    );
  }

  if (block.kind === 'skills-state') {
    const items = getItems(block.payload.items);
    return (
      <div className={wrapperClassName}>
        {renderTitle(block)}
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

  return (
    <div className={`${className} rounded-2xl border border-amber-100 bg-amber-50/80 p-4`}>
      {renderTitle(block, 'Fallback')}
      <p className="mt-2 text-sm leading-7 text-amber-900">
        未支持的分析块：{getString(block.payload.originalKind, block.kind)}
      </p>
      <p className="mt-1 text-xs text-amber-700">
        {getString(block.payload.reason, 'renderer fallback')}
      </p>
    </div>
  );
}
