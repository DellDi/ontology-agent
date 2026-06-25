'use client';

import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { TableCell, TableRow } from '@/components/ui/table';
import {
  CHANGE_REQUEST_STATUSES,
  type ChangeRequestStatus,
} from '@/domain/ontology/governance';
import {
  AdminCard,
  DataTable,
  EmptyState,
  StatusBadge,
  formatTimestamp,
} from '../../../_components/admin-shell';
import {
  getChangeTypeLabel,
  getCompatibilityLabel,
  getCRStatusLabel,
  getTargetObjectTypeLabel,
} from '../../../_lib/admin-labels';
import {
  getChangeRequestDetail,
  listChangeRequests,
  ontologyAdminQueryKeys,
  type ChangeRequestListData,
} from '../_lib/admin-api';
import { cn } from '@/app/_lib/cn';

type ListStatus = ChangeRequestStatus | 'all';

type ChangeRequestListClientProps = {
  initialData: ChangeRequestListData;
  initialStatus: ListStatus;
};

export function ChangeRequestListClient({
  initialData,
  initialStatus,
}: ChangeRequestListClientProps) {
  const [activeStatus, setActiveStatus] = useState<ListStatus>(initialStatus);
  const queryClient = useQueryClient();

  const { data = initialData, isFetching } = useQuery({
    queryKey: ontologyAdminQueryKeys.changeRequests.list(activeStatus),
    queryFn: () => listChangeRequests(activeStatus),
    initialData: activeStatus === initialStatus ? initialData : undefined,
  });

  const tabs = [
    { key: 'all' as const, label: '全部', count: data.allItems.length },
    ...CHANGE_REQUEST_STATUSES.map((status) => {
      const labelInfo = getCRStatusLabel(status);
      return {
        key: status,
        label: labelInfo.label,
        count: data.statusCounts[status] ?? 0,
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

  function prefetchDetail(id: string) {
    void queryClient.prefetchQuery({
      queryKey: ontologyAdminQueryKeys.changeRequests.detail(id),
      queryFn: () => getChangeRequestDetail(id),
      staleTime: 30_000,
    });
  }

  return (
    <>
      <AdminCard title="">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap border-b border-border">
            {tabs.map((tab) => {
              const isActive = tab.key === activeStatus;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveStatus(tab.key)}
                  className={cn(
                    '-mb-px inline-flex items-center gap-1.5 border-b-2 px-4 py-3 text-sm font-medium transition-colors',
                    isActive
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  {tab.label}
                  <span
                    className={cn(
                      'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold',
                      isActive
                        ? 'bg-accent text-primary'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>
          {isFetching ? (
            <span className="text-xs text-muted-foreground">正在刷新列表...</span>
          ) : null}
        </div>
      </AdminCard>

      <AdminCard title="" flush>
        {data.items.length === 0 ? (
          <EmptyState
            title="暂无变更申请"
            description={
              activeStatus !== 'all'
                ? `当前"${getCRStatusLabel(activeStatus).label}"状态下没有变更记录。`
                : '还没有任何变更申请记录。点击"新建变更申请"开始第一个变更流程。'
            }
            action={
              data.capabilities.canAuthor
                ? { label: '新建变更申请', href: '/admin/ontology/change-requests/new' }
                : undefined
            }
          />
        ) : (
          <DataTable headers={tableHeaders}>
            {data.items.map((cr) => {
              const statusLabel = getCRStatusLabel(cr.status);
              const typeLabel = getChangeTypeLabel(cr.changeType);
              const compatLabel = getCompatibilityLabel(cr.compatibilityType);
              const objectTypeLabel = getTargetObjectTypeLabel(cr.targetObjectType);
              return (
                <TableRow key={cr.id} className="border-border/20 transition-colors hover:bg-muted/30">
                  <TableCell className="px-5 py-4 align-top">
                    <Link
                      href={`/admin/ontology/change-requests/${cr.id}`}
                      onMouseEnter={() => prefetchDetail(cr.id)}
                      onFocus={() => prefetchDetail(cr.id)}
                      className="font-semibold text-foreground hover:text-primary hover:underline"
                    >
                      {cr.title}
                    </Link>
                  </TableCell>
                  <TableCell className="px-5 py-4 align-top text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">{objectTypeLabel}</span>
                    <span> / {cr.targetObjectKey}</span>
                  </TableCell>
                  <TableCell className="px-5 py-4 align-top text-sm text-muted-foreground">
                    {typeLabel}
                  </TableCell>
                  <TableCell className="px-5 py-4 align-top text-sm text-muted-foreground">
                    {compatLabel.label}
                  </TableCell>
                  <TableCell className="px-5 py-4 align-top">
                    <StatusBadge tone={statusLabel.tone}>{statusLabel.label}</StatusBadge>
                  </TableCell>
                  <TableCell className="px-5 py-4 align-top text-sm text-muted-foreground">
                    {cr.submittedBy}
                  </TableCell>
                  <TableCell className="px-5 py-4 align-top text-sm text-muted-foreground tabular-nums">
                    {formatTimestamp(cr.updatedAt)}
                  </TableCell>
                </TableRow>
              );
            })}
          </DataTable>
        )}
      </AdminCard>
    </>
  );
}
