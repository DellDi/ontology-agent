'use client';

import { formatShanghaiDateTime } from '@/lib/format-datetime';
import type { AnalysisRenderedBlock } from '@/application/analysis-interaction';

import { EmptyState } from '@/app/_components/empty-state';
import { cn } from '@/app/_lib/cn';
import type { ResultDrilldownActions } from '../result-drilldown';

type DataTableBlockProps = {
  block: AnalysisRenderedBlock;
  className?: string;
  /** 嵌套在对话气泡内时置 true：去外层卡片边框与阴影，仅保留表格内容。 */
  flat?: boolean;
  drilldown?: ResultDrilldownActions;
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

export function DataTableBlock({ block, className, flat = false, drilldown }: DataTableBlockProps) {
  const { columns, rows } = extractTableData(block);
  const identifierColumns = new Set(
    Array.isArray(block.payload.identifierColumns) ? block.payload.identifierColumns : [],
  );
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
            : 'py-4',
          className,
        )}
      >
        {title ? (
          <p className="mb-3 text-sm font-medium text-foreground">
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
          : 'py-2',
        className,
      )}
    >
      {title ? (
        <h4 className="mb-3 text-sm font-medium text-foreground">
          {title}
        </h4>
      ) : null}
      {typeof block.payload.presentationReason === 'string' ? (
        <p className={cn('mb-3 text-xs leading-5 text-muted-foreground', !flat && 'pt-2')}>
          {block.payload.presentationReason}
        </p>
      ) : null}
      <div className="overflow-x-auto" role="region" aria-label={`${title ?? '分析结果'}表格，可横向滚动`} tabIndex={0}>
        <table className="min-w-full border-separate border-spacing-y-1 text-left text-sm text-foreground">
          <thead className="sticky top-0 bg-card">
            <tr>
              {columns.map((column, index) => (
                <th
                  key={`${column}-${index}`}
                  className={cn(
                    'min-w-32 whitespace-nowrap px-4 py-2.5 text-xs font-semibold tracking-[0.05em] uppercase text-muted-foreground',
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
                className="transition-colors hover:bg-secondary/40"
              >
                {row.map((cell, cellIndex) => {
                  const displayValue = formatCellValue(cell);
                  const isDate = displayValue !== cell.trim() && cell.trim() !== '';
                  return (
                    <td
                      key={`${rowIndex}-${cellIndex}`}
                      className={cn(
                        'min-w-32 px-4 py-2.5 align-top',
                        isLikelyNumber(cell)
                          ? 'text-right font-mono text-sm tabular-nums'
                          : 'text-left',
                        isDate && 'text-muted-foreground',
                        'break-words whitespace-pre-wrap',
                      )}
                    >
                      {identifierColumns.has(cellIndex) ? (
                        <details className="text-xs text-muted-foreground">
                          <summary className="cursor-pointer">数据出处</summary>
                          <span className="mt-2 block break-all font-mono">{displayValue}</span>
                        </details>
                      ) : drilldown?.has(rowIndex, cellIndex) ? <button type="button"
                        aria-label={`查看第 ${rowIndex + 1} 行${columns[cellIndex]}的当前匹配对象`}
                        onClick={() => drilldown.open(rowIndex, cellIndex)}
                        className="cursor-pointer text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {displayValue}<span className="ml-1 text-xs">↗</span>
                      </button> : displayValue.length > 80 ? (
                        <details>
                          <summary className="list-none cursor-pointer">
                            <span className="line-clamp-2">{displayValue}</span>
                            <span className="mt-1 block text-xs text-primary">查看全文</span>
                          </summary>
                          <p className="mt-2 whitespace-pre-wrap">{displayValue}</p>
                        </details>
                      ) : displayValue}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {drilldown?.reason ? <p className="mt-2 text-xs text-muted-foreground">{drilldown.reason}</p> : null}
    </div>
  );
}
