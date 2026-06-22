import type { ButtonHTMLAttributes, ReactNode } from 'react';

import type { AnalysisContext } from '@/domain/analysis-context/models';
import {
  buildFollowUpContextDiff,
  type AnalysisSessionFollowUp,
  type FollowUpContextChangeItem,
} from '@/domain/analysis-session/follow-up-models';
import { formatOntologyVersionBindingBadge } from '@/shared/ontology/version-binding-display';

import { StatusBanner, type StatusBannerTone } from '@/app/_components/workbench/status-banner';

// 该 panel 由 server component 渲染（用于无 JS 表单回退），不能引用 'use client' 组件。
// 这里复用 workbench StatusBanner（纯样式可在 server 端渲染），同时定义两个轻量 button
// 内联样式以避免 useState/forwardRef 类型在 server 边界上的麻烦。
function FollowUpPrimaryButton({
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button
      className={
        'inline-flex min-h-[44px] items-center justify-center rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60' +
        (className ? ` ${className}` : '')
      }
      {...props}
    >
      {children}
    </button>
  );
}

function FollowUpSecondaryButton({
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button
      className={
        'inline-flex min-h-[44px] items-center justify-center rounded-md border border-input bg-card px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60' +
        (className ? ` ${className}` : '')
      }
      {...props}
    >
      {children}
    </button>
  );
}

function FollowUpStatusBanner({
  tone,
  className,
  children,
}: {
  tone: StatusBannerTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <StatusBanner tone={tone} className={className}>
      {children}
    </StatusBanner>
  );
}

type AnalysisFollowUpPanelProps = {
  sessionId: string;
  activeFollowUpId?: string;
  latestConclusionTitle: string | null;
  latestConclusionSummary: string | null;
  inheritedContext: AnalysisContext;
  followUps: AnalysisSessionFollowUp[];
  adjustmentDraft?: {
    targetMetric?: string;
    entity?: string;
    timeRange?: string;
    comparison?: string;
    factor?: string;
  };
  conflictItems?: FollowUpContextChangeItem[];
  feedback?: {
    tone: 'success' | 'error';
    message: string;
  } | null;
  replanFeedback?: {
    tone: 'success' | 'error';
    message: string;
  } | null;
};

function renderOntologyVersionBadge(followUp: AnalysisSessionFollowUp) {
  return (
    <span
      className="rounded-md bg-white px-3 py-1 text-xs font-medium text-[color:var(--ink-600)]"
      data-testid="follow-up-ontology-version-badge"
    >
      {formatOntologyVersionBindingBadge(followUp.ontologyVersionBinding)}
    </span>
  );
}

function renderContextSummary(context: AnalysisContext) {
  return [
    `指标：${context.targetMetric.value}`,
    `实体：${context.entity.value}`,
    `时间：${context.timeRange.value}`,
  ];
}

function buildActiveFollowUp(followUps: AnalysisSessionFollowUp[], activeFollowUpId?: string) {
  if (!followUps.length) {
    return null;
  }

  return (
    followUps.find((followUp) => followUp.id === activeFollowUpId) ??
    followUps.at(-1) ??
    null
  );
}

export function AnalysisFollowUpPanel({
  sessionId,
  activeFollowUpId,
  latestConclusionTitle,
  latestConclusionSummary,
  inheritedContext,
  followUps,
  adjustmentDraft,
  conflictItems = [],
  feedback,
  replanFeedback,
}: AnalysisFollowUpPanelProps) {
  const activeFollowUp = buildActiveFollowUp(followUps, activeFollowUpId);

  return (
    <article className="rounded-md border border-border bg-card p-6 shadow-[var(--shadow-panel)]" data-testid="analysis-follow-up-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-[0.12em] text-[color:var(--brand-700)]">
            继续追问
          </p>
          <h3 className="mt-2 text-2xl font-semibold text-[color:var(--ink-900)]">
            在当前结论上继续下钻
          </h3>
          <p className="mt-3 text-sm leading-6 text-[color:var(--ink-600)]">
            默认沿用上一轮已确认的上下文，并把新问题附着在当前会话里，不会新建独立分析记录。
          </p>
        </div>
      </div>

      {feedback ? (
        <FollowUpStatusBanner
          className="mt-4"
          tone={feedback.tone === 'error' ? 'error' : 'success'}
        >
          {feedback.message}
        </FollowUpStatusBanner>
      ) : null}

      {replanFeedback ? (
        <FollowUpStatusBanner
          className="mt-4"
          tone={replanFeedback.tone === 'error' ? 'error' : 'success'}
        >
          {replanFeedback.message}
        </FollowUpStatusBanner>
      ) : null}

      <div className="mt-5 rounded-lg bg-white p-5">
        <p className="text-xs text-[color:var(--ink-600)]">当前承接结论</p>
        <p className="mt-2 text-base font-semibold text-[color:var(--ink-900)]">
          {latestConclusionTitle ?? '未命名结论'}
        </p>
        <p className="mt-2 text-sm leading-6 text-[color:var(--ink-600)]">
          {latestConclusionSummary ?? '系统将默认承接上一轮的主结论继续追问。'}
        </p>
      </div>

      <div className="mt-4 rounded-lg bg-white p-5">
        <p className="text-xs text-[color:var(--ink-600)]">默认沿用上下文</p>
        <ul className="mt-3 space-y-2 text-sm text-[color:var(--ink-900)]">
          {renderContextSummary(inheritedContext).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>

      <form
        action={`/api/analysis/sessions/${sessionId}/follow-ups`}
        className="mt-5 rounded-lg border border-[color:var(--line-200)] bg-white p-5"
        method="post"
      >
        {activeFollowUp ? (
          <input name="parentFollowUpId" type="hidden" value={activeFollowUp.id} />
        ) : null}
        <label className="space-y-2">
          <span className="block text-sm font-semibold text-foreground">追问问题</span>
          <textarea
            className="min-h-28 w-full resize-y rounded-md border border-input bg-card px-3.5 py-2.5 text-sm leading-7 text-foreground placeholder:text-[color:var(--ink-500)] transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/40"
            name="question"
            placeholder="例如：那物业服务为什么波动？"
            required
          />
        </label>
        <div className="mt-4 flex justify-end">
          <FollowUpPrimaryButton type="submit">提交追问</FollowUpPrimaryButton>
        </div>
      </form>

      <div className="mt-5 space-y-4">
        {activeFollowUp ? (
          <section className="rounded-lg border border-[color:var(--line-200)] bg-white p-5">
            <div>
              <p className="text-xs font-medium tracking-[0.12em] text-[color:var(--brand-700)]">
                补充因素或缩小范围
              </p>
              <p className="mt-2 text-sm leading-6 text-[color:var(--ink-600)]">
                只补充本轮新增条件。系统会在服务端合并到当前轮次上下文，并明确标识新增项与覆盖项。
              </p>
            </div>

            {conflictItems.length > 0 ? (
              <FollowUpStatusBanner className="mt-4" tone="error">
                发现冲突条件，确认后才会覆盖当前轮次上下文。
              </FollowUpStatusBanner>
            ) : null}

            {conflictItems.length > 0 ? (
              <div className="mt-4 space-y-3 rounded-lg bg-white p-5">
                {conflictItems.map((conflict) => (
                  <div key={`${conflict.key}-${conflict.nextValue}`} className="space-y-1">
                    <p className="text-sm font-medium text-[color:var(--ink-900)]">
                      {conflict.label}
                    </p>
                    <p className="text-sm text-[color:var(--ink-600)]">
                      当前值：{conflict.previousValue}
                    </p>
                    <p className="text-sm text-[color:var(--ink-600)]">
                      拟更新为：{conflict.nextValue}
                    </p>
                  </div>
                ))}
              </div>
            ) : null}

            <form
              action={`/api/analysis/sessions/${sessionId}/follow-ups/${activeFollowUp.id}/context`}
              className="mt-4 grid gap-4 md:grid-cols-2"
              method="post"
            >
              <label className="space-y-2">
                <span className="block text-sm font-semibold text-foreground">目标指标</span>
                <input
                  className="h-11 w-full rounded-md border border-input bg-card px-3.5 text-sm text-foreground placeholder:text-[color:var(--ink-500)] transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/40"
                  defaultValue={adjustmentDraft?.targetMetric ?? ''}
                  name="targetMetric"
                  placeholder={activeFollowUp.mergedContext.targetMetric.value}
                  type="text"
                />
              </label>
              <label className="space-y-2">
                <span className="block text-sm font-semibold text-foreground">实体对象</span>
                <input
                  className="h-11 w-full rounded-md border border-input bg-card px-3.5 text-sm text-foreground placeholder:text-[color:var(--ink-500)] transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/40"
                  defaultValue={adjustmentDraft?.entity ?? ''}
                  name="entity"
                  placeholder={activeFollowUp.mergedContext.entity.value}
                  type="text"
                />
              </label>
              <label className="space-y-2">
                <span className="block text-sm font-semibold text-foreground">时间范围</span>
                <input
                  className="h-11 w-full rounded-md border border-input bg-card px-3.5 text-sm text-foreground placeholder:text-[color:var(--ink-500)] transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/40"
                  defaultValue={adjustmentDraft?.timeRange ?? ''}
                  name="timeRange"
                  placeholder={activeFollowUp.mergedContext.timeRange.value}
                  type="text"
                />
              </label>
              <label className="space-y-2">
                <span className="block text-sm font-semibold text-foreground">比较方式</span>
                <input
                  className="h-11 w-full rounded-md border border-input bg-card px-3.5 text-sm text-foreground placeholder:text-[color:var(--ink-500)] transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/40"
                  defaultValue={adjustmentDraft?.comparison ?? ''}
                  name="comparison"
                  placeholder={activeFollowUp.mergedContext.comparison.value}
                  type="text"
                />
              </label>
              <label className="space-y-2 md:col-span-2">
                <span className="block text-sm font-semibold text-foreground">候选因素</span>
                <input
                  className="h-11 w-full rounded-md border border-input bg-card px-3.5 text-sm text-foreground placeholder:text-[color:var(--ink-500)] transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/40"
                  defaultValue={adjustmentDraft?.factor ?? ''}
                  name="factor"
                  placeholder="例如：物业服务"
                  type="text"
                />
              </label>
              <div className="flex flex-wrap justify-end gap-3 md:col-span-2">
                <FollowUpPrimaryButton type="submit">
                  提交增量条件
                </FollowUpPrimaryButton>
                {conflictItems.length > 0 ? (
                  <FollowUpSecondaryButton
                    name="confirmConflicts"
                    type="submit"
                    value="true"
                  >
                    确认覆盖冲突条件
                  </FollowUpSecondaryButton>
                ) : null}
              </div>
            </form>

            <form
              action={`/api/analysis/sessions/${sessionId}/follow-ups/${activeFollowUp.id}/replan`}
              className="mt-4 flex justify-end"
              method="post"
            >
              <FollowUpSecondaryButton type="submit">
                重生成后续计划
              </FollowUpSecondaryButton>
            </form>
          </section>
        ) : null}

        <div>
          <p className="text-xs font-medium tracking-[0.12em] text-[color:var(--brand-700)]">
            已提交追问
          </p>
          <p className="mt-2 text-sm leading-6 text-[color:var(--ink-600)]">
            追问仍然归属于当前 session，后续故事会继续在这里承接多轮执行和历史回放。
          </p>
        </div>
        {followUps.length > 0 ? (
          followUps.map((followUp) => (
            <FollowUpCard
              active={followUp.id === activeFollowUpId}
              followUp={followUp}
              key={followUp.id}
            />
          ))
        ) : (
          <p className="rounded-lg bg-white p-5 text-sm leading-6 text-[color:var(--ink-600)]">
            尚未发起追问。
          </p>
        )}
      </div>
    </article>
  );
}

function FollowUpCard({
  followUp,
  active,
}: {
  followUp: AnalysisSessionFollowUp;
  active: boolean;
}) {
  const diff = buildFollowUpContextDiff({
    inheritedContext: followUp.inheritedContext,
    mergedContext: followUp.mergedContext,
  });

  return (
    <section
      className="rounded-lg border border-[color:var(--line-200)] bg-white p-5"
      data-active={active ? 'true' : 'false'}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-base font-semibold text-[color:var(--ink-900)]">
          {followUp.questionText}
        </p>
        {active ? (
          <span className="rounded-md bg-[color:var(--sky-100)] px-3 py-1 text-xs font-medium text-[color:var(--brand-700)]">
            最新追问
          </span>
        ) : null}
      </div>
      <p className="mt-3 text-sm text-[color:var(--ink-600)]">
        承接结论：{followUp.referencedConclusionTitle ?? '未命名结论'}
      </p>
      <div className="mt-3">{renderOntologyVersionBadge(followUp)}</div>
      <ul className="mt-3 space-y-2 text-sm text-[color:var(--ink-900)]">
        {renderContextSummary(followUp.mergedContext).map((item) => (
          <li key={`${followUp.id}-${item}`}>{item}</li>
        ))}
      </ul>

      {diff.added.length > 0 ? (
        <div className="mt-4 rounded-lg bg-[color:var(--sky-50)] p-4">
          <p className="text-xs font-medium tracking-[0.12em] text-[color:var(--brand-700)]">
            新增条件
          </p>
          <ul className="mt-2 space-y-1 text-sm text-[color:var(--ink-900)]">
            {diff.added.map((item) => (
              <li key={`${followUp.id}-added-${item.key}-${item.nextValue}`}>
                {item.label}：{item.nextValue}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {diff.overridden.length > 0 ? (
        <div className="mt-4 rounded-lg bg-amber-50 p-4">
          <p className="text-xs font-medium tracking-[0.12em] text-amber-700">
            已覆盖条件
          </p>
          <ul className="mt-2 space-y-1 text-sm text-[color:var(--ink-900)]">
            {diff.overridden.map((item) => (
              <li key={`${followUp.id}-override-${item.key}-${item.nextValue}`}>
                {item.label}：{item.previousValue} -&gt; {item.nextValue}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {followUp.planVersion && followUp.currentPlanDiff ? (
        <div className="mt-4 space-y-4 rounded-lg border border-[color:var(--line-200)] bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold text-[color:var(--ink-900)]">
              计划版本 v{followUp.planVersion}
            </p>
            <p className="text-sm text-[color:var(--ink-600)]">
              {followUp.currentPlanDiff.reason}
            </p>
          </div>

          {followUp.currentPlanDiff.reusedSteps.length > 0 ? (
            <div>
              <p className="text-xs font-medium tracking-[0.12em] text-[color:var(--brand-700)]">
                可复用步骤
              </p>
              <ul className="mt-2 space-y-1 text-sm text-[color:var(--ink-900)]">
                {followUp.currentPlanDiff.reusedSteps.map((step) => (
                  <li key={`${followUp.id}-reused-${step.stepId}`}>{step.title}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {followUp.currentPlanDiff.invalidatedSteps.length > 0 ? (
            <div>
              <p className="text-xs font-medium tracking-[0.12em] text-amber-700">
                失效步骤
              </p>
              <ul className="mt-2 space-y-1 text-sm text-[color:var(--ink-900)]">
                {followUp.currentPlanDiff.invalidatedSteps.map((step) => (
                  <li key={`${followUp.id}-invalid-${step.stepId}`}>{step.title}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {followUp.currentPlanDiff.addedSteps.length > 0 ? (
            <div>
              <p className="text-xs font-medium tracking-[0.12em] text-[color:var(--brand-700)]">
                新增步骤
              </p>
              <ul className="mt-2 space-y-1 text-sm text-[color:var(--ink-900)]">
                {followUp.currentPlanDiff.addedSteps.map((step) => (
                  <li key={`${followUp.id}-added-step-${step.stepId}-${step.reason}`}>
                    {step.title}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
