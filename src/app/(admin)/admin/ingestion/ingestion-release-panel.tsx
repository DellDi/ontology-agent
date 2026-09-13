'use client';

import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import {
  ingestionReleaseTaskSchema,
  ingestionReleaseTaskListSchema,
  type IngestionOverview,
  type IngestionReleaseTask,
} from '@/infrastructure/java-backend/ingestion-schema';
import { InlineError } from '@/app/_components/workbench/inline-error';
import { StatusBadge, formatTimestamp } from '../../_components/admin-shell';

const errorSchema = z.object({
  error: z.string(),
  code: z.string(),
  traceId: z.string(),
});
const statuses = {
  pending: '等待执行',
  running: '发布中',
  completed: '已完成',
  failed: '失败',
};
const buttonClass =
  'rounded-md border border-input px-4 py-2 text-sm hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50';

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
      setNotice(`发布任务已受理：${task.id}。页面关闭后仍会执行。`);
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
          平台最近 50 条发布任务中的可见记录 · 采集 → 物化 → 冻结版本
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
            {showForm ? '收起表单' : '新建发布'}
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
          {error} 若响应中断，请保持相同配置再次提交，系统会返回同一请求。
        </InlineError>
      )}
      {pollError && (
        <InlineError title="状态更新已停止">{pollError}</InlineError>
      )}
      {canManage && showForm && (
        <form
          className="space-y-5 border-y border-border py-5"
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
                      {source.key}
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
            <legend className="mb-3 text-sm font-medium">发布的数据产品</legend>
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
                  {product.key}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {product.domainKey}
                  </span>
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
            完成物化后将冻结所选产品的版本集，后续分析可引用新版本。
          </p>
          <button
            disabled={busy || !sourceKey || productKeys.length === 0}
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
            type="submit"
          >
            {busy ? '提交中…' : '确认并提交发布'}
          </button>
        </form>
      )}
      {tasks.length === 0 && (
        <p className="py-12 text-center text-sm text-muted-foreground">
          尚无页面提交的发布任务。历史采集记录可在“采集与物化”中查看。
        </p>
      )}
      {tasks.map((task) => (
        <details key={task.id} className="border-b border-border py-4">
          <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3 text-sm">
            <span className="break-all font-medium">
              {task.sourceKey}
              <span className="ml-3 text-xs font-normal text-muted-foreground">
                {
                  { full: '全量', incremental: '增量', reconcile: '对账' }[
                    task.mode
                  ]
                }{' '}
                · {task.productKeys.length} 个产品
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
          <div className="mt-4 space-y-3 border-l-2 border-border pl-4 text-sm">
            <p className="break-all font-mono text-xs text-muted-foreground">
              任务 / 版本集编号：{task.id}
            </p>
            <p className="break-all">数据产品：{task.productKeys.join('、')}</p>
            <p className="break-all text-muted-foreground">
              提交人：{task.requestedBy} · 追踪号：{task.correlationId}
            </p>
            <p className="text-muted-foreground">
              开始：{formatTimestamp(task.startedAt)} · 结束：
              {formatTimestamp(task.finishedAt)}
            </p>
            {task.retryOf && (
              <p className="break-all text-xs text-muted-foreground">
                原失败任务：{task.retryOf}
              </p>
            )}
            {task.status === 'completed' && (
              <>
                <p>所选产品已物化并冻结，版本集编号与任务编号一致。</p>
                <a
                  className={buttonClass}
                  href="/admin/ingestion?view=releases"
                >
                  查看版本溯源
                </a>
              </>
            )}
            {canManage && task.status === 'failed' && (
              <>
                <p className="break-all text-destructive">{task.errorCode}</p>
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
