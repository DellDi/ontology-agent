import type { AnalysisContext } from '@/domain/analysis-context/models';
import {
  buildFollowUpContextDiff,
  type AnalysisSessionFollowUp,
  type FollowUpContextChangeItem,
} from '@/domain/analysis-session/follow-up-models';

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
    <article className="glass-panel p-6" data-testid="analysis-follow-up-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-[0.2em] text-[color:var(--brand-700)] uppercase">
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
        <div
          className="status-banner mt-4"
          data-tone={feedback.tone === 'error' ? 'error' : 'success'}
        >
          {feedback.message}
        </div>
      ) : null}

      {replanFeedback ? (
        <div
          className="status-banner mt-4"
          data-tone={replanFeedback.tone === 'error' ? 'error' : 'success'}
        >
          {replanFeedback.message}
        </div>
      ) : null}

      <div className="mt-5 rounded-3xl bg-white/76 p-5">
        <p className="text-xs text-[color:var(--ink-600)]">当前承接结论</p>
        <p className="mt-2 text-base font-semibold text-[color:var(--ink-900)]">
          {latestConclusionTitle ?? '未命名结论'}
        </p>
        <p className="mt-2 text-sm leading-6 text-[color:var(--ink-600)]">
          {latestConclusionSummary ?? '系统将默认承接上一轮的主结论继续追问。'}
        </p>
      </div>

      <div className="mt-4 rounded-3xl bg-white/76 p-5">
        <p className="text-xs text-[color:var(--ink-600)]">默认沿用上下文</p>
        <ul className="mt-3 space-y-2 text-sm text-[color:var(--ink-900)]">
          {renderContextSummary(inheritedContext).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>

      <form
        action={`/api/analysis/sessions/${sessionId}/follow-ups`}
        className="mt-5 rounded-3xl border border-[color:var(--line-200)] bg-white/78 p-5"
        method="post"
      >
        <label className="space-y-2">
          <span className="field-label">追问问题</span>
          <textarea
            className="field-input min-h-28 resize-y"
            name="question"
            placeholder="例如：那物业服务为什么波动？"
            required
          />
        </label>
        <div className="mt-4 flex justify-end">
          <button className="primary-button" type="submit">
            提交追问
          </button>
        </div>
      </form>

      <div className="mt-5 space-y-4">
        {activeFollowUp ? (
          <section className="rounded-3xl border border-[color:var(--line-200)] bg-white/78 p-5">
            <div>
              <p className="text-xs font-medium tracking-[0.2em] text-[color:var(--brand-700)] uppercase">
                补充因素或缩小范围
              </p>
              <p className="mt-2 text-sm leading-6 text-[color:var(--ink-600)]">
                只补充本轮新增条件。系统会在服务端合并到当前轮次上下文，并明确标识新增项与覆盖项。
              </p>
            </div>

            {conflictItems.length > 0 ? (
              <div className="status-banner mt-4" data-tone="error">
                发现冲突条件，确认后才会覆盖当前轮次上下文。
              </div>
            ) : null}

            {conflictItems.length > 0 ? (
              <div className="mt-4 space-y-3 rounded-3xl bg-white/76 p-5">
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
                <span className="field-label">目标指标</span>
                <input
                  className="field-input"
                  defaultValue={adjustmentDraft?.targetMetric ?? ''}
                  name="targetMetric"
                  placeholder={activeFollowUp.mergedContext.targetMetric.value}
                  type="text"
                />
              </label>
              <label className="space-y-2">
                <span className="field-label">实体对象</span>
                <input
                  className="field-input"
                  defaultValue={adjustmentDraft?.entity ?? ''}
                  name="entity"
                  placeholder={activeFollowUp.mergedContext.entity.value}
                  type="text"
                />
              </label>
              <label className="space-y-2">
                <span className="field-label">时间范围</span>
                <input
                  className="field-input"
                  defaultValue={adjustmentDraft?.timeRange ?? ''}
                  name="timeRange"
                  placeholder={activeFollowUp.mergedContext.timeRange.value}
                  type="text"
                />
              </label>
              <label className="space-y-2">
                <span className="field-label">比较方式</span>
                <input
                  className="field-input"
                  defaultValue={adjustmentDraft?.comparison ?? ''}
                  name="comparison"
                  placeholder={activeFollowUp.mergedContext.comparison.value}
                  type="text"
                />
              </label>
              <label className="space-y-2 md:col-span-2">
                <span className="field-label">候选因素</span>
                <input
                  className="field-input"
                  defaultValue={adjustmentDraft?.factor ?? ''}
                  name="factor"
                  placeholder="例如：物业服务"
                  type="text"
                />
              </label>
              <div className="flex flex-wrap justify-end gap-3 md:col-span-2">
                <button className="primary-button" type="submit">
                  提交增量条件
                </button>
                {conflictItems.length > 0 ? (
                  <button
                    className="secondary-button"
                    name="confirmConflicts"
                    type="submit"
                    value="true"
                  >
                    确认覆盖冲突条件
                  </button>
                ) : null}
              </div>
            </form>

            <form
              action={`/api/analysis/sessions/${sessionId}/follow-ups/${activeFollowUp.id}/replan`}
              className="mt-4 flex justify-end"
              method="post"
            >
              <button className="secondary-button" type="submit">
                重生成后续计划
              </button>
            </form>
          </section>
        ) : null}

        <div>
          <p className="text-xs font-medium tracking-[0.2em] text-[color:var(--brand-700)] uppercase">
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
          <p className="rounded-3xl bg-white/76 p-5 text-sm leading-6 text-[color:var(--ink-600)]">
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
      className="rounded-3xl border border-[color:var(--line-200)] bg-white/76 p-5"
      data-active={active ? 'true' : 'false'}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-base font-semibold text-[color:var(--ink-900)]">
          {followUp.questionText}
        </p>
        {active ? (
          <span className="rounded-full bg-[color:var(--sky-100)] px-3 py-1 text-xs font-medium text-[color:var(--brand-700)]">
            最新追问
          </span>
        ) : null}
      </div>
      <p className="mt-3 text-sm text-[color:var(--ink-600)]">
        承接结论：{followUp.referencedConclusionTitle ?? '未命名结论'}
      </p>
      <ul className="mt-3 space-y-2 text-sm text-[color:var(--ink-900)]">
        {renderContextSummary(followUp.mergedContext).map((item) => (
          <li key={`${followUp.id}-${item}`}>{item}</li>
        ))}
      </ul>

      {diff.added.length > 0 ? (
        <div className="mt-4 rounded-3xl bg-[color:var(--sky-50)]/80 p-4">
          <p className="text-xs font-medium tracking-[0.18em] text-[color:var(--brand-700)] uppercase">
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
        <div className="mt-4 rounded-3xl bg-amber-50 p-4">
          <p className="text-xs font-medium tracking-[0.18em] text-amber-700 uppercase">
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
        <div className="mt-4 space-y-4 rounded-3xl border border-[color:var(--line-200)] bg-white/82 p-4">
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
              <p className="text-xs font-medium tracking-[0.18em] text-[color:var(--brand-700)] uppercase">
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
              <p className="text-xs font-medium tracking-[0.18em] text-amber-700 uppercase">
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
              <p className="text-xs font-medium tracking-[0.18em] text-[color:var(--brand-700)] uppercase">
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
