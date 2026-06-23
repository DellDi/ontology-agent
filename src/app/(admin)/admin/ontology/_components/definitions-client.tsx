'use client';

import { useMemo, useState } from 'react';

import { Button } from '@/app/_components/button';
import {
  AdminCard,
  DataTable,
  EmptyState,
  StatusBadge,
  formatTimestamp,
} from '../../../_components/admin-shell';
import { getVersionStatusLabel } from '../../../_lib/admin-labels';
import type { OntologyVersion } from '@/domain/ontology/models';
import { cn } from '@/app/_lib/cn';

export type DefinitionItem = {
  id: string;
  businessKey: string;
  displayName: string;
  status: string;
};

export type DefinitionGroup = {
  key: string;
  title: string;
  items: DefinitionItem[];
};

type DefinitionsClientProps = {
  version: OntologyVersion;
  versions: OntologyVersion[];
  groups: DefinitionGroup[];
  initialTab: string;
};

function getStatusTone(status: string): 'success' | 'warning' | 'neutral' {
  if (status === 'approved') return 'success';
  if (status === 'deprecated') return 'warning';
  return 'neutral';
}

function getStatusLabel(status: string): string {
  if (status === 'approved') return '已批准';
  if (status === 'deprecated') return '已废弃';
  if (status === 'draft') return '草稿';
  return status;
}

export function DefinitionsClient({
  version,
  versions,
  groups,
  initialTab,
}: DefinitionsClientProps) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [searchText, setSearchText] = useState('');

  const tabs = useMemo(
    () => [
      { key: 'all', label: '全部', count: groups.reduce((sum, group) => sum + group.items.length, 0) },
      ...groups
        .filter((group) => group.items.length > 0)
        .map((group) => ({ key: group.key, label: group.title, count: group.items.length })),
    ],
    [groups],
  );

  const normalizedSearch = searchText.trim().toLowerCase();
  const filteredGroups = useMemo(() => {
    const tabbedGroups = activeTab === 'all'
      ? groups.filter((group) => group.items.length > 0)
      : groups.filter((group) => group.key === activeTab);

    if (!normalizedSearch) return tabbedGroups;

    return tabbedGroups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => {
          const haystack = `${item.displayName} ${item.businessKey} ${item.status}`.toLowerCase();
          return haystack.includes(normalizedSearch);
        }),
      }))
      .filter((group) => group.items.length > 0);
  }, [activeTab, groups, normalizedSearch]);

  const tableHeaders = [
    { key: 'name', label: '名称' },
    { key: 'key', label: '业务键' },
    { key: 'status', label: '状态' },
  ];

  return (
    <>
      <AdminCard title="版本信息">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg bg-muted p-4">
            <p className="text-xs tracking-[0.12em] text-primary">版本名称</p>
            <p className="mt-1 text-base font-semibold text-foreground">{version.displayName}</p>
          </div>
          <div className="rounded-lg bg-muted p-4">
            <p className="text-xs tracking-[0.12em] text-primary">发布时间</p>
            <p className="mt-1 text-base text-foreground">{formatTimestamp(version.publishedAt)}</p>
          </div>
          <div className="rounded-lg bg-muted p-4">
            <p className="text-xs tracking-[0.12em] text-primary">创建时间</p>
            <p className="mt-1 text-base text-foreground">{formatTimestamp(version.createdAt)}</p>
          </div>
        </div>
        {version.description ? (
          <p className="mt-3 text-sm text-muted-foreground">{version.description}</p>
        ) : null}
      </AdminCard>

      <AdminCard title="">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <form method="get" className="flex items-center gap-2">
              <select
                name="versionId"
                defaultValue={version.id}
                className="h-11 w-full min-w-[200px] rounded-md border border-input bg-card px-3.5 py-2 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/40"
              >
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.semver} · {v.displayName} · {getVersionStatusLabel(v.status)}
                  </option>
                ))}
              </select>
              <Button variant="secondary" type="submit" className="py-2 text-sm">
                切换版本
              </Button>
            </form>
            <input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="搜索名称、业务键或状态"
              className="h-11 min-w-[240px] rounded-md border border-input bg-card px-3.5 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/40"
            />
          </div>
          <div className="flex flex-wrap border-b border-border">
            {tabs.map((tab) => {
              const isActive = tab.key === activeTab;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
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
        </div>
      </AdminCard>

      {filteredGroups.length === 0 ? (
        <AdminCard title="">
          <EmptyState
            title="暂无定义数据"
            description={searchText ? '没有匹配当前搜索条件的定义。' : '当前版本下还没有任何定义记录。请通过变更申请流程添加。'}
          />
        </AdminCard>
      ) : (
        filteredGroups.map((group) => (
          <AdminCard
            key={group.key}
            title={group.title}
            description={`共 ${group.items.length} 条`}
          >
            <DataTable headers={tableHeaders}>
              {group.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <span className="font-semibold text-foreground">{item.displayName}</span>
                  </td>
                  <td>
                    <span className="font-mono text-sm text-muted-foreground">{item.businessKey}</span>
                  </td>
                  <td>
                    <StatusBadge tone={getStatusTone(item.status)}>
                      {getStatusLabel(item.status)}
                    </StatusBadge>
                  </td>
                </tr>
              ))}
            </DataTable>
          </AdminCard>
        ))
      )}
    </>
  );
}
