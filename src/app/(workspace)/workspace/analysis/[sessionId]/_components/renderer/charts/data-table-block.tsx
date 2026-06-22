'use client';

import type { AnalysisRenderedBlock } from '@/application/analysis-interaction';

import { EmptyState } from '@/app/_components/workbench/empty-state';
import { cn } from '@/app/_lib/cn';

type DataTableBlockProps = {
  block: AnalysisRenderedBlock;
  className?: string;
};

function extractTableData(block: AnalysisRenderedBlock) {
  const columns = Array.isArray(block.payload.columns)
    ? block.payload.columns.map((column) => String(column))
    : [];
  const rows = Array.isArray(block.payload.rows)
    ? block.payload.rows.map((row) =>
        Array.isArray(row) ? row.map((cell) => String(cell)) : [],
      )
    : [];
  return { columns, rows };
}

function isLikelyNumber(text: string) {
  return /^-?\d+(\.\d+)?%?$/.test(text.trim());
}

export function DataTableBlock({ block, className }: DataTableBlockProps) {
  const { columns, rows } = extractTableData(block);
  const title =
    typeof block.title === 'string' && block.title.trim().length > 0
      ? block.title
      : null;

  if (columns.length === 0 && rows.length === 0) {
    return (
      <div
        className={cn(
          'rounded-md border border-border bg-card p-4 shadow-[var(--shadow-panel)]',
          className,
        )}
      >
        {title ? (
          <p className="mb-3 text-xs font-semibold tracking-[0.12em] uppercase text-muted-foreground">
            {title}
          </p>
        ) : null}
        <EmptyState
          title="暂无表格数据"
          description="本步骤未返回结构化结果，或字段已被过滤。"
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'rounded-md border border-border bg-card shadow-[var(--shadow-panel)]',
        className,
      )}
    >
      {title ? (
        <p className="px-4 pt-3 text-xs font-semibold tracking-[0.12em] uppercase text-muted-foreground">
          {title}
        </p>
      ) : null}
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm text-foreground">
          <thead className="sticky top-0 bg-secondary/40 backdrop-blur-sm">
            <tr>
              {columns.map((column, index) => (
                <th
                  key={`${column}-${index}`}
                  className="px-4 py-2.5 text-xs font-semibold tracking-[0.05em] uppercase text-muted-foreground"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr
                key={`${block.source.eventId ?? block.source.sourceType}-row-${rowIndex}`}
                className="border-t border-border/70 transition-colors hover:bg-secondary/40"
              >
                {row.map((cell, cellIndex) => (
                  <td
                    key={`${rowIndex}-${cellIndex}`}
                    className={cn(
                      'px-4 py-2.5 align-top',
                      isLikelyNumber(cell)
                        ? 'text-right font-mono text-sm tabular-nums'
                        : 'text-left',
                      'break-words whitespace-pre-wrap',
                    )}
                  >
                    {cell || '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
