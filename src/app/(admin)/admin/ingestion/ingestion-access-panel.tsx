'use client';
import { useRef, useState } from 'react';
import {
  ingestionAccessSchema,
  type IngestionAccess,
  type IngestionOverview,
} from '@/infrastructure/java-backend/ingestion-schema';

export function IngestionAccessPanel({
  initialAccess,
  sources,
}: {
  initialAccess: IngestionAccess;
  sources: IngestionOverview['sources'];
}) {
  const [access, setAccess] = useState(initialAccess);
  const [sourceKey, setSourceKey] = useState(sources[0]?.key ?? '');
  const [organizationId, setOrganizationId] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState('');
  async function update(
    source: string,
    organization: string,
    enabled: boolean,
  ) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/admin/ingestion/access', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceKey: source,
          organizationId: organization,
          enabled,
        }),
      });
      if (!response.ok)
        throw new Error(
          `授权更新失败（HTTP ${response.status}），请刷新后重试。`,
        );
      setAccess(ingestionAccessSchema.parse(await response.json()));
      if (enabled) setOrganizationId('');
    } catch (error) {
      setError(error instanceof Error ? error.message : '授权更新失败。');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const control =
    'rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-50';
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        授权组织查看共享源的目录、任务和完整版本血缘。发布与重跑仍由平台管理员执行。此授权不改变业务分析的数据范围。
      </p>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void update(sourceKey, organizationId.trim(), true);
        }}
      >
        <label className="grid gap-2 text-sm">
          共享数据源
          <select
            className={control}
            value={sourceKey}
            onChange={(event) => setSourceKey(event.target.value)}
            disabled={busy}
          >
            {sources.map((source) => (
              <option key={source.key}>{source.key}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm">
          组织 ID
          <input
            className={control}
            required
            maxLength={200}
            value={organizationId}
            onChange={(event) => setOrganizationId(event.target.value)}
            disabled={busy}
          />
        </label>
        <button
          className={control}
          disabled={busy || !sourceKey || !organizationId.trim()}
          type="submit"
        >
          授予查看权限
        </button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {access.grants.length === 0 && (
        <p className="py-6 text-sm text-muted-foreground">
          尚未向组织授权共享源。
        </p>
      )}
      <ul className="divide-y divide-border">
        {access.grants.map((grant) => (
          <li
            key={`${grant.sourceKey}:${grant.organizationId}`}
            className="flex flex-wrap items-center justify-between gap-3 py-4"
          >
            <div className="min-w-0">
              <p className="break-all text-sm font-medium">
                {grant.organizationId}
              </p>
              <p className="break-all text-xs text-muted-foreground">
                {grant.sourceKey} · 仅查看
              </p>
            </div>
            <button
              type="button"
              className={control}
              disabled={busy}
              onClick={() =>
                void update(grant.sourceKey, grant.organizationId, false)
              }
            >
              撤销授权
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
