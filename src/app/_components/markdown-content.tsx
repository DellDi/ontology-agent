'use client';

import { Info } from 'lucide-react';
import { Streamdown } from 'streamdown';
import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useMemo,
  type ReactElement,
  type ReactNode,
} from 'react';

export type MarkdownContentProps = {
  children: string;
  className?: string;
  /** 流式渲染中：启用增量 markdown 解析与动画光标。 */
  streaming?: boolean;
};

/** 提取 React 子节点的纯文本（用于表格列对齐、指标高亮与提示段落识别）。 */
function nodeText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return nodeText(node.props.children);
  }
  return '';
}

function isNumericText(text: string): boolean {
  return /^-?\d+(\.\d+)?%?$/.test(text.trim());
}

function isNumericCell(node: ReactNode): boolean {
  return isNumericText(nodeText(node));
}

/** 识别适合轻高亮的短数值/占比/耗时表达（如 88.89%、100%、33,245 毫秒、0 条）。 */
function isHighlightedMetric(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 22) return false;
  return /^(?:约\s*)?-?\d[\d,]*(?:\.\d+)?\s*(?:%|毫秒|秒|分钟|小时|天|条|次|个|位|项|张|份|元|万元|亿元|倍)$/.test(
    trimmed,
  );
}

/** 识别数据口径/覆盖/风险提示类段落，提升为温和的 Callout 信息块。 */
function isNoticeParagraph(text: string): boolean {
  const trimmed = text.trim();
  return /^(?:数据覆盖提示|覆盖提示|覆盖范围提示|口径说明|风险提示|注意事项|特别说明|提示|注意)\s*[：:]/.test(
    trimmed,
  );
}

/** 表格列对齐约定：文本列左对齐、数值列右对齐，表头跟随本列（与结构化 data-table 同规则）。 */
const TableNumericColumnsContext = createContext<readonly boolean[] | null>(null);

type TableCellProps = { children?: ReactNode; columnIndex?: number };

function cellAlignment(numeric: boolean, extra: string): string {
  return `${extra} ${numeric ? 'text-right tabular-nums' : 'text-left'}`;
}

function MdTbody({ children }: { children?: ReactNode }) {
  return <tbody className="divide-y divide-border/60 bg-card">{children}</tbody>;
}

function MdTable({ children }: { children?: ReactNode }) {
  const numericColumns = useMemo(() => {
    const rows: string[][] = [];
    Children.forEach(children, (section) => {
      if (!isValidElement<{ children?: ReactNode }>(section) || section.type !== MdTbody) {
        return;
      }
      Children.forEach(section.props.children, (row) => {
        if (!isValidElement<{ children?: ReactNode }>(row)) return;
        rows.push(Children.toArray(row.props.children).map(nodeText));
      });
    });
    const columnCount = Math.max(0, ...rows.map((row) => row.length));
    return Array.from({ length: columnCount }, (_, columnIndex) => {
      const cells = rows
        .map((row) => row[columnIndex])
        .filter((cell): cell is string => typeof cell === 'string' && cell.trim() !== '');
      return cells.length > 0 && cells.filter(isNumericText).length * 2 >= cells.length;
    });
  }, [children]);
  return (
    <TableNumericColumnsContext.Provider value={numericColumns}>
      <div className="my-4 overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-panel)] last:mb-0">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">{children}</table>
        </div>
      </div>
    </TableNumericColumnsContext.Provider>
  );
}

function MdTr({ children }: { children?: ReactNode }) {
  const cells = Children.toArray(children)
    .filter(isValidElement<TableCellProps>)
    .map((cell, columnIndex) =>
      cloneElement(cell as ReactElement<TableCellProps>, { columnIndex }),
    );
  return <tr className="transition-colors hover:bg-sky-50/75">{cells}</tr>;
}

function MdTh({ children, columnIndex }: TableCellProps) {
  const numericColumns = useContext(TableNumericColumnsContext);
  const numeric =
    columnIndex != null && numericColumns?.[columnIndex] === true;
  return (
    <th
      className={cellAlignment(
        numeric,
        'whitespace-nowrap px-4 py-2.5 text-xs font-medium text-muted-foreground',
      )}
    >
      {children}
    </th>
  );
}

function MdTd({ children, columnIndex }: TableCellProps) {
  const numericColumns = useContext(TableNumericColumnsContext);
  const numeric =
    columnIndex != null && numericColumns != null
      ? numericColumns[columnIndex] === true
      : isNumericCell(children);
  return (
    <td
      className={cellAlignment(
        numeric,
        'px-4 py-2.5 align-top text-foreground/90',
      )}
    >
      {children}
    </td>
  );
}

type MdElementProps = { children?: ReactNode; className?: string };

const markdownComponents = {
  h1: ({ children }: MdElementProps) => (
    <h1 className="mb-3.5 mt-7 border-b border-border/60 pb-2 text-[20px] font-semibold tracking-tight text-foreground first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }: MdElementProps) => (
    <h2 className="mb-3 mt-7 flex items-center gap-2 text-[17px] font-semibold tracking-tight text-foreground first:mt-0 before:inline-block before:h-4 before:w-1 before:shrink-0 before:rounded-full before:bg-primary/75 before:content-['']">
      {children}
    </h2>
  ),
  h3: ({ children }: MdElementProps) => (
    <h3 className="mb-2.5 mt-5 text-[15.5px] font-semibold text-foreground first:mt-0">
      {children}
    </h3>
  ),
  h4: ({ children }: MdElementProps) => (
    <h4 className="mb-2 mt-4 text-[14.5px] font-semibold text-foreground first:mt-0">
      {children}
    </h4>
  ),
  p: ({ children }: MdElementProps) => {
    const plain = nodeText(children);
    if (isNoticeParagraph(plain)) {
      return (
        <div
          className="my-4 flex items-start gap-2.5 rounded-xl border border-[var(--warning-border)] bg-[var(--warning-soft)] px-4 py-3 text-[13.5px] leading-relaxed text-[var(--warning-ink)] last:mb-0"
          role="note"
        >
          <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-[var(--warning-500)]" />
          <p className="min-w-0 flex-1">{children}</p>
        </div>
      );
    }
    return (
      <p className="mb-3.5 text-[15px] leading-[1.78] text-foreground/90 tabular-nums last:mb-0">
        {children}
      </p>
    );
  },
  ul: ({ children }: MdElementProps) => (
    <ul className="mb-4 list-disc space-y-2 pl-5 text-[15px] text-foreground/90 marker:text-primary/65 last:mb-0">
      {children}
    </ul>
  ),
  ol: ({ children }: MdElementProps) => (
    <ol className="mb-4 list-decimal space-y-2 pl-5 text-[15px] text-foreground/90 marker:font-medium marker:text-primary/80 last:mb-0">
      {children}
    </ol>
  ),
  li: ({ children }: MdElementProps) => (
    <li className="pl-0.5 leading-[1.75] tabular-nums">{children}</li>
  ),
  a: ({ href, children }: { href?: string; children?: ReactNode }) => (
    <a
      href={href}
      className="font-medium text-primary underline decoration-primary/40 underline-offset-4 transition-colors hover:text-primary/80 hover:decoration-primary"
      rel="noopener noreferrer"
      target="_blank"
    >
      {children}
    </a>
  ),
  strong: ({ children }: MdElementProps) => {
    const text = nodeText(children);
    if (isHighlightedMetric(text)) {
      return (
        <strong className="mx-0.5 inline-block rounded-md bg-[var(--brand-soft)] px-1.5 py-0.5 text-[0.94em] font-semibold leading-snug tabular-nums text-[var(--brand-900)]">
          {children}
        </strong>
      );
    }
    return <strong className="font-semibold text-foreground">{children}</strong>;
  },
  em: ({ children }: MdElementProps) => (
    <em className="italic text-foreground/85">{children}</em>
  ),
  code: ({ children, className }: MdElementProps) => {
    const isInline = !className?.includes('language-');
    if (isInline) {
      return (
        <code className="rounded-md border border-border/70 bg-sky-50 px-1.5 py-0.5 font-mono text-[0.88em] text-foreground">
          {children}
        </code>
      );
    }
    return (
      <code className="font-mono text-[13.5px] leading-relaxed text-foreground/90">
        {children}
      </code>
    );
  },
  pre: ({ children }: MdElementProps) => (
    <pre className="my-4 overflow-x-auto rounded-xl border border-border bg-sky-50 p-4 text-[13.5px] last:mb-0">
      {children}
    </pre>
  ),
  blockquote: ({ children }: MdElementProps) => (
    <blockquote className="my-4 rounded-xl border border-[var(--brand-300)]/35 border-l-[3px] border-l-primary bg-[var(--brand-soft)] px-4 py-3 text-[14px] leading-relaxed text-foreground/85 last:mb-0">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-6 border-0 border-t border-border/75" />,
  table: MdTable,
  thead: ({ children }: MdElementProps) => (
    <thead className="border-b border-border bg-sky-50 text-muted-foreground">
      {children}
    </thead>
  ),
  tbody: MdTbody,
  th: MdTh,
  td: MdTd,
  tr: MdTr,
};

export function MarkdownContent({ children, className = '', streaming = false }: MarkdownContentProps) {
  return (
    <div className={className}>
      <Streamdown
        caret={streaming ? 'block' : undefined}
        components={markdownComponents}
        isAnimating={streaming}
        mode={streaming ? 'streaming' : 'static'}
      >
        {children}
      </Streamdown>
    </div>
  );
}
