'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';

import {
  AdminCard,
  DataTable,
  EmptyState,
  formatTimestamp,
} from '../../../_components/admin-shell';
import {
  listPublishHistory,
  ontologyAdminQueryKeys,
  type PublishHistoryData,
} from '../_lib/admin-api';

export function PublishHistoryClient({ initialData }: { initialData: PublishHistoryData }) {
  const { data = initialData, isFetching } = useQuery({
    queryKey: ontologyAdminQueryKeys.publishes.list(),
    queryFn: listPublishHistory,
    initialData,
  });

  const versionMap = new Map(data.versions.map((version) => [version.id, version]));

  const tableHeaders = [
    { key: 'version', label: '版本' },
    { key: 'publisher', label: '发布人' },
    { key: 'publishedAt', label: '发布时间' },
    { key: 'changes', label: '变更数量' },
    { key: 'note', label: '发布备注' },
  ];

  return (
    <AdminCard
      title=""
      trailing={isFetching ? <span className="text-xs text-muted-foreground">正在刷新...</span> : null}
    >
      {data.records.length === 0 ? (
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
          {data.records.map((record) => {
            const version = versionMap.get(record.ontologyVersionId);
            return (
              <tr key={record.id}>
                <td>
                  {version ? (
                    <Link
                      href={`/admin/ontology/definitions?versionId=${version.id}`}
                      className="font-semibold text-primary hover:underline"
                    >
                      {version.semver}
                    </Link>
                  ) : (
                    <span className="font-mono text-sm text-muted-foreground">
                      {record.ontologyVersionId.slice(0, 8)}...
                    </span>
                  )}
                  {version ? (
                    <div className="text-xs text-muted-foreground">{version.displayName}</div>
                  ) : null}
                </td>
                <td>
                  <span className="text-sm text-muted-foreground">{record.publishedBy}</span>
                </td>
                <td>
                  <span className="text-sm text-muted-foreground">
                    {formatTimestamp(record.createdAt)}
                  </span>
                </td>
                <td>
                  <Link
                    href="/admin/ontology/change-requests"
                    className="inline-flex items-center rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground hover:bg-accent/80"
                  >
                    {record.changeRequestIds.length} 个变更
                  </Link>
                </td>
                <td>
                  {record.publishNote ? (
                    <span className="text-sm text-muted-foreground">{record.publishNote}</span>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </DataTable>
      )}
    </AdminCard>
  );
}
