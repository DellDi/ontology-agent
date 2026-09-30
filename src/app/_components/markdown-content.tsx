'use client';

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

/** 提取 React 子节点的纯文本（用于表格单元格的数值对齐判断）。 */
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

/** 表格列对齐约定：文本列左对齐、数值列右对齐，表头跟随本列（与结构化 data-table 同规则）。 */
const TableNumericColumnsContext = createContext<readonly boolean[] | null>(null);

type TableCellProps = { children?: ReactNode; columnIndex?: number };

function cellAlignment(numeric: boolean, extra: string): string {
  return `${extra} ${numeric ? 'text-right tabular-nums' : 'text-left'}`;
}

function MdTbody({ children }: { children?: ReactNode }) {
  return <tbody>{children}</tbody>;
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
      <div className="mb-3 overflow-x-auto last:mb-0">
        <table className="w-full border-collapse text-sm">{children}</table>
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
  return <tr className="transition-colors hover:bg-muted/50">{cells}</tr>;
}

function MdTh({ children, columnIndex }: TableCellProps) {
  const numericColumns = useContext(TableNumericColumnsContext);
  const numeric =
    columnIndex != null && numericColumns?.[columnIndex] === true;
  return (
    <th className={cellAlignment(numeric, 'px-3 py-2 font-semibold text-foreground')}>
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
    <td className={cellAlignment(numeric, 'border-b border-border px-3 py-2 text-foreground/90')}>
      {children}
    </td>
  );
}

type MdElementProps = { children?: ReactNode; className?: string };

const markdownComponents = {
  h1: ({ children }: MdElementProps) => (
    <h1 className="mb-4 mt-6 text-xl font-semibold tracking-tight text-foreground first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }: MdElementProps) => (
    <h2 className="mb-3 mt-5 text-lg font-semibold tracking-tight text-foreground">
      {children}
    </h2>
  ),
  h3: ({ children }: MdElementProps) => (
    <h3 className="mb-2 mt-4 text-base font-semibold text-foreground">{children}</h3>
  ),
  h4: ({ children }: MdElementProps) => (
    <h4 className="mb-2 mt-3 text-sm font-semibold text-foreground">{children}</h4>
  ),
  p: ({ children }: MdElementProps) => (
    <p className="mb-3 text-sm leading-7 text-foreground/90 last:mb-0">{children}</p>
  ),
  ul: ({ children }: MdElementProps) => (
    <ul className="mb-3 list-disc space-y-1 pl-5 text-sm text-foreground/90 last:mb-0">
      {children}
    </ul>
  ),
  ol: ({ children }: MdElementProps) => (
    <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-foreground/90 last:mb-0">
      {children}
    </ol>
  ),
  li: ({ children }: MdElementProps) => (
    <li className="leading-7">{children}</li>
  ),
  a: ({ href, children }: { href?: string; children?: ReactNode }) => (
    <a
      href={href}
      className="font-medium text-primary underline underline-offset-4 hover:text-primary/80"
      rel="noopener noreferrer"
      target="_blank"
    >
      {children}
    </a>
  ),
  strong: ({ children }: MdElementProps) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  em: ({ children }: MdElementProps) => (
    <em className="italic text-foreground/90">{children}</em>
  ),
  code: ({ children, className }: MdElementProps) => {
    const isInline = !className?.includes('language-');
    if (isInline) {
      return (
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm text-foreground/90">
          {children}
        </code>
      );
    }
    return (
      <code className="font-mono text-sm text-foreground/90">{children}</code>
    );
  },
  pre: ({ children }: MdElementProps) => (
    <pre className="mb-3 overflow-x-auto rounded-lg border border-border bg-muted p-4 text-sm last:mb-0">
      {children}
    </pre>
  ),
  blockquote: ({ children }: MdElementProps) => (
    <blockquote className="mb-3 border-l-4 border-primary/30 pl-4 text-sm italic text-muted-foreground last:mb-0">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-6 border-border" />,
  table: MdTable,
  thead: ({ children }: MdElementProps) => (
    <thead className="border-b border-border bg-muted">{children}</thead>
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
