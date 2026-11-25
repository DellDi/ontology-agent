'use client';

import { useState } from 'react';
import { Check, Copy, LayoutGrid, Table2 } from 'lucide-react';
import { formatShanghaiDateTime } from '@/lib/format-datetime';
import type { AnalysisRenderedBlock } from '@/application/analysis-interaction';

import { EmptyState } from '@/app/_components/empty-state';
import { cn } from '@/app/_lib/cn';
import type { ResultDrilldownActions } from '../result-drilldown';

type DataTableBlockProps = {
  block: AnalysisRenderedBlock;
  className?: string;
  /** 嵌套在对话气泡内时置 true；仍保留清晰表格/指标卡边界，避免与画布融成一体。 */
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

/** 识别“单行多指标汇总表”，默认渲染为紧凑的分组 KPI 指标条，可一键切回原表格。 */
function isSingleRowMetricStrip(
  columns: string[],
  rows: string[][],
  identifierColumns: Set<number>,
): boolean {
  if (rows.length !== 1 || columns.length < 2 || identifierColumns.size > 0) {
    return false;
  }
  const row = rows[0];
  if (!row || row.length !== columns.length) return false;
  const numericCount = row.filter((cell) => isLikelyNumber(cell)).length;
  const allCompact = row.every((cell) => cell.trim().length <= 28);
  return numericCount >= 2 && allCompact;
}

/** 若标题为「对象名 · 列1、列2、列3」冗长串，在指标条头部提取简洁的对象名。 */
function formatStripHeading(title: string | null): { heading: string | null; fullTitle: string | null } {
  if (!title) return { heading: null, fullTitle: null };
  const sepIndex = title.indexOf(' · ');
  if (sepIndex > 0 && title.length > 26) {
    return {
      heading: title.slice(0, sepIndex),
      fullTitle: title,
    };
  }
  return { heading: title, fullTitle: title };
}

/** 提取百分比数值（支持列名含 % / （%）或值以 % 结尾），供细进度条展示。 */
function parsePercentageMetric(column: string, rawCell: string): { percent: number; isFailure: boolean } | null {
  const trimmed = rawCell.trim();
  const isPercentColumn = /[（(]%[）)]|%|率/.test(column);
  if (!isPercentColumn && !trimmed.endsWith('%')) return null;
  const numeric = Number(trimmed.replace(/%$/, ''));
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) return null;
  const isFailure = /失败|异常|错误|流失/.test(column);
  return { percent: numeric, isFailure };
}

function formatTsv(columns: string[], rows: string[][]): string {
  const header = columns.join('\t');
  const body = rows.map((row) => row.map((cell) => formatCellValue(cell)).join('\t'));
  return [header, ...body].join('\n');
}

export function DataTableBlock({ block, className, flat = false, drilldown }: DataTableBlockProps) {
  const { columns, rows } = extractTableData(block);
  const identifierColumns = new Set<number>(
    Array.isArray(block.payload.identifierColumns)
      ? block.payload.identifierColumns.filter((value): value is number => typeof value === 'number')
      : [],
  );
  const title =
    typeof block.title === 'string' && block.title.trim().length > 0
      ? block.title
      : null;

  const canRenderStrip = isSingleRowMetricStrip(columns, rows, identifierColumns);
  const [viewMode, setViewMode] = useState<'strip' | 'table'>('strip');
  const [copied, setCopied] = useState(false);

  const showStrip = canRenderStrip && viewMode === 'strip';

  // 列对齐统一标准：文本列左对齐、数值列右对齐，表头跟随本列对齐
  const numericColumns = columns.map((_, columnIndex) => {
    const cells = rows
      .map((row) => row[columnIndex])
      .filter((cell): cell is string => typeof cell === 'string' && cell.trim() !== '');
    if (cells.length === 0) return false;
    const numericCount = cells.filter((cell) => isLikelyNumber(cell)).length;
    return numericCount * 2 >= cells.length;
  });

  const handleCopy = () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    void navigator.clipboard.writeText(formatTsv(columns, rows)).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });
  };

  if (columns.length === 0 && rows.length === 0) {
    return (
      <div
        className={cn(
          'rounded-xl border border-border bg-sky-50/50 p-4',
          className,
        )}
      >
        {title ? (
          <p className="mb-3 text-sm font-semibold text-foreground">
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

  const { heading: stripHeading, fullTitle } = formatStripHeading(title);
  const presentationReason =
    typeof block.payload.presentationReason === 'string'
      ? block.payload.presentationReason
      : null;

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-panel)]',
        !flat && 'my-2',
        className,
      )}
    >
      {/* 标题与工具栏：展示清晰的区块身份，提供指标/表格切换与复制 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/75 bg-sky-50/80 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          {title ? (
            <h4
              className="truncate text-[13.5px] font-semibold text-foreground"
              title={fullTitle ?? undefined}
            >
              {showStrip ? stripHeading : title}
            </h4>
          ) : (
            <h4 className="text-[13.5px] font-semibold text-foreground">数据结果</h4>
          )}
          {showStrip ? (
            <span className="shrink-0 rounded-full bg-card px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground ring-1 ring-border/70">
              {columns.length} 项指标
            </span>
          ) : rows.length > 1 ? (
            <span className="shrink-0 rounded-full bg-card px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground ring-1 ring-border/70">
              {rows.length} 行
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {canRenderStrip ? (
            <button
              type="button"
              onClick={() => setViewMode(showStrip ? 'table' : 'strip')}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title={showStrip ? '切换为表格视图' : '切换为指标卡视图'}
            >
              {showStrip ? (
                <>
                  <Table2 aria-hidden className="size-3.5" />
                  <span>表格</span>
                </>
              ) : (
                <>
                  <LayoutGrid aria-hidden className="size-3.5" />
                  <span>指标</span>
                </>
              )}
            </button>
          ) : null}
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title="复制为制表符数据（可直接粘贴到表格）"
          >
            {copied ? (
              <>
                <Check aria-hidden className="size-3.5 text-[var(--success-500)]" />
                <span className="text-[var(--success-ink)]">已复制</span>
              </>
            ) : (
              <>
                <Copy aria-hidden className="size-3.5" />
                <span>复制</span>
              </>
            )}
          </button>
        </div>
      </div>

      {presentationReason ? (
        <p className="border-b border-border/60 bg-sky-50/40 px-4 py-2 text-xs leading-5 text-muted-foreground">
          {presentationReason}
        </p>
      ) : null}

      {showStrip ? (
        <dl
          className={cn(
            'grid gap-px bg-border/60',
            columns.length === 2
              ? 'grid-cols-2'
              : columns.length === 3
                ? 'grid-cols-2 sm:grid-cols-3'
                : columns.length === 4
                  ? 'grid-cols-2 sm:grid-cols-4'
                  : 'grid-cols-2 sm:grid-cols-3',
          )}
        >
          {columns.map((column, cellIndex) => {
            const rawCell = rows[0]?.[cellIndex] ?? '';
            const displayValue = formatCellValue(rawCell);
            const isEmpty = displayValue === '—';
            const percentInfo = !isEmpty ? parsePercentageMetric(column, rawCell) : null;
            const barTone = percentInfo
              ? percentInfo.isFailure
                ? percentInfo.percent > 0
                  ? 'bg-[var(--danger-500)]'
                  : 'bg-[var(--success-500)]/70'
                : percentInfo.percent >= 90
                  ? 'bg-[var(--success-500)]'
                  : percentInfo.percent >= 70
                    ? 'bg-primary'
                    : 'bg-[var(--warning-500)]'
              : null;

            return (
              <div
                key={`${column}-${cellIndex}`}
                className="flex flex-col justify-between bg-card px-4 py-3.5 transition-colors hover:bg-sky-50/50"
              >
                <dt className="text-xs font-medium leading-snug text-muted-foreground">
                  {column}
                </dt>
                <dd className="mt-2">
                  <div
                    className={cn(
                      'text-[20px] font-semibold leading-tight tracking-tight tabular-nums',
                      isEmpty ? 'text-muted-foreground/60' : 'text-foreground',
                    )}
                  >
                    {drilldown?.has(0, cellIndex) ? (
                      <button
                        type="button"
                        aria-label={`查看第 1 行${column}的当前匹配对象`}
                        onClick={() => drilldown.open(0, cellIndex)}
                        className="cursor-pointer text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {displayValue}
                        <span className="ml-1 text-xs font-normal">↗</span>
                      </button>
                    ) : (
                      <>
                        {displayValue}
                        {percentInfo && !displayValue.endsWith('%') && !/[（(]%[）)]/.test(column) ? (
                          <span className="ml-0.5 text-sm font-normal text-muted-foreground">%</span>
                        ) : null}
                      </>
                    )}
                  </div>
                  {percentInfo && barTone ? (
                    <div
                      aria-hidden
                      className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-sky-100"
                    >
                      <div
                        className={cn('h-full rounded-full transition-[width] duration-300', barTone)}
                        style={{ width: `${Math.max(percentInfo.percent, percentInfo.percent > 0 ? 4 : 0)}%` }}
                      />
                    </div>
                  ) : null}
                </dd>
              </div>
            );
          })}
        </dl>
      ) : (
        <div
          className="overflow-x-auto"
          role="region"
          aria-label={`${title ?? '分析结果'}表格，可横向滚动`}
          tabIndex={0}
        >
          <table className="min-w-full border-collapse text-left text-sm text-foreground">
            <thead className="sticky top-0 border-b border-border bg-sky-50/75">
              <tr>
                {columns.map((column, index) => (
                  <th
                    key={`${column}-${index}`}
                    className={cn(
                      'min-w-[6.5rem] whitespace-nowrap px-4 py-2.5 text-xs font-medium text-muted-foreground',
                      numericColumns[index] ? 'text-right' : 'text-left',
                    )}
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 bg-card">
              {rows.map((row, rowIndex) => (
                <tr
                  key={`${block.source.eventId ?? block.source.sourceType}-row-${rowIndex}`}
                  className="transition-colors hover:bg-sky-50/70"
                >
                  {row.map((cell, cellIndex) => {
                    const displayValue = formatCellValue(cell);
                    const isDate = displayValue !== cell.trim() && cell.trim() !== '';
                    return (
                      <td
                        key={`${rowIndex}-${cellIndex}`}
                        className={cn(
                          'min-w-[6.5rem] px-4 py-2.5 align-top',
                          isLikelyNumber(cell)
                            ? 'text-right font-medium tabular-nums text-foreground'
                            : 'text-left text-foreground/90',
                          isDate && 'text-muted-foreground',
                          'break-words whitespace-pre-wrap',
                        )}
                      >
                        {identifierColumns.has(cellIndex) ? (
                          <details className="text-xs text-muted-foreground">
                            <summary className="cursor-pointer">数据出处</summary>
                            <span className="mt-2 block break-all font-mono">{displayValue}</span>
                          </details>
                        ) : drilldown?.has(rowIndex, cellIndex) ? (
                          <button
                            type="button"
                            aria-label={`查看第 ${rowIndex + 1} 行${columns[cellIndex]}的当前匹配对象`}
                            onClick={() => drilldown.open(rowIndex, cellIndex)}
                            className="cursor-pointer text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {displayValue}
                            <span className="ml-1 text-xs">↗</span>
                          </button>
                        ) : displayValue.length > 80 ? (
                          <details>
                            <summary className="list-none cursor-pointer">
                              <span className="line-clamp-2">{displayValue}</span>
                              <span className="mt-1 block text-xs text-primary">查看全文</span>
                            </summary>
                            <p className="mt-2 whitespace-pre-wrap">{displayValue}</p>
                          </details>
                        ) : (
                          displayValue
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {drilldown?.reason ? (
        <p className="border-t border-border/60 bg-sky-50/40 px-4 py-2 text-xs text-muted-foreground">
          {drilldown.reason}
        </p>
      ) : null}
    </div>
  );
}
