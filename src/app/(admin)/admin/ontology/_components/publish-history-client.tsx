'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';

import { TableCell, TableRow } from '@/components/ui/table';

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
      flush
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
              <TableRow key={record.id} className="border-border/20 transition-colors hover:bg-muted/30">
                <TableCell className="px-5 py-4 align-top">
                  {version ? (
                    <>
                      <Link
                        href={`/admin/ontology/definitions?versionId=${version.id}`}
                        className="font-semibold text-foreground hover:text-primary hover:underline"
                      >
                        {version.semver}
                      </Link>
                      <div className="mt-0.5 text-xs text-muted-foreground">{version.displayName}</div>
                    </>
                  ) : (
                    <span className="font-mono text-sm text-muted-foreground">
                      {record.ontologyVersionId.slice(0, 8)}…
                    </span>
                  )}
                </TableCell>
                <TableCell className="px-5 py-4 align-top text-sm text-muted-foreground">
                  {record.publishedBy}
                </TableCell>
                <TableCell className="px-5 py-4 align-top text-sm text-muted-foreground tabular-nums">
                  {formatTimestamp(record.createdAt)}
                </TableCell>
                <TableCell className="px-5 py-4 align-top">
                  <Link
                    href="/admin/ontology/change-requests"
                    className="inline-flex text-nowrap items-center rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
                  >
                    {record.changeRequestIds.length} 变更
                  </Link>
                </TableCell>
                <TableCell className="px-5 py-4 align-top text-sm text-muted-foreground">
                  {record.publishNote || '—'}
                </TableCell>
              </TableRow>
            );
          })}
        </DataTable>
      )}
    </AdminCard>
  );
}
