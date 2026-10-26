'use client';

import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import {
  ingestionReleaseTaskSchema,
  ingestionReleaseTaskListSchema,
  type IngestionOverview,
  type IngestionReleaseTask,
} from '@/infrastructure/java-backend/ingestion-schema';
import { InlineError } from '@/app/_components/inline-error';
import { StatusBadge, formatTimestamp } from '../../_components/admin-shell';
import { dataName, updateFailureMessage } from './ingestion-presentation';

const errorSchema = z.object({
  error: z.string(),
  code: z.string(),
  traceId: z.string(),
});
const statuses = {
  pending: '等待执行',
  running: '更新中',
  completed: '更新完成',
  failed: '更新失败',
};
const buttonClass =
  'rounded-md bg-secondary px-4 py-2 text-sm hover:bg-secondary/70 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50';

export function IngestionReleasePanel({
  overview,
  initialTasks,
  canManage,
}: {
  overview: IngestionOverview;
  initialTasks: IngestionReleaseTask[];
  canManage: boolean;
}) {
  const [tasks, setTasks] = useState(initialTasks);
  const [showForm, setShowForm] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [sourceKey, setSourceKey] = useState('');
  const [productKeys, setProductKeys] = useState<string[]>([]);
  const [mode, setMode] = useState('full');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const requestRef = useRef<{ signature: string; id: string } | null>(null);
  const submitting = useRef(false);
  const hasActive = tasks.some(
    (task) => task.status === 'pending' || task.status === 'running',
  );
  const availableProducts = overview.products.filter(
    (product) =>
      product.status === 'active' &&
      product.datasetKeys.length > 0 &&
      product.datasetKeys.every((key) =>
        overview.datasets.some(
          (dataset) =>
            dataset.key === key &&
            dataset.sourceKey === sourceKey &&
            dataset.status === 'active',
        ),
      ),
  );

  useEffect(() => {
    if (!hasActive || pollError) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const response = await fetch('/api/admin/ingestion/release-tasks', {
          credentials: 'same-origin',
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('发布状态更新失败，请刷新页面查看。');
        const result = ingestionReleaseTaskListSchema.parse(
          await response.json(),
        );
        if (!disposed) setTasks(result.items);
      } catch (cause) {
        if (!disposed)
          setPollError(
            cause instanceof Error ? cause.message : '发布状态更新失败。',
          );
      } finally {
        if (!disposed) timer = setTimeout(refresh, 3000);
      }
    };
    timer = setTimeout(refresh, 3000);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [hasActive, pollError]);

  async function submit(previous?: IngestionReleaseTask) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    const payload = previous ? {} : { sourceKey, productKeys, mode };
    const path = previous
      ? `/api/admin/ingestion/release-tasks/${encodeURIComponent(previous.id)}/retry`
      : '/api/admin/ingestion/release-tasks';
    const signature = JSON.stringify([path, payload]);
    if (requestRef.current?.signature !== signature)
      requestRef.current = { signature, id: crypto.randomUUID() };
    try {
      const response = await fetch(path, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': requestRef.current.id,
        },
        body: JSON.stringify(payload),
      });
      const value: unknown = await response.json();
      if (!response.ok) {
        const detail = errorSchema.safeParse(value);
        throw new Error(
          detail.success
            ? `${detail.data.error}（${detail.data.code}；追踪号 ${detail.data.traceId}）`
            : `提交失败（HTTP ${response.status}）`,
        );
      }
      const task = ingestionReleaseTaskSchema.parse(value);
      setTasks((current) =>
        [task, ...current.filter((item) => item.id !== task.id)].slice(0, 50),
      );
      setNotice('数据更新已受理，页面关闭后仍会执行。可在下方查看进度。');
      setShowForm(false);
      setPollError(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : '提交结果未确认，请使用相同配置再次提交以查询原请求。',
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          最近 50 次数据更新 · 执行中的更新与失败任务优先展示
          {hasActive ? ' · 每 3 秒更新' : ''}
        </p>
        {canManage && (
          <button
            type="button"
            className={buttonClass}
            onClick={() => {
              if (!showForm) requestRef.current = null;
              setShowForm((value) => !value);
            }}
            disabled={busy}
            aria-expanded={showForm}
          >
            {showForm ? '收起表单' : '发起数据更新'}
          </button>
        )}
      </div>
      {notice && (
        <p role="status" className="break-all text-sm">
          {notice}
        </p>
      )}
      {error && (
        <InlineError title="提交未完成">
          更新请求未成功确认，请检查所选数据源、更新范围与模式。若响应中断，请保持相同配置再次提交，系统会返回同一请求。
          <details className="mt-2 text-xs"><summary className="w-fit cursor-pointer py-2">诊断信息</summary><p className="break-all">{error}</p></details>
        </InlineError>
      )}
      {pollError && (
        <InlineError title="状态更新已停止">
          未能读取最新进度，请重新查看页面确认执行状态。
          <details className="mt-2 text-xs"><summary className="w-fit cursor-pointer py-2">诊断信息</summary><p className="break-all">{pollError}</p></details>
        </InlineError>
      )}
      {canManage && showForm && (
        <form
          className="space-y-5 rounded-lg bg-muted/40 p-5"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2 text-sm">
              <span className="block font-medium">数据源</span>
              <select
                required
                value={sourceKey}
                disabled={busy}
                onChange={(event) => {
                  setSourceKey(event.target.value);
                  setProductKeys([]);
                }}
                className="w-full rounded-md border border-input bg-background px-3 py-2"
              >
                <option value="">请选择</option>
                {overview.sources
                  .filter((source) => source.status === 'active')
                  .map((source) => (
                    <option key={source.key} value={source.key}>
                      {dataName(source.key)}
                    </option>
                  ))}
              </select>
            </label>
            <label className="space-y-2 text-sm">
              <span className="block font-medium">采集模式</span>
              <select
                value={mode}
                disabled={busy}
                onChange={(event) => setMode(event.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2"
              >
                <option value="full">全量采集</option>
                <option value="incremental">增量采集</option>
                <option value="reconcile">全量对账</option>
              </select>
            </label>
          </div>
          <fieldset disabled={busy} className="space-y-3">
            <legend className="mb-3 text-sm font-medium">需要更新的数据</legend>
            {availableProducts.map((product) => (
              <label
                key={product.key}
                className="flex items-start gap-3 text-sm"
              >
                <input
                  className="mt-1"
                  type="checkbox"
                  checked={productKeys.includes(product.key)}
                  onChange={(event) =>
                    setProductKeys((current) =>
                      event.target.checked
                        ? [...current, product.key].sort()
                        : current.filter((key) => key !== product.key),
                    )
                  }
                />
                <span className="break-all">
                  {dataName(product.key)}
                </span>
              </label>
            ))}
            {availableProducts.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {sourceKey
                  ? '此数据源没有可选的数据产品。'
                  : '选择数据源后显示可发布的产品。'}
              </p>
            )}
          </fieldset>
          <p className="text-sm leading-6 text-muted-foreground">
            {mode === 'reconcile'
              ? '全量对账会忽略旧水位重新读取全部已启用数据集，建立新的完整快照；源中已不存在的记录不再进入新版本，历史版本保持不变。'
              : mode === 'full'
                ? '全量采集会重新读取该数据源的全部已启用数据集。'
                : '增量采集会读取配置了水位的数据集；没有可用基线时会明确失败。'}
            完成后发布为可供分析的数据；失败时保留已有发布数据。
          </p>
          <button
            disabled={busy || !sourceKey || productKeys.length === 0}
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
            type="submit"
          >
            {busy ? '提交中…' : '确认更新数据'}
          </button>
        </form>
      )}
      {tasks.length === 0 && (
        <p className="py-12 text-center text-sm text-muted-foreground">
          尚无更新请求。可发起数据更新，早期采集记录保留在“排查与历史记录”中。
        </p>
      )}
      {tasks.length > 0 && tasks.every(task => task.status === 'completed') && !showHistory ? <p className="py-4 text-sm text-muted-foreground">已加载的更新均已完成。</p> : null}
      {tasks.filter(task => task.status === 'completed').length ? <button type="button" className="py-2 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring" aria-expanded={showHistory} onClick={() => setShowHistory(value => !value)}>{showHistory ? '收起已完成更新' : `查看 ${tasks.filter(task => task.status === 'completed').length} 次已完成更新`}</button> : null}
      {tasks.filter(task => showHistory || task.status !== 'completed').sort((a, b) => {
        const priority = { running: 0, pending: 0, failed: 1, completed: 2 };
        return priority[a.status] - priority[b.status] || Date.parse(b.createdAt) - Date.parse(a.createdAt);
      }).map((task) => (
        <details key={task.id} open={task.status !== 'completed'} className="py-4">
          <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3 text-sm">
            <span className="break-all font-medium">
              {dataName(task.sourceKey)}
              <span className="ml-3 text-xs font-normal text-muted-foreground">
                {
                  { full: '全量', incremental: '增量', reconcile: '对账' }[
                    task.mode
                  ]
                }{' '}
                · {task.productKeys.length} 类数据
                {task.triggerType === 'scheduled' ? ' · 定时' : ''}
              </span>
            </span>
            <span className="flex items-center gap-3">
              <time className="text-xs text-muted-foreground">
                {formatTimestamp(task.createdAt)}
              </time>
              <StatusBadge
                tone={
                  task.status === 'failed'
                    ? 'danger'
                    : task.status === 'running'
                      ? 'warning'
                      : 'neutral'
                }
              >
                {statuses[task.status]}
              </StatusBadge>
              <span aria-hidden="true">⌄</span>
            </span>
          </summary>
          <div className="mt-4 space-y-3 text-sm">
            <p className="break-all">更新范围：{task.productKeys.map(dataName).join('、')}</p>
            <p className="text-muted-foreground">
              开始：{formatTimestamp(task.startedAt)} · 结束：
              {formatTimestamp(task.finishedAt)}
            </p>
            <details className="text-xs text-muted-foreground">
              <summary className="w-fit cursor-pointer py-2">诊断信息</summary>
              <dl className="space-y-2 break-all">
                <div><dt>任务编号</dt><dd>{task.id}</dd></div>
                <div><dt>数据源与产品编号</dt><dd>{task.sourceKey} · {task.productKeys.join('、')}</dd></div>
                <div><dt>触发来源</dt><dd>{task.triggerType === 'scheduled' ? '系统定时' : task.requestedBy}</dd></div>
                <div><dt>追踪号</dt><dd>{task.correlationId}</dd></div>
                {task.errorCode ? <div><dt>错误码</dt><dd>{task.errorCode}</dd></div> : null}
                {task.retryOf ? <div><dt>原失败任务</dt><dd>{task.retryOf}</dd></div> : null}
              </dl>
            </details>
            {task.status === 'completed' && (
              <>
                <p>这次更新已完成。具体分析采用的数据以结果中的数据出处为准。</p>
                <a
                  className={buttonClass}
                  href="/admin/ingestion?view=releases"
                >
                  查看历史版本
                </a>
              </>
            )}
            {canManage && task.status === 'failed' && (
              <>
                <p className="break-all text-destructive">{updateFailureMessage(task.errorCode)}</p>
                <p className="text-muted-foreground">
                  请先根据任务编号定位日志并修复原因。重新执行将保留此记录，并按原数据源、产品和模式创建新任务。
                </p>
                <button
                  type="button"
                  className={buttonClass}
                  disabled={busy}
                  onClick={() => void submit(task)}
                >
                  {busy ? '提交中…' : '已修复，重新执行'}
                </button>
              </>
            )}
          </div>
        </details>
      ))}
    </div>
  );
}
