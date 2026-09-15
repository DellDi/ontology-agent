'use client';

import { useMemo, useState } from 'react';

type EvidenceRef = {
  source: string;
  row: number;
  field: string;
  value: string | number | boolean;
};

type AttributionClaim = {
  kind?: string;
  text: string;
  evidenceRefs: EvidenceRef[];
};

type AttributionEvidence = {
  source: string;
  title: string;
  rowCount: number;
  ontologyVersionId: string;
  datasetVersionSetId: string;
  freshnessAt: string;
  productVersionIds: Record<string, string>;
};

type AttributionTool = {
  name: string;
  label: string;
  fact?: string;
  sql?: string;
  durationMs?: number;
  error?: string;
};

type AnchorNode = {
  id: string;
  ref: EvidenceRef;
  claimIndex: number;
};

const COL_CLAIM_X = 8;
const COL_ANCHOR_X = 218;
const COL_SOURCE_X = 452;
const NODE_W = 196;
const NODE_H = 40;
const ROW_GAP = 52;
const GRAPH_WIDTH = 660;

/** spec.fact 短名 → 冻结数据集内的产品键。 */
const FACT_PRODUCT_KEY: Record<string, string> = {
  application: 'easyv-ai-application',
  prototype: 'easyv-prototype-task',
  pipeline: 'easyv-pipeline-node',
  forge: 'easyv-forge-task',
  feedback: 'easyv-generation-feedback',
};

function shortSource(source: string) {
  return source.startsWith('easyv-query:') ? source.slice('easyv-query:'.length) : source;
}

function truncate(text: string, max = 26) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * 归因分析面板：论据血缘分层图（断言 → 证据锚点 → 证据源）+
 * 论证 SQL 最终表述（每条已执行目录查询的模板与参数）。
 * 数据全部来自已持久化的 conclusionState.claims/evidence 与执行事件 tool.sql，
 * 不经过 LLM 二次生成。
 */
export function AnalysisAttributionPanel({
  claims,
  evidence,
  tools,
  rangeLabel,
}: {
  claims: AttributionClaim[];
  evidence: AttributionEvidence[];
  tools: AttributionTool[];
  rangeLabel?: string;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [selectedAnchor, setSelectedAnchor] = useState<AnchorNode | null>(null);

  const evidenceBySource = useMemo(() => {
    const map = new Map<string, AttributionEvidence>();
    evidence.forEach((item) => map.set(item.source, item));
    return map;
  }, [evidence]);

  // 锚点去重（source+row+field+value），保留归属的 claim 序号
  const anchors = useMemo(() => {
    const seen = new Map<string, AnchorNode>();
    claims.forEach((claim, claimIndex) => {
      claim.evidenceRefs.forEach((ref) => {
        const key = `${ref.source}#${ref.row}#${ref.field}`;
        if (!seen.has(key)) {
          seen.set(key, { id: key, ref, claimIndex });
        }
      });
    });
    return Array.from(seen.values());
  }, [claims]);

  const sourceIds = useMemo(() => {
    const order = new Map<string, number>();
    anchors.forEach((anchor) => {
      if (!order.has(anchor.ref.source)) {
        order.set(anchor.ref.source, order.size);
      }
    });
    return order;
  }, [anchors]);

  const claimY = (index: number) => 12 + index * ROW_GAP;
  const anchorY = (index: number) => 12 + index * ROW_GAP;
  const sourceY = (source: string) => 12 + (sourceIds.get(source) ?? 0) * ROW_GAP;
  const graphHeight =
    Math.max(claims.length, anchors.length, sourceIds.size) * ROW_GAP + NODE_H;

  const isLinked = (a: string, b: string) =>
    hovered === null || hovered === a || hovered === b;

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-xs font-medium tracking-[0.12em] text-primary">
          论据血缘
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          结论断言 → 证据锚点（行/字段/值）→ 证据源，全部来自冻结数据集版本。
        </p>
        <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-muted/30 p-2">
          <svg
            aria-label="论据血缘关系图"
            className="block"
            height={graphHeight}
            viewBox={`0 0 ${GRAPH_WIDTH} ${graphHeight}`}
            width={GRAPH_WIDTH}
          >
            {/* 边：claim → anchor */}
            {claims.map((claim, claimIndex) =>
              claim.evidenceRefs.map((ref) => {
                const anchorIndex = anchors.findIndex(
                  (anchor) =>
                    anchor.ref.source === ref.source &&
                    anchor.ref.row === ref.row &&
                    anchor.ref.field === ref.field,
                );
                if (anchorIndex < 0) return null;
                const anchorId = anchors[anchorIndex].id;
                const x1 = COL_CLAIM_X + NODE_W;
                const y1 = claimY(claimIndex) + NODE_H / 2;
                const x2 = COL_ANCHOR_X;
                const y2 = anchorY(anchorIndex) + NODE_H / 2;
                const dim =
                  hovered !== null &&
                  hovered !== `claim-${claimIndex}` &&
                  hovered !== anchorId;
                return (
                  <path
                    d={`M ${x1} ${y1} C ${x1 + 44} ${y1}, ${x2 - 44} ${y2}, ${x2} ${y2}`}
                    fill="none"
                    key={`e-c-${claimIndex}-${anchorId}`}
                    stroke={dim ? 'var(--border)' : 'var(--primary)'}
                    strokeOpacity={dim ? 0.35 : 0.75}
                    strokeWidth={dim ? 1 : 1.5}
                  />
                );
              }),
            )}
            {/* 边：anchor → source */}
            {anchors.map((anchor, anchorIndex) => {
              const x1 = COL_ANCHOR_X + NODE_W;
              const y1 = anchorY(anchorIndex) + NODE_H / 2;
              const x2 = COL_SOURCE_X;
              const y2 = sourceY(anchor.ref.source) + NODE_H / 2;
              const dim =
                hovered !== null &&
                hovered !== anchor.id &&
                hovered !== `src-${anchor.ref.source}`;
              return (
                <path
                  d={`M ${x1} ${y1} C ${x1 + 44} ${y1}, ${x2 - 44} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  key={`e-a-${anchor.id}`}
                  stroke={dim ? 'var(--border)' : 'var(--primary)'}
                  strokeOpacity={dim ? 0.35 : 0.75}
                  strokeWidth={dim ? 1 : 1.5}
                />
              );
            })}
            {/* 节点：断言 */}
            {claims.map((claim, index) => (
              <g
                key={`claim-${index}`}
                onMouseEnter={() => setHovered(`claim-${index}`)}
                onMouseLeave={() => setHovered(null)}
                opacity={isLinked(`claim-${index}`, '') ? 1 : 0.4}
              >
                <rect
                  className="fill-primary/10 stroke-primary/40"
                  height={NODE_H}
                  rx={8}
                  width={NODE_W}
                  x={COL_CLAIM_X}
                  y={claimY(index)}
                />
                <text
                  className="fill-foreground text-[11px] font-medium"
                  x={COL_CLAIM_X + 10}
                  y={claimY(index) + 17}
                >
                  断言 {index + 1}（{claim.kind ?? 'direct-answer'}）
                </text>
                <text
                  className="fill-muted-foreground text-[10px]"
                  x={COL_CLAIM_X + 10}
                  y={claimY(index) + 32}
                >
                  {truncate(claim.text, 24)}
                </text>
              </g>
            ))}
            {/* 节点：锚点 */}
            {anchors.map((anchor, index) => (
              <g
                className="cursor-pointer"
                key={anchor.id}
                onClick={() => setSelectedAnchor(anchor)}
                onMouseEnter={() => setHovered(anchor.id)}
                onMouseLeave={() => setHovered(null)}
                opacity={isLinked(anchor.id, '') ? 1 : 0.4}
              >
                <rect
                  className="fill-card stroke-border"
                  height={NODE_H}
                  rx={8}
                  width={NODE_W}
                  x={COL_ANCHOR_X}
                  y={anchorY(index)}
                />
                <text
                  className="fill-foreground text-[11px] font-medium"
                  x={COL_ANCHOR_X + 10}
                  y={anchorY(index) + 17}
                >
                  {truncate(shortSource(anchor.ref.source), 22)}
                </text>
                <text
                  className="fill-muted-foreground text-[10px] font-mono"
                  x={COL_ANCHOR_X + 10}
                  y={anchorY(index) + 32}
                >
                  {truncate(
                    `r${anchor.ref.row}·${anchor.ref.field}=${String(anchor.ref.value)}`,
                    26,
                  )}
                </text>
              </g>
            ))}
            {/* 节点：证据源 */}
            {Array.from(sourceIds.keys()).map((source) => {
              const item = evidenceBySource.get(source);
              return (
                <g
                  key={`src-${source}`}
                  onMouseEnter={() => setHovered(`src-${source}`)}
                  onMouseLeave={() => setHovered(null)}
                  opacity={isLinked(`src-${source}`, '') ? 1 : 0.4}
                >
                  <rect
                    className="fill-secondary stroke-border"
                    height={NODE_H}
                    rx={8}
                    width={NODE_W}
                    x={COL_SOURCE_X}
                    y={sourceY(source)}
                  />
                  <text
                    className="fill-foreground text-[11px] font-medium"
                    x={COL_SOURCE_X + 10}
                    y={sourceY(source) + 17}
                  >
                    {truncate(item?.title ?? source, 22)}
                  </text>
                  <text
                    className="fill-muted-foreground text-[10px]"
                    x={COL_SOURCE_X + 10}
                    y={sourceY(source) + 32}
                  >
                    {item ? `${item.rowCount} 行` : source}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
        {selectedAnchor ? (
          <div className="mt-2 rounded-md border border-border bg-card px-3 py-2 text-xs">
            <span className="font-medium text-foreground">
              {shortSource(selectedAnchor.ref.source)}
            </span>
            <span className="ml-2 font-mono text-muted-foreground">
              行 {selectedAnchor.ref.row} · 字段 {selectedAnchor.ref.field} · 值{' '}
              {String(selectedAnchor.ref.value)}
            </span>
          </div>
        ) : null}
      </section>

      {tools.length > 0 ? (
        <section>
          <h3 className="text-xs font-medium tracking-[0.12em] text-primary">
            论证 SQL
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            每条目录查询实际执行的固定模板与绑定参数；只读事务、作用于冻结版本。
          </p>
          <div className="mt-3 space-y-3">
            {tools.map((tool) => {
              const ev = evidenceBySource.get(`easyv-query:${tool.name}`);
              return (
                <div
                  className="rounded-lg border border-border bg-card"
                  key={tool.name}
                >
                  <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
                    <span className="text-xs font-medium text-foreground">
                      {tool.label}
                    </span>
                    {tool.fact ? (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {tool.fact}
                      </span>
                    ) : null}
                    {typeof tool.durationMs === 'number' ? (
                      <span className="text-[10px] tabular-nums text-muted-foreground">
                        {tool.durationMs}ms
                      </span>
                    ) : null}
                  </div>
                  {tool.sql ? (
                    <pre className="overflow-x-auto whitespace-pre px-3 py-2 font-mono text-[11px] leading-5 text-foreground">
                      {tool.sql.trim()}
                    </pre>
                  ) : null}
                  <dl className="grid grid-cols-1 gap-x-4 gap-y-1 border-t border-border px-3 py-2 text-[11px] sm:grid-cols-2">
                    {rangeLabel ? (
                      <div className="flex gap-2">
                        <dt className="text-muted-foreground">时间窗口</dt>
                        <dd className="font-mono text-foreground">{rangeLabel}</dd>
                      </div>
                    ) : null}
                    {ev ? (
                      <>
                        <div className="flex gap-2">
                          <dt className="text-muted-foreground">数据集版本</dt>
                          <dd className="font-mono text-foreground">
                            {(tool.fact &&
                              ev.productVersionIds[
                                FACT_PRODUCT_KEY[tool.fact] ?? ''
                              ]) ??
                              ev.datasetVersionSetId}
                          </dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="text-muted-foreground">数据新鲜度</dt>
                          <dd className="text-foreground">{ev.freshnessAt}</dd>
                        </div>
                      </>
                    ) : null}
                  </dl>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
