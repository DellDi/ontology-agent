import Link from 'next/link';

import {
  CHANGE_REQUEST_STATUSES,
  CHANGE_TYPES,
  COMPATIBILITY_TYPES,
  TARGET_OBJECT_TYPES,
} from '@/domain/ontology/governance';
import { getOntologyAdminRuntime } from '@/infrastructure/ontology-admin';
import { requireOntologyAdminSession } from '@/infrastructure/session/admin-auth';

import {
  AdminCard,
  AdminPageHeader,
  StatusBadge,
  changeRequestStatusTone,
  formatTimestamp,
} from '../../../_components/admin-shell';

type CRListPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function readParam(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0];
  return undefined;
}

export default async function OntologyAdminChangeRequestsPage({
  searchParams,
}: CRListPageProps) {
  const state = await requireOntologyAdminSession('/admin/ontology/change-requests');
  if (state.accessDeniedMessage) return null;

  const params = (await searchParams) ?? {};
  const requestedStatus = readParam(params.status);
  const validStatus = CHANGE_REQUEST_STATUSES.find((s) => s === requestedStatus);

  const { adminUseCases } = getOntologyAdminRuntime();
  const [items, versions] = await Promise.all([
    validStatus
      ? adminUseCases.listChangeRequestsByStatus(validStatus)
      : adminUseCases.listAllChangeRequests(100),
    adminUseCases.listVersions(20),
  ]);

  const error = readParam(params.error);
  const success = readParam(params.ok);

  return (
    <section className="space-y-6">
      <AdminPageHeader
        eyebrow="Change Requests"
        title="变更申请管理"
        description="提交、审批与发布的最小操作面。所有写动作都通过受控服务端用例执行。"
        trailing={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/ontology/change-requests"
              className={validStatus ? 'secondary-button' : 'primary-button'}
            >
              全部
            </Link>
            {CHANGE_REQUEST_STATUSES.map((status) => (
              <Link
                key={status}
                href={`/admin/ontology/change-requests?status=${status}`}
                className={validStatus === status ? 'primary-button' : 'secondary-button'}
              >
                {status}
              </Link>
            ))}
          </div>
        }
      />

      {error ? (
        <div className="status-banner" data-tone="error">{decodeURIComponent(error)}</div>
      ) : null}
      {success ? (
        <div className="status-banner" data-tone="success">{decodeURIComponent(success)}</div>
      ) : null}

      {state.capabilities.canAuthor && versions.length > 0 ? (
        <AdminCard
          title="提交新的变更申请"
          description="变更先以 draft 形式落库，确认无误后再提交进入审批。"
        >
          <form
            method="post"
            action="/api/admin/ontology/change-requests"
            className="grid gap-3 md:grid-cols-2"
          >
            <label className="block">
              <span className="field-label">目标版本</span>
              <select className="field-input" name="ontologyVersionId" required>
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.semver} · {v.status}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="field-label">目标对象类型</span>
              <select className="field-input" name="targetObjectType" required>
                {TARGET_OBJECT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="field-label">业务键</span>
              <input className="field-input" name="targetObjectKey" required />
            </label>
            <label className="block">
              <span className="field-label">变更类型</span>
              <select className="field-input" name="changeType" required>
                {CHANGE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="field-label">兼容性</span>
              <select className="field-input" name="compatibilityType" required>
                {COMPATIBILITY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="field-label">影响范围（逗号或换行分隔）</span>
              <input className="field-input" name="impactScope" placeholder="metrics.x, factors.y" />
            </label>
            <label className="block md:col-span-2">
              <span className="field-label">标题</span>
              <input className="field-input" name="title" required maxLength={200} />
            </label>
            <label className="block md:col-span-2">
              <span className="field-label">描述</span>
              <textarea className="field-input min-h-[80px]" name="description" />
            </label>
            <label className="block md:col-span-2">
              <span className="field-label">兼容说明</span>
              <textarea className="field-input min-h-[60px]" name="compatibilityNote" />
            </label>
            <label className="block">
              <span className="field-label">变更前摘要 (JSON)</span>
              <textarea className="field-input min-h-[80px] font-mono text-xs" name="beforeSummary" placeholder='{"calculation":"by_amount"}' />
            </label>
            <label className="block">
              <span className="field-label">变更后摘要 (JSON)</span>
              <textarea className="field-input min-h-[80px] font-mono text-xs" name="afterSummary" placeholder='{"calculation":"by_count"}' />
            </label>
            <div className="md:col-span-2 flex justify-end">
              <button className="primary-button" type="submit">
                创建变更申请
              </button>
            </div>
          </form>
        </AdminCard>
      ) : null}

      <AdminCard
        title={validStatus ? `状态：${validStatus}（${items.length}）` : `全部变更申请（${items.length}）`}
      >
        {items.length === 0 ? (
          <div className="status-banner" data-tone="info">
            当前筛选下没有变更申请记录。
          </div>
        ) : (
          <div className="grid gap-3">
            {items.map((cr) => (
              <Link
                key={cr.id}
                href={`/admin/ontology/change-requests/${cr.id}`}
                className="rounded-3xl border border-[color:var(--line-200)] bg-white/76 p-5 transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-soft)]"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-base font-semibold text-[color:var(--ink-900)]">{cr.title}</p>
                    <p className="text-xs text-[color:var(--ink-600)]">
                      {cr.targetObjectType} · {cr.targetObjectKey} · {cr.changeType} · {cr.compatibilityType}
                    </p>
                  </div>
                  <StatusBadge tone={changeRequestStatusTone(cr.status)}>{cr.status}</StatusBadge>
                </div>
                <p className="mt-2 text-xs text-[color:var(--ink-600)]">
                  提交人 {cr.submittedBy} · 更新于 {formatTimestamp(cr.updatedAt)}
                </p>
              </Link>
            ))}
          </div>
        )}
      </AdminCard>
    </section>
  );
}
