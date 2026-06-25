import {
  buildAssumptionCardPart,
  renderAnalysisInteractionPart,
} from '@/application/analysis-interaction';
import type { AnalysisPlanReadModel } from '@/application/analysis-planning/use-cases';

import { AnalysisInteractionRenderedBlock } from './analysis-interaction-rendered-block';

type AnalysisPlanPanelProps = {
  sessionId: string;
  readModel: AnalysisPlanReadModel;
  followUpId?: string;
  blockingMessage?: string;
};

export function AnalysisPlanPanel({
  sessionId,
  readModel,
  followUpId,
  blockingMessage,
}: AnalysisPlanPanelProps) {
  const assumptionsRenderedBlock = readModel.assumptions.length > 0
    ? renderAnalysisInteractionPart(
        buildAssumptionCardPart({
          assumptions: readModel.assumptions,
          title: '自动执行假设',
          testId: 'analysis-plan-assumptions',
          source: {
            sourceType: 'runtime-foundation-part',
            sessionId,
            eventId: 'plan-assumptions',
            blockIndex: 0,
          },
        }),
        {
          surface: 'workspace',
        },
      )
    : null;

  return (
    <article
      className="rounded-md border border-border bg-card p-6 shadow-[var(--shadow-panel)]"
      data-testid="analysis-plan-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-[0.12em] text-primary">
            {readModel.headline}
          </p>
          <h3 className="mt-2 text-2xl font-semibold text-foreground">
            {readModel.mode === 'multi-step' ? '计划骨架' : '极简计划'}
          </h3>
        </div>
        <span className="rounded-md bg-primary/10 px-4 py-2 text-sm font-medium text-primary">
          {readModel.steps.length} 个步骤
        </span>
      </div>

      <p className="mt-4 text-sm leading-7 text-muted-foreground">
        {readModel.summary}
      </p>

      {readModel.assumptions.length > 0 ? (
        <AnalysisInteractionRenderedBlock
          className="mt-4"
          renderedBlock={assumptionsRenderedBlock!}
        />
      ) : null}

      <div className="mt-5 space-y-4">
        {readModel.steps.map((step) => (
          <section
            key={step.id}
            className="rounded-lg border border-border bg-card p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium tracking-[0.12em] text-primary">
                  步骤 {step.order}
                </p>
                <h4 className="mt-2 text-lg font-semibold text-foreground">
                  {step.title}
                </h4>
              </div>
              <span className="rounded-md bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                {step.dependencyLabels.length > 0 ? '有依赖' : '起始步骤'}
              </span>
            </div>

            <p className="mt-3 text-sm leading-7 text-muted-foreground">
              {step.objective}
            </p>

            <div className="mt-4 rounded-lg bg-muted p-4">
              <p className="text-xs font-medium tracking-[0.12em] text-primary">
                依赖步骤
              </p>
              {step.dependencyLabels.length > 0 ? (
                <ul className="mt-2 space-y-1 text-sm text-foreground">
                  {step.dependencyLabels.map((label) => (
                    <li key={label}>{label}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  无，系统会从这里开始建立本次分析路径。
                </p>
              )}
            </div>
          </section>
        ))}
      </div>

      <div className="mt-6 rounded-lg border border-border bg-card p-5">
        <p className="text-xs font-medium tracking-[0.12em] text-primary">
          执行入口
        </p>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">
          {blockingMessage
            ? '系统会将当前计划提交到后台执行；若治理化计划未通过校验，会在提交前阻断并提示你修正上下文。'
            : '系统默认自动发起后台执行；你无需补齐所有细项后再手动启动。'}
        </p>
        {blockingMessage ? (
          <div
            role="alert"
            aria-live="assertive"
            data-tone="error"
            className="mt-4 rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm leading-6 text-foreground"
          >
            {blockingMessage}
          </div>
        ) : null}
        <form
          action={`/api/analysis/sessions/${sessionId}/execute`}
          className="mt-4"
          method="post"
        >
          {followUpId ? (
            <input name="followUpId" type="hidden" value={followUpId} />
          ) : null}
          <button
            className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
            disabled={Boolean(blockingMessage)}
            type="submit"
          >
            手动执行（兜底）
          </button>
        </form>
      </div>
    </article>
  );
}
