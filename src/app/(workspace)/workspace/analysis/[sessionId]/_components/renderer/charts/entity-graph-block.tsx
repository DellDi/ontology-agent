'use client';

import type { AnalysisRenderedBlock } from '@/application/analysis-interaction';

import { Badge } from '@/app/_components/workbench/badge';
import { EmptyState } from '@/app/_components/workbench/empty-state';

import { asItemArray } from './recharts-shared';

type EntityGraphBlockProps = {
  block: AnalysisRenderedBlock;
};

/**
 * 简化图渲染：
 *   - recharts 没有图论组件；引入完整图库（cytoscape/visx）成本与本期收益不匹配，
 *     这里仍以"节点 + 关系列表"展示，但显著强化视觉层级与异常态。
 *   - 后续若必须二维布局，可在保持本组件接口不变的前提下替换为 cytoscape。
 */
export function EntityGraphBlock({ block }: EntityGraphBlockProps) {
  const nodes = asItemArray(block.payload.nodes);
  const edges = asItemArray(block.payload.edges);
  const title =
    typeof block.title === 'string' && block.title.trim().length > 0
      ? block.title
      : '关系图';

  if (nodes.length === 0 && edges.length === 0) {
    return (
      <div className="rounded-md border border-border bg-card p-4 shadow-[var(--shadow-panel)]">
        <p className="mb-3 text-xs font-semibold tracking-[0.12em] uppercase text-muted-foreground">
          {title}
        </p>
        <EmptyState
          title="暂无关系图数据"
          description="本步骤未返回节点或关系，或上下文已被截断。"
        />
      </div>
    );
  }

  return (
    <section className="rounded-md border border-border bg-card p-4 shadow-[var(--shadow-panel)]">
      <header className="space-y-1">
        <p className="text-xs font-semibold tracking-[0.12em] uppercase text-muted-foreground">
          {title}
        </p>
        <p className="text-xs text-muted-foreground">
          {nodes.length} 个节点 · {edges.length} 条关系
        </p>
      </header>

      {nodes.length > 0 ? (
        <div className="mt-3">
          <p className="text-xs font-semibold text-muted-foreground">节点</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {nodes.map((node, index) => {
              const label =
                typeof node.label === 'string'
                  ? node.label
                  : String(node.id ?? `节点 ${index + 1}`);
              return (
                <Badge tone="info" key={`${label}-${index}`}>
                  {label}
                </Badge>
              );
            })}
          </div>
        </div>
      ) : null}

      {edges.length > 0 ? (
        <div className="mt-4">
          <p className="text-xs font-semibold text-muted-foreground">关系</p>
          <ul className="mt-2 space-y-1.5 text-sm text-foreground">
            {edges.map((edge, index) => {
              const source = String(edge.source ?? '?');
              const target = String(edge.target ?? '?');
              const label =
                typeof edge.label === 'string' ? edge.label : null;
              return (
                <li
                  key={`${source}-${target}-${index}`}
                  className="flex flex-wrap items-center gap-1.5 break-words text-sm leading-6"
                >
                  <span className="font-medium text-foreground">{source}</span>
                  <span aria-hidden className="text-muted-foreground">
                    →
                  </span>
                  <span className="font-medium text-foreground">{target}</span>
                  {label ? (
                    <span className="text-xs text-muted-foreground">
                      ·{label}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
