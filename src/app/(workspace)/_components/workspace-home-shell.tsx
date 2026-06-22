import Link from 'next/link';

import type { WorkspaceHomeModel } from '@/application/workspace/home';

import { Badge } from '@/app/_components/workbench/badge';
import { Button } from '@/app/_components/workbench/button';
import { EmptyState } from '@/app/_components/workbench/empty-state';
import { Field, FieldLabel, FieldTextarea } from '@/app/_components/workbench/field';
import { MetricCard } from '@/app/_components/workbench/metric-card';
import { StatusBanner } from '@/app/_components/workbench/status-banner';
import { Surface, SurfaceBody, SurfaceHeader } from '@/app/_components/workbench/surface';

import { ScopePopover } from './scope-popover';

type WorkspaceHomeShellProps = {
  model: WorkspaceHomeModel;
  creationError?: string;
  draftQuestion?: string;
};

const STATUS_TONE_TO_BADGE: Record<
  'neutral' | 'info' | 'success' | 'error',
  React.ComponentProps<typeof Badge>['tone']
> = {
  success: 'success',
  error: 'error',
  info: 'info',
  neutral: 'neutral',
};

export function WorkspaceHomeShell({
  model,
  creationError,
  draftQuestion,
}: WorkspaceHomeShellProps) {
  return (
    <section className="space-y-6" data-testid="workspace-home-shell">
      {/* 数据降级提示（Redis/stream fallback 失败时显示） */}
      {model.degradedState ? (
        <StatusBanner
          tone="warning"
          title="数据可能不是最新"
          action={
            <Button
              variant="secondary"
              size="sm"
              asChild
            >
              <Link href="/workspace">刷新页面</Link>
            </Button>
          }
        >
          <p>{model.degradedState.message}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            来源：{model.degradedState.source} · {formatTime(model.degradedState.occurredAt)}
          </p>
        </StatusBanner>
      ) : null}

      {/* Hero：欢迎 + 权限 */}
      <Surface variant="hero">
        <SurfaceHeader
          eyebrow="经营分析工作台"
          title={model.greeting}
          description="在当前权限范围内发起经营问题分析，持续保留问题、计划、证据与结论。"
          action={
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone="info" className="font-medium">
                {model.boundaryMessage}
              </Badge>
              <Badge tone="neutral">{model.projectScopeSummary}</Badge>
              <ScopePopover
                organization={model.scopeSummary.organization}
                projectScopeSummary={model.projectScopeSummary}
                projectDisplayNames={model.projectDisplayNames}
                roles={model.scopeSummary.roles}
                boundaryGuidance={model.boundaryGuidance}
                emptyState={model.emptyState}
              />
            </div>
          }
        />
      </Surface>

      {/* 指标卡区：来自真实状态 */}
      {model.metrics.length > 0 ? (
        <div
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
          data-testid="workspace-metric-cards"
        >
          {model.metrics.map((metric) => (
            <MetricCard
              key={metric.id}
              label={metric.label}
              value={metric.value}
              helper={metric.helper}
            />
          ))}
        </div>
      ) : null}

      {/* 新建分析输入台 */}
      <Surface>
        <SurfaceHeader
          eyebrow="分析输入台"
          title="新建分析"
          description="从自然语言问题出发，先创建一个稳定的分析会话，再逐步接入意图识别、计划生成、证据阅读和归因结论。"
          action={
            <Badge tone="info">{model.boundaryMessage}</Badge>
          }
        />
        <SurfaceBody>
          {creationError ? (
            <StatusBanner tone="error" className="mb-5">
              {creationError}
            </StatusBanner>
          ) : null}

          {model.canCreateAnalysis ? (
            <form
              action="/api/analysis/sessions"
              method="post"
              className="space-y-4"
            >
              <Field>
                <FieldLabel>自然语言问题</FieldLabel>
                <FieldTextarea
                  name="question"
                  placeholder="例如：为什么本月某项目的收费回款率下降了？"
                  defaultValue={draftQuestion}
                  maxLength={300}
                  className="min-h-[132px]"
                />
              </Field>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  问题将作为会话起点保留，后续分析能力会围绕着这条原始问题继续展开。
                </p>
                <Button type="submit" variant="primary">
                  创建分析会话
                </Button>
              </div>
            </form>
          ) : (
            <StatusBanner tone="info">
              当前会话还没有可直接发起分析的项目范围。
            </StatusBanner>
          )}
        </SurfaceBody>
      </Surface>

      {/* 失败待处理（如果存在） */}
      {model.failedItems.length > 0 ? (
        <Surface>
          <SurfaceHeader
            eyebrow="失败待处理"
            title={`${model.failedItems.length} 条分析失败，建议优先处理`}
            description="包含上下文识别失败、工具调用失败、推理超时等情况。打开会话可继续修正后重试。"
          />
          <SurfaceBody>
            <ul className="space-y-3">
              {model.failedItems.map((item) => (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    className="block rounded-md border border-[color:var(--danger-500)]/30 bg-[color:color-mix(in_srgb,var(--danger-500)_6%,transparent)] p-4 transition-colors hover:bg-[color:color-mix(in_srgb,var(--danger-500)_10%,transparent)]"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h4 className="text-base font-semibold text-foreground">
                        {item.title}
                      </h4>
                      <Badge tone="error">{item.statusLabel}</Badge>
                    </div>
                    {item.failureMessage ? (
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        {item.failureMessage}
                      </p>
                    ) : null}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.updatedAtLabel}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </SurfaceBody>
        </Surface>
      ) : null}

      {/* 分析能力卡：真正可点击 */}
      <div className="grid gap-4 md:grid-cols-2" data-testid="workspace-action-cards">
        {model.analysisActions.map((action) => (
          <Surface key={action.label}>
            <SurfaceHeader
              eyebrow="分析能力"
              title={action.label}
              action={
                action.status === 'ready' ? (
                  <Badge tone="success">已就绪</Badge>
                ) : (
                  <Badge tone="warning">即将接入</Badge>
                )
              }
            />
            <SurfaceBody>
              <p className="text-sm leading-7 text-muted-foreground">
                {action.description}
              </p>
              <div className="mt-5">
                {action.status === 'ready' && action.href ? (
                  <Button asChild variant="primary" size="sm">
                    <Link href={action.href}>{action.label}</Link>
                  </Button>
                ) : (
                  <Badge tone="neutral" aria-disabled="true">
                    {action.label}（暂不可用）
                  </Badge>
                )}
              </div>
            </SurfaceBody>
          </Surface>
        ))}
      </div>

      {/* 历史会话 */}
      <Surface id="history">
        <SurfaceHeader
          eyebrow="历史会话"
          title="延续你最近的问题上下文"
        />
        <SurfaceBody>
          {model.historyEmptyState ? (
            <EmptyState
              title={model.historyEmptyState.title}
              description={model.historyEmptyState.description}
            />
          ) : (
            <ul className="grid gap-3">
              {model.historyItems.map((item) => (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    className="block rounded-md border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-secondary/40"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h4 className="text-base font-semibold text-foreground">
                        {item.title}
                      </h4>
                      <Badge tone={STATUS_TONE_TO_BADGE[item.statusTone]}>
                        {item.statusLabel}
                      </Badge>
                    </div>
                    {item.summaryMetric ? (
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        {item.summaryMetric}
                      </p>
                    ) : null}
                    {item.failureMessage ? (
                      <p className="mt-1 text-sm leading-6 text-[color:var(--danger-500)]">
                        {item.failureMessage}
                      </p>
                    ) : null}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.updatedAtLabel}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SurfaceBody>
      </Surface>
    </section>
  );
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return iso;
  }
}
