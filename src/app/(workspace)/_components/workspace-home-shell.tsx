import Link from 'next/link';

import type { WorkspaceHomeModel } from '@/application/workspace/home';
import { ScopePopover } from './scope-popover';

type WorkspaceHomeShellProps = {
  model: WorkspaceHomeModel;
  creationError?: string;
  draftQuestion?: string;
};

const STATUS_TONE_STYLES: Record<
  'neutral' | 'info' | 'success' | 'error',
  { backgroundColor: string; color: string }
> = {
  success: {
    backgroundColor: 'rgb(49 185 130 / 12%)',
    color: 'rgb(18 96 69)',
  },
  error: {
    backgroundColor: 'rgb(220 66 66 / 12%)',
    color: 'rgb(153 27 27)',
  },
  info: {
    backgroundColor: 'rgb(59 130 246 / 12%)',
    color: 'rgb(30 64 175)',
  },
  neutral: {
    backgroundColor: 'rgb(148 163 184 / 16%)',
    color: 'rgb(71 85 105)',
  },
};

export function WorkspaceHomeShell({
  model,
  creationError,
  draftQuestion,
}: WorkspaceHomeShellProps) {
  return (
    <section className="space-y-6">
      <article className="hero-panel p-6 md:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl space-y-3">
            <p className="text-xs font-semibold tracking-[0.12em] text-[color:var(--brand-700)]">
              经营分析工作台
            </p>
            <h2 className="font-display text-2xl leading-tight font-semibold text-[color:var(--ink-900)] md:text-3xl">
              {model.greeting}
            </h2>
            <p className="max-w-2xl text-sm leading-6 text-[color:var(--ink-600)]">
              在当前权限范围内发起经营问题分析，持续保留问题、计划、证据与结论。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-md border border-[color:var(--line-200)] bg-white px-4 py-2 text-sm font-medium text-[color:var(--brand-700)] shadow-[var(--shadow-soft)]">
              {model.boundaryMessage}
            </div>
            <ScopePopover
              organization={model.scopeSummary.organization}
              projectScopeSummary={model.projectScopeSummary}
              projectDisplayNames={model.projectDisplayNames}
              roles={model.scopeSummary.roles}
              boundaryGuidance={model.boundaryGuidance}
              emptyState={model.emptyState}
            />
          </div>
        </div>
      </article>

      <article className="glass-panel p-6 md:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold tracking-[0.12em] text-[color:var(--brand-700)]">
              分析输入台
            </p>
            <h3 className="mt-2 text-2xl font-semibold text-[color:var(--ink-900)]">
              新建分析
            </h3>
            <p className="mt-3 text-sm leading-7 text-[color:var(--ink-600)]">
              从自然语言问题出发，先创建一个稳定的分析会话，再逐步接入意图识别、
              计划生成、证据阅读和归因结论。
            </p>
          </div>
          <div className="rounded-md bg-[color:var(--sky-100)] px-4 py-2 text-sm font-medium text-[color:var(--brand-700)]">
            当前版本仅支持物业分析
          </div>
        </div>

        {creationError ? (
          <div className="mt-5 status-banner" data-tone="error">
            {creationError}
          </div>
        ) : null}

        {model.canCreateAnalysis ? (
          <form
            action="/api/analysis/sessions"
            method="post"
            className="mt-6 space-y-4"
          >
            <label className="block">
              <span className="field-label">自然语言问题</span>
              <textarea
                className="field-input min-h-[132px] resize-y"
                name="question"
                placeholder="例如：为什么本月某项目的收费回款率下降了？"
                defaultValue={draftQuestion}
                maxLength={300}
              />
            </label>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-[color:var(--ink-600)]">
                问题将作为会话起点保留，后续分析能力会围绕着这条原始问题继续展开。
              </p>
              <button className="primary-button" type="submit">
                创建分析会话
              </button>
            </div>
          </form>
        ) : (
          <div className="mt-6 status-banner" data-tone="info">
            当前会话还没有可直接发起分析的项目范围。
          </div>
        )}
      </article>

      <article className="grid gap-4 md:grid-cols-2">
        {model.analysisActions.map((action) => (
          <div key={action.label} className="glass-panel p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
            <p className="text-xs font-semibold tracking-[0.12em] text-[color:var(--brand-700)]">
              分析能力
                </p>
                <h3 className="mt-2 text-2xl font-semibold text-[color:var(--ink-900)]">
                  {action.label}
                </h3>
              </div>
              <span
                className="rounded-md px-3 py-1 text-xs font-medium"
                style={{
                  backgroundColor:
                    action.status === 'ready'
                      ? 'rgb(49 185 130 / 12%)'
                      : 'rgb(255 182 72 / 16%)',
                  color:
                    action.status === 'ready'
                      ? 'rgb(18 96 69)'
                      : 'rgb(143 96 22)',
                }}
              >
                {action.status === 'ready' ? '已就绪' : '即将接入'}
              </span>
            </div>
            <p className="mt-4 text-sm leading-7 text-[color:var(--ink-600)]">
              {action.description}
            </p>
            <div className="mt-5">
              <span
                className={
                  action.status === 'ready'
                    ? 'primary-button'
                    : 'secondary-button'
                }
              >
                {action.label}
              </span>
            </div>
          </div>
        ))}
      </article>

      <article className="glass-panel p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-[0.12em] text-[color:var(--brand-700)]">
              历史会话
            </p>
            <h3 className="mt-2 text-2xl font-semibold text-[color:var(--ink-900)]">
              延续你最近的问题上下文
            </h3>
          </div>
        </div>

        {model.historyEmptyState ? (
          <div className="mt-5 status-banner" data-tone="info">
            <p className="font-semibold text-[color:var(--ink-900)]">
              {model.historyEmptyState.title}
            </p>
            <p className="mt-2 text-sm leading-6 text-[color:var(--ink-600)]">
              {model.historyEmptyState.description}
            </p>
          </div>
        ) : (
          <div className="mt-5 grid gap-4">
            {model.historyItems.map((item) => {
              const toneStyle = STATUS_TONE_STYLES[item.statusTone];

              return (
                <Link
                  key={item.id}
                  href={item.href}
                  className="rounded-lg border border-[color:var(--line-200)] bg-white p-5 transition-colors duration-150 hover:bg-[color:var(--surface-50)] hover:shadow-[var(--shadow-soft)]"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h4 className="text-lg font-semibold text-[color:var(--ink-900)]">
                      {item.title}
                    </h4>
                    <span
                      className="rounded-md px-3 py-1 text-xs font-medium"
                      style={toneStyle}
                    >
                      {item.statusLabel}
                    </span>
                  </div>

                  {item.summaryMetric ? (
                    <p className="mt-2 text-sm text-[color:var(--ink-600)]">
                      {item.summaryMetric}
                    </p>
                  ) : null}

                  {item.failureMessage ? (
                    <p className="mt-2 text-sm text-[color:rgb(153,27,27)]">
                      失败原因: {item.failureMessage}
                    </p>
                  ) : null}

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-[color:var(--ink-600)]">
                    <span>最近更新时间</span>
                    <span className="font-medium text-[color:var(--ink-900)]">
                      {item.updatedAtLabel}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </article>
    </section>
  );
}
