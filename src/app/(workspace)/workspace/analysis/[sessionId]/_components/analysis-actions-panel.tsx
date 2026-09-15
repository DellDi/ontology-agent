'use client';

type SuggestedAction = {
  label: string;
  rationale: string;
};

/**
 * 动作建议面板：LLM 基于结论给出的决策性业务动作建议。
 * 本期只读展示——动作定义/派发/审计通道规划后再开放执行；
 * 卡片一律标识"建议 · 需人工确认"，不产生任何写副作用。
 */
export function AnalysisActionsPanel({
  actions,
}: {
  actions: SuggestedAction[];
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs leading-5 text-muted-foreground">
        基于本轮结论给出的业务动作建议。动作执行需要人工确认并经派发通道完成，
        当前仅作决策参考。
      </p>
      {actions.map((action, index) => (
        <div
          className="rounded-lg border border-border bg-card px-4 py-3"
          key={`${action.label}-${index}`}
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-foreground">{action.label}</p>
            <span className="shrink-0 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600">
              建议 · 需人工确认
            </span>
          </div>
          <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
            {action.rationale}
          </p>
        </div>
      ))}
    </div>
  );
}
