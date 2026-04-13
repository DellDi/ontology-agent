import Link from 'next/link';

import type { WorkspaceHomeModel } from '@/application/workspace/home';
import { ProjectScopeDialog } from './project-scope-dialog';

type WorkspaceHomeShellProps = {
  model: WorkspaceHomeModel;
  creationError?: string;
  draftQuestion?: string;
};

export function WorkspaceHomeShell({
  model,
  creationError,
  draftQuestion,
}: WorkspaceHomeShellProps) {
  return (
    <section className="space-y-6">
      <article className="hero-panel p-7 md:p-9">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl space-y-4">
            <p className="text-sm font-medium tracking-[0.22em] text-[color:var(--brand-700)] uppercase">
              Skyline Intelligence Workspace
            </p>
            <h2 className="font-display text-3xl leading-tight font-semibold text-[color:var(--ink-900)] md:text-4xl">
              {model.greeting}
            </h2>
            <p className="max-w-2xl text-base leading-7 text-[color:var(--ink-600)]">
              这里先作为权限范围内的分析工作台首页，聚焦入口、范围提示和历史会话，
              为后续会话、计划和证据阅读预留清晰过渡。
            </p>
          </div>

          <div className="rounded-full border border-[color:var(--line-200)] bg-white/80 px-4 py-2 text-sm font-medium text-[color:var(--brand-700)] shadow-[var(--shadow-soft)]">
            {model.boundaryMessage}
          </div>
        </div>
      </article>

      <article className="glass-panel p-6 md:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <p className="text-xs font-medium tracking-[0.2em] text-[color:var(--brand-700)] uppercase">
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
          <div className="rounded-full bg-[color:var(--sky-100)] px-4 py-2 text-sm font-medium text-[color:var(--brand-700)]">
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
                问题将作为会话起点保留，后续分析能力会围绕这条原始问题继续展开。
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
                <p className="text-xs font-medium tracking-[0.2em] text-[color:var(--brand-700)] uppercase">
                  分析入口
                </p>
                <h3 className="mt-2 text-2xl font-semibold text-[color:var(--ink-900)]">
                  {action.label}
                </h3>
              </div>
              <span
                className="rounded-full px-3 py-1 text-xs font-medium"
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

      <article className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_360px]">
        <div className="glass-panel p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-medium tracking-[0.2em] text-[color:var(--brand-700)] uppercase">
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
              {model.historyItems.map((item) => (
                <Link
                  key={item.id}
                  href={item.href}
                  className="rounded-[28px] border border-[color:var(--line-200)] bg-white/78 p-5 transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-soft)]"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h4 className="text-lg font-semibold text-[color:var(--ink-900)]">
                      {item.title}
                    </h4>
                    <span className="rounded-full bg-[color:var(--sky-100)] px-3 py-1 text-xs font-medium text-[color:var(--brand-700)]">
                      {item.statusLabel}
                    </span>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-[color:var(--ink-600)]">
                    <span>最近更新时间</span>
                    <span className="font-medium text-[color:var(--ink-900)]">
                      {item.updatedAtLabel}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <aside className="glass-panel space-y-5 p-6">
          <div>
            <p className="text-xs font-medium tracking-[0.2em] text-[color:var(--brand-700)] uppercase">
              当前权限范围
            </p>
            <h3 className="mt-2 text-2xl font-semibold text-[color:var(--ink-900)]">
              你当前可见的组织与作用域
            </h3>
          </div>

          <div className="space-y-3">
            <div className="rounded-3xl bg-white/76 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--brand-700)]">
                组织
              </p>
              <p className="mt-2 text-base font-semibold text-[color:var(--ink-900)]">
                {model.scopeSummary.organization}
              </p>
            </div>
            <div className="rounded-3xl bg-white/76 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--brand-700)]">
                项目
              </p>
              <ProjectScopeDialog
                summary={model.projectScopeSummary}
                projects={model.projectDisplayNames}
              />
            </div>
            <div className="rounded-3xl bg-white/76 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--brand-700)]">
                角色
              </p>
              <p className="mt-2 text-base text-[color:var(--ink-900)]">
                {model.scopeSummary.roles}
              </p>
            </div>
          </div>

          <div className="rounded-[28px] border border-[color:var(--line-200)] bg-white/76 p-5">
            <p className="text-xs font-medium tracking-[0.18em] text-[color:var(--brand-700)] uppercase">
              范围说明
            </p>
            <div className="mt-4 space-y-4">
              <div>
                <h4 className="text-sm font-semibold text-[color:var(--ink-900)]">
                  支持范围
                </h4>
                <p className="mt-2 text-sm leading-6 text-[color:var(--ink-600)]">
                  {model.boundaryGuidance.supported.join('、')}等物业分析主题。
                </p>
              </div>
              <div>
                <h4 className="text-sm font-semibold text-[color:var(--ink-900)]">
                  不支持范围
                </h4>
                <p className="mt-2 text-sm leading-6 text-[color:var(--ink-600)]">
                  {model.boundaryGuidance.unsupported.join('、')}等业务能力。
                </p>
              </div>
              <p className="rounded-2xl bg-[color:var(--sky-50)] px-4 py-3 text-sm leading-6 text-[color:var(--ink-700)]">
                {model.boundaryGuidance.note}
              </p>
            </div>
          </div>

          {model.emptyState ? (
            <div className="status-banner" data-tone="info">
              <p className="font-semibold text-[color:var(--ink-900)]">
                {model.emptyState.title}
              </p>
              <p className="mt-2 text-sm leading-6 text-[color:var(--ink-600)]">
                {model.emptyState.description}
              </p>
            </div>
          ) : null}
        </aside>
      </article>
    </section>
  );
}
