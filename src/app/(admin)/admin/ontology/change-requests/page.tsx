import Link from 'next/link';

import { CHANGE_REQUEST_STATUSES } from '@/domain/ontology/governance';
import { createCompositionRoot, requireOntologyAdminSession } from '@/composition-root';
import { Button } from '@/app/_components/button';

import {
  AdminCard,
  AdminPageHeader,
  DataTable,
  EmptyState,
  StatusBadge,
  TabBar,
  formatTimestamp,
} from '../../../_components/admin-shell';
import {
  getChangeTypeLabel,
  getCompatibilityLabel,
  getCRStatusLabel,
  getTargetObjectTypeLabel,
} from '../../../_lib/admin-labels';

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

  const { adminUseCases } = createCompositionRoot().ontologyAdminRuntime;
  const [items, allItems] = await Promise.all([
    validStatus
      ? adminUseCases.listChangeRequestsByStatus(validStatus)
      : adminUseCases.listAllChangeRequests(100),
    adminUseCases.listAllChangeRequests(100),
  ]);

  const error = readParam(params.error);
  const success = readParam(params.ok);

  const statusCounts: Record<string, number> = {};
  for (const item of allItems) {
    statusCounts[item.status] = (statusCounts[item.status] ?? 0) + 1;
  }

  const tabs = [
    { key: 'all', label: '全部', count: allItems.length },
    ...CHANGE_REQUEST_STATUSES.map((status) => {
      const labelInfo = getCRStatusLabel(status);
      return {
        key: status,
        label: labelInfo.label,
        count: statusCounts[status] ?? 0,
      };
    }),
  ];

  const tableHeaders = [
    { key: 'title', label: '标题' },
    { key: 'target', label: '目标对象' },
    { key: 'type', label: '变更类型' },
    { key: 'compatibility', label: '兼容性' },
    { key: 'status', label: '状态' },
    { key: 'submitter', label: '提交人' },
    { key: 'updated', label: '更新时间' },
  ];

  return (
    <section className="space-y-6">
      <AdminPageHeader
        eyebrow="变更申请"
        title="变更申请管理"
        description="管理本体变更的完整生命周期：创建、审批、发布。"
        trailing={
          state.capabilities.canAuthor ? (
            <Button asChild>
              <Link href="/admin/ontology/change-requests/new">
                新建变更申请
              </Link>
            </Button>
          ) : null
        }
      />

      {error ? (
        <div className="status-banner" data-tone="error">{decodeURIComponent(error)}</div>
      ) : null}
      {success ? (
        <div className="status-banner" data-tone="success">{decodeURIComponent(success)}</div>
      ) : null}

      <AdminCard title="">
        <TabBar
          tabs={tabs}
          activeKey={validStatus ?? 'all'}
          basePath="/admin/ontology/change-requests"
          paramName="status"
        />
      </AdminCard>

      <AdminCard title="">
        {items.length === 0 ? (
          <EmptyState
            title="暂无变更申请"
            description={
              validStatus
                ? `当前"${getCRStatusLabel(validStatus).label}"状态下没有变更记录。`
                : '还没有任何变更申请记录。点击"新建变更申请"开始第一个变更流程。'
            }
            action={
              state.capabilities.canAuthor
                ? { label: '新建变更申请', href: '/admin/ontology/change-requests/new' }
                : undefined
            }
          />
        ) : (
          <DataTable headers={tableHeaders}>
            {items.map((cr) => {
              const statusLabel = getCRStatusLabel(cr.status);
              const typeLabel = getChangeTypeLabel(cr.changeType);
              const compatLabel = getCompatibilityLabel(cr.compatibilityType);
              const objectTypeLabel = getTargetObjectTypeLabel(cr.targetObjectType);
              return (
                <tr key={cr.id}>
                  <td>
                    <Link
                      href={`/admin/ontology/change-requests/${cr.id}`}
                      className="font-semibold text-[color:var(--brand-700)] hover:underline"
                    >
                      {cr.title}
                    </Link>
                  </td>
                  <td>
                    <div className="text-sm">
                      <span className="font-medium">{objectTypeLabel}</span>
                      <span className="text-[color:var(--ink-500)]"> / {cr.targetObjectKey}</span>
                    </div>
                  </td>
                  <td>
                    <span className="text-sm">{typeLabel}</span>
                  </td>
                  <td>
                    <div className="text-sm">
                      <span>{compatLabel.label}</span>
                    </div>
                  </td>
                  <td>
                    <StatusBadge tone={statusLabel.tone}>{statusLabel.label}</StatusBadge>
                  </td>
                  <td>
                    <span className="text-sm text-[color:var(--ink-600)]">{cr.submittedBy}</span>
                  </td>
                  <td>
                    <span className="text-sm text-[color:var(--ink-600)]">
                      {formatTimestamp(cr.updatedAt)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </AdminCard>
    </section>
  );
}
