'use client';

import { formatShanghaiDateTime } from '@/lib/format-datetime';
import type { AnalysisRenderedBlock } from '@/application/analysis-interaction';

import { EmptyState } from '@/app/_components/workbench/empty-state';
import { cn } from '@/app/_lib/cn';

type DataTableBlockProps = {
  block: AnalysisRenderedBlock;
  className?: string;
  /** 嵌套在对话气泡内时置 true：去外层卡片边框与阴影，仅保留表格内容。 */
  flat?: boolean;
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

function isIsoDateString(text: string): boolean {
  const trimmed = text.trim();
  // ISO 8601: YYYY-MM-DDTHH:mm:ss.sssZ 或仅日期
  return /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(trimmed);
}

function formatCellValue(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '—';

  if (!isIsoDateString(trimmed)) {
    return trimmed;
  }

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    return trimmed;
  }

  // 当时间部分为 00:00:00 时只显示日期，否则显示日期+时间
  const isMidnight =
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0;

  if (isMidnight) {
    return date.toLocaleDateString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }

  return formatShanghaiDateTime(date);
}

export function DataTableBlock({ block, className, flat = false }: DataTableBlockProps) {
  const { columns, rows } = extractTableData(block);
  const title =
    typeof block.title === 'string' && block.title.trim().length > 0
      ? block.title
      : null;
  // 列对齐统一标准：文本列左对齐、数值列右对齐，表头跟随本列对齐
  const numericColumns = columns.map((_, columnIndex) => {
    const cells = rows
      .map((row) => row[columnIndex])
      .filter((cell): cell is string => typeof cell === 'string' && cell.trim() !== '');
    if (cells.length === 0) return false;
    const numericCount = cells.filter((cell) => isLikelyNumber(cell)).length;
    return numericCount * 2 >= cells.length;
  });

  if (columns.length === 0 && rows.length === 0) {
    return (
      <div
        className={cn(
          flat
            ? 'p-0'
            : 'rounded-md border border-border bg-card p-4 shadow-[var(--shadow-panel)]',
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
        flat
          ? ''
          : 'rounded-md border border-border bg-card shadow-[var(--shadow-panel)]',
        className,
      )}
    >
      {title ? (
        <p
          className={cn(
            'text-xs font-semibold tracking-[0.12em] uppercase text-muted-foreground',
            flat ? 'mb-2' : 'px-4 pt-3',
          )}
        >
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
                  className={cn(
                    'px-4 py-2.5 text-xs font-semibold tracking-[0.05em] uppercase text-muted-foreground',
                    numericColumns[index] ? 'text-right' : 'text-left',
                  )}
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
                {row.map((cell, cellIndex) => {
                  const displayValue = formatCellValue(cell);
                  const isDate = displayValue !== cell.trim() && cell.trim() !== '';
                  return (
                    <td
                      key={`${rowIndex}-${cellIndex}`}
                      className={cn(
                        'px-4 py-2.5 align-top',
                        isLikelyNumber(cell)
                          ? 'text-right font-mono text-sm tabular-nums'
                          : 'text-left',
                        isDate && 'text-muted-foreground',
                        'break-words whitespace-pre-wrap',
                      )}
                    >
                      {displayValue}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
