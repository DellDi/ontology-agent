'use client';

import { useState } from 'react';
import { IngestionAccessPanel } from './ingestion-access-panel';
import { IngestionReleasePanel } from './ingestion-release-panel';
import type {
  IngestionAccess,
  IngestionOverview,
  IngestionReleaseTask,
} from '@/infrastructure/java-backend/ingestion-schema';
import { StatusBadge, formatTimestamp } from '../../_components/admin-shell';

const labels = {
  pending: '待执行',
  running: '执行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  active: '已启用',
  disabled: '已停用',
  draft: '草稿',
  frozen: '已冻结',
  revoked: '已撤销',
  published: '已发布',
  building: '构建中',
};
function Status({ value }: { value: keyof typeof labels }) {
  return (
    <StatusBadge
      tone={
        value === 'failed'
          ? 'danger'
          : value === 'running' || value === 'pending'
            ? 'warning'
            : 'neutral'
      }
    >
      {labels[value]}
    </StatusBadge>
  );
}
const modes = { full: '全量', incremental: '增量', reconcile: '对账' };
const views = [
  { key: 'publish', label: '发布任务' },
  { key: 'runs', label: '采集与物化' },
  { key: 'catalog', label: '数据目录' },
  { key: 'releases', label: '冻结版本' },
  { key: 'access', label: '组织授权' },
] as const;
const detailClass = 'border-b border-border py-4';
const summaryClass =
  'flex cursor-pointer flex-wrap items-center justify-between gap-3 rounded-sm text-sm focus-visible:outline-2 focus-visible:outline-ring';
const codeClass = 'break-all font-mono text-xs text-muted-foreground';

export function IngestionWorkbench({
  overview,
  releaseTasks,
  access,
  initialView = 'publish',
}: {
  overview: IngestionOverview;
  access: IngestionAccess;
  releaseTasks: IngestionReleaseTask[];
  initialView?: 'publish' | 'releases';
}) {
  const [view, setView] = useState<(typeof views)[number]['key']>(initialView);
  const [status, setStatus] = useState('all');
  const [query, setQuery] = useState('');
  const runs = overview.runs.filter(
    (run) =>
      (status === 'all' || run.status === status) &&
      `${run.targetKey} ${run.id} ${run.errorCode ?? ''}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );

  return (
    <section className="mx-auto w-full max-w-6xl space-y-7">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-xs text-muted-foreground">
            {access.canManage ? '平台管理' : '组织共享源 · 只读'}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">数据接入</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            查看接入进度，定位失败任务，追溯分析使用的数据版本。
          </p>
        </div>
        <a
          href="/admin/ingestion"
          className="rounded-md border border-input px-4 py-2 text-sm hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring"
        >
          刷新状态
        </a>
      </header>
      <nav
        aria-label="数据接入视图"
        className="flex flex-wrap gap-6 border-b border-border"
      >
        {views
          .filter((item) => item.key !== 'access' || access.canManage)
          .map((item) => (
            <button
              key={item.key}
              type="button"
              aria-current={view === item.key ? 'page' : undefined}
              onClick={() => setView(item.key)}
              className={`border-b-2 pb-3 text-sm focus-visible:outline-2 focus-visible:outline-ring ${view === item.key ? 'border-foreground font-semibold text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            >
              {item.label}
            </button>
          ))}
      </nav>
      <div hidden={view !== 'publish'}>
        <IngestionReleasePanel
          overview={overview}
          initialTasks={releaseTasks}
          canManage={access.canManage}
        />
      </div>
      {view === 'access' && access.canManage && (
        <IngestionAccessPanel
          initialAccess={access}
          sources={overview.sources}
        />
      )}
      {view === 'runs' && (
        <div>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              平台最近 {overview.runLimit} 条任务中的可见记录 · 当前显示{' '}
              {runs.length} 条
            </p>
            <div className="flex flex-wrap gap-2">
              <input
                aria-label="搜索任务"
                placeholder="搜索名称、任务编号或错误码"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="w-64 max-w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
              <select
                aria-label="任务状态"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="all">全部状态</option>
                {(
                  [
                    'failed',
                    'running',
                    'pending',
                    'completed',
                    'cancelled',
                  ] as const
                ).map((value) => (
                  <option key={value} value={value}>
                    {labels[value]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {runs.length === 0 && (
            <p
              role="status"
              className="py-14 text-center text-sm text-muted-foreground"
            >
              {overview.runs.length
                ? '当前筛选下没有任务，请调整状态或搜索条件。'
                : '尚无接入任务。通过现有接入流程执行后，可在此查看状态。'}
            </p>
          )}
          {runs.map((run) => (
            <details key={`${run.kind}:${run.id}`} className={detailClass}>
              <summary className={summaryClass}>
                <span className="min-w-0">
                  <span className="mr-3 text-xs text-muted-foreground">
                    {run.kind === 'source' ? '采集' : '物化'}
                  </span>
                  <span className="break-all font-medium">{run.targetKey}</span>
                  <span className="ml-3 text-xs text-muted-foreground">
                    {modes[run.mode]}
                  </span>
                </span>
                <span className="flex items-center gap-4">
                  <time className="text-xs text-muted-foreground">
                    {formatTimestamp(run.createdAt)}
                  </time>
                  <Status value={run.status} />
                  <span aria-hidden="true" className="text-muted-foreground">
                    ⌄
                  </span>
                </span>
              </summary>
              <dl className="mt-5 grid gap-4 bg-muted/40 p-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="mb-1 text-muted-foreground">任务编号</dt>
                  <dd className={codeClass}>{run.id}</dd>
                </div>
                <div>
                  <dt className="mb-1 text-muted-foreground">关联编号</dt>
                  <dd className={codeClass}>{run.correlationId ?? '未记录'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">开始时间</dt>
                  <dd>{formatTimestamp(run.startedAt)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">结束时间</dt>
                  <dd>{formatTimestamp(run.finishedAt)}</dd>
                </div>
                {run.status === 'failed' && (
                  <div className="sm:col-span-2">
                    <dt className="break-all font-medium text-destructive">
                      {run.errorCode ?? '任务失败，未记录错误码'}
                    </dt>
                    <dd className="mt-2 leading-6 text-muted-foreground">
                      请将任务编号和关联编号交给运维人员定位日志。修复原因后，通过现有接入流程重新执行。
                    </dd>
                  </div>
                )}
              </dl>
            </details>
          ))}
        </div>
      )}
      {view === 'catalog' && (
        <div className="space-y-8">
          <section>
            <h2 className="mb-2 text-base font-semibold">数据源与数据集</h2>
            <p className="mb-3 text-sm text-muted-foreground">
              目录启用状态不代表连接或数据已就绪。
            </p>
            {overview.sources.length === 0 && (
              <p className="py-8 text-sm text-muted-foreground">
                尚未登记数据源。
              </p>
            )}
            {overview.sources.map((source) => (
              <details key={source.key} className={detailClass}>
                <summary className={summaryClass}>
                  <span className="break-all font-medium">
                    {source.key}{' '}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {source.connectorType} ·{' '}
                      {
                        overview.datasets.filter(
                          (dataset) => dataset.sourceKey === source.key,
                        ).length
                      }{' '}
                      个数据集
                    </span>
                  </span>
                  <span className="flex items-center gap-4">
                    <Status value={source.status} />
                    <span aria-hidden="true" className="text-muted-foreground">
                      ⌄
                    </span>
                  </span>
                </summary>
                <ul className="mt-4 divide-y divide-border border-l-2 border-border pl-4">
                  {overview.datasets
                    .filter((dataset) => dataset.sourceKey === source.key)
                    .map((dataset) => (
                      <li
                        key={dataset.key}
                        className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
                      >
                        <span className="break-all">
                          {dataset.key}{' '}
                          <span className="text-xs text-muted-foreground">
                            schema v{dataset.schemaVersion}
                          </span>
                        </span>
                        <Status value={dataset.status} />
                      </li>
                    ))}
                </ul>
              </details>
            ))}
          </section>
          <section>
            <h2 className="mb-2 text-base font-semibold">数据产品</h2>
            {overview.products.length === 0 && (
              <p className="py-8 text-sm text-muted-foreground">
                尚未登记数据产品。
              </p>
            )}
            {overview.products.map((product) => (
              <details key={product.key} className={detailClass}>
                <summary className={summaryClass}>
                  <span className="break-all font-medium">
                    {product.key}{' '}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {product.domainKey}
                    </span>
                  </span>
                  <span className="flex items-center gap-4">
                    <Status value={product.status} />
                    <span aria-hidden="true" className="text-muted-foreground">
                      ⌄
                    </span>
                  </span>
                </summary>
                <p className="mt-4 text-xs text-muted-foreground">输入数据集</p>
                <ul className="mt-2 space-y-2">
                  {product.datasetKeys.map((key, index) => (
                    <li key={`${key}:${index}`} className={codeClass}>
                      {key}
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </section>
        </div>
      )}
      {view === 'releases' && (
        <div>
          <p className="mb-4 text-sm text-muted-foreground">
            最近 {overview.releaseLimit}{' '}
            个版本集。版本集固定产品版本，分析记录中的数据版本编号可在此核对。
          </p>
          {overview.releases.length === 0 && (
            <p className="py-14 text-center text-sm text-muted-foreground">
              尚无版本集。完成采集、物化并冻结版本后，会在此展示溯源关系。
            </p>
          )}
          {overview.releases.map((release) => (
            <details key={release.id} className={detailClass}>
              <summary className={summaryClass}>
                <span className="min-w-0 break-all font-mono text-sm">
                  {release.id}
                </span>
                <span className="flex items-center gap-4">
                  <time className="text-xs text-muted-foreground">
                    {formatTimestamp(release.capturedAt)}
                  </time>
                  <Status value={release.status} />
                  <span aria-hidden="true" className="text-muted-foreground">
                    ⌄
                  </span>
                </span>
              </summary>
              {release.products.length === 0 && (
                <p className="mt-4 text-sm text-muted-foreground">
                  此版本集尚未绑定数据产品。
                </p>
              )}
              <div className="mt-4 space-y-5 border-l-2 border-border pl-4">
                {release.products.map((product) => (
                  <div key={product.key}>
                    <div className="flex flex-wrap items-center gap-3 text-sm">
                      <span className="break-all font-medium">
                        {product.key}
                      </span>
                      <Status value={product.status} />
                      <span className="text-muted-foreground">
                        {product.rowCount.toLocaleString('zh-CN')} 行
                      </span>
                    </div>
                    <p className={`mt-2 ${codeClass}`}>
                      产品版本：{product.versionId}
                    </p>
                    <p className={`mt-1 ${codeClass}`}>
                      物化任务：{product.runId}
                    </p>
                    <ul className="mt-3 space-y-3">
                      {product.sources.map((source, index) => (
                        <li
                          key={`${source.versionId}:${index}`}
                          className="border-l border-border pl-3"
                        >
                          <p className="break-all text-xs">
                            {source.datasetKey}
                          </p>
                          <p className={`mt-1 ${codeClass}`}>
                            源版本：{source.versionId}
                          </p>
                          <p className={`mt-1 ${codeClass}`}>
                            采集任务：{source.runId}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
