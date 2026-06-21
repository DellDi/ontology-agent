import Link from 'next/link';

import { createCompositionRoot, requireOntologyAdminSession } from '@/composition-root';

import {
  AdminCard,
  AdminPageHeader,
  DataTable,
  EmptyState,
  formatTimestamp,
} from '../../../_components/admin-shell';

export default async function OntologyAdminPublishHistoryPage() {
  const state = await requireOntologyAdminSession('/admin/ontology/publishes');
  if (state.accessDeniedMessage) return null;

  const { adminUseCases } = createCompositionRoot().ontologyAdminRuntime;
  const [records, versions] = await Promise.all([
    adminUseCases.listPublishHistory(50),
    adminUseCases.listVersions(100),
  ]);

  const versionMap = new Map(versions.map((v) => [v.id, v]));

  const tableHeaders = [
    { key: 'version', label: '版本' },
    { key: 'publisher', label: '发布人' },
    { key: 'publishedAt', label: '发布时间' },
    { key: 'changes', label: '变更数量' },
    { key: 'note', label: '发布备注' },
  ];

  return (
    <section className="space-y-6">
      <AdminPageHeader
        eyebrow="发布记录"
        title="发布记录"
        description="查看所有 ontology 版本的发布历史与对应的变更申请批次。"
      />

      <AdminCard title="">
        {records.length === 0 ? (
          <EmptyState
            title="暂无发布记录"
            description="还没有任何版本被发布。请在变更申请审批通过后执行发布操作。"
            action={{
              label: '查看变更申请',
              href: '/admin/ontology/change-requests',
            }}
          />
        ) : (
          <DataTable headers={tableHeaders}>
            {records.map((record) => {
              const version = versionMap.get(record.ontologyVersionId);
              return (
                <tr key={record.id}>
                  <td>
                    {version ? (
                      <Link
                        href={`/admin/ontology/definitions?versionId=${version.id}`}
                        className="font-semibold text-[color:var(--brand-700)] hover:underline"
                      >
                        {version.semver}
                      </Link>
                    ) : (
                      <span className="font-mono text-sm text-[color:var(--ink-600)]">
                        {record.ontologyVersionId.slice(0, 8)}...
                      </span>
                    )}
                    {version && (
                      <div className="text-xs text-[color:var(--ink-500)]">{version.displayName}</div>
                    )}
                  </td>
                  <td>
                    <span className="text-sm text-[color:var(--ink-600)]">{record.publishedBy}</span>
                  </td>
                  <td>
                    <span className="text-sm text-[color:var(--ink-600)]">
                      {formatTimestamp(record.createdAt)}
                    </span>
                  </td>
                  <td>
                    <Link
                      href={`/admin/ontology/change-requests`}
                      className="inline-flex items-center rounded-md bg-[color:var(--brand-100)] px-2.5 py-1 text-xs font-medium text-[color:var(--brand-700)] hover:bg-[color:var(--brand-300)]"
                    >
                      {record.changeRequestIds.length} 个变更
                    </Link>
                  </td>
                  <td>
                    {record.publishNote ? (
                      <span className="text-sm text-[color:var(--ink-700)]">{record.publishNote}</span>
                    ) : (
                      <span className="text-sm text-[color:var(--ink-500)]">—</span>
                    )}
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
