'use client';

import type { AnalysisRenderedBlock } from '@/application/analysis-interaction';

import { getString, getItems } from './rendering-utils';

export function renderTable(block: AnalysisRenderedBlock) {
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

export function renderChart(block: AnalysisRenderedBlock) {
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

import type { AnalysisInteractionUiRenderInput } from '../analysis-interaction-ui-renderer-registry';

import { renderTitle } from './rendering-utils';

export function renderTableBlock({ renderedBlock, className = '' }: AnalysisInteractionUiRenderInput) {
  return (
    <div className={`${className} rounded-2xl bg-[color:var(--sky-50)]/80 p-4`}>
      {renderTitle(renderedBlock)}
      {renderTable(renderedBlock)}
    </div>
  );
}

export function renderChartBlock({ renderedBlock, className = '' }: AnalysisInteractionUiRenderInput) {
  return (
    <div className={`${className} rounded-2xl bg-[color:var(--sky-50)]/80 p-4`}>
      {renderTitle(renderedBlock)}
      {renderChart(renderedBlock)}
    </div>
  );
}

export function renderGraphBlock({ renderedBlock, className = '' }: AnalysisInteractionUiRenderInput) {
  return (
    <div className={`${className} rounded-2xl bg-[color:var(--sky-50)]/80 p-4`}>
      {renderTitle(renderedBlock)}
      {renderGraph(renderedBlock)}
    </div>
  );
}

export function renderGraph(block: AnalysisRenderedBlock) {
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