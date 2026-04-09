import type { AnalysisContext } from '@/domain/analysis-context/models';
import type { AnalysisSessionFollowUp } from '@/domain/analysis-session/follow-up-models';

type AnalysisFollowUpPanelProps = {
  sessionId: string;
  activeFollowUpId?: string;
  latestConclusionTitle: string | null;
  latestConclusionSummary: string | null;
  inheritedContext: AnalysisContext;
  followUps: AnalysisSessionFollowUp[];
  feedback?: {
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

export function AnalysisFollowUpPanel({
  sessionId,
  activeFollowUpId,
  latestConclusionTitle,
  latestConclusionSummary,
  inheritedContext,
  followUps,
  feedback,
}: AnalysisFollowUpPanelProps) {
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
            <section
              key={followUp.id}
              className="rounded-3xl border border-[color:var(--line-200)] bg-white/76 p-5"
              data-active={followUp.id === activeFollowUpId ? 'true' : 'false'}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-base font-semibold text-[color:var(--ink-900)]">
                  {followUp.questionText}
                </p>
                {followUp.id === activeFollowUpId ? (
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
            </section>
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
