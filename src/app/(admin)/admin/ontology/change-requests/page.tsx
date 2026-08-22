import Link from 'next/link';

import { CHANGE_REQUEST_STATUSES } from '@/domain/ontology/governance';
import {
  getGovernanceChangeRequests,
  requireJavaOntologyAdminSession,
} from '@/infrastructure/java-backend';
import { Button } from '@/app/_components/button';

import {
  AdminPageHeader,
} from '../../../_components/admin-shell';
import { ChangeRequestListClient } from '../_components/change-request-list-client';

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
  const state = await requireJavaOntologyAdminSession('/admin/ontology/change-requests');
  if (state.accessDeniedMessage) return null;

  const params = (await searchParams) ?? {};
  const requestedStatus = readParam(params.status);
  const validStatus = CHANGE_REQUEST_STATUSES.find((s) => s === requestedStatus);

  const [selected, all] = await Promise.all([
    getGovernanceChangeRequests(validStatus, 100),
    getGovernanceChangeRequests(undefined, 100),
  ]);
  const items = selected.items;
  const allItems = all.items;

  const error = readParam(params.error);
  const success = readParam(params.ok);

  const statusCounts: Record<string, number> = {};
  for (const item of allItems) {
    statusCounts[item.status] = (statusCounts[item.status] ?? 0) + 1;
  }

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
        <div
          className="rounded-md border border-[color:var(--danger-500)]/40 bg-[color:color-mix(in_srgb,var(--danger-500)_10%,transparent)] px-4 py-3 text-sm leading-6 text-foreground"
          role="alert"
          aria-live="assertive"
        >
          {decodeURIComponent(error)}
        </div>
      ) : null}
      {success ? (
        <div
          className="rounded-md border border-[color:var(--success-500)]/40 bg-[color:color-mix(in_srgb,var(--success-500)_12%,transparent)] px-4 py-3 text-sm leading-6 text-foreground"
          role="status"
          aria-live="polite"
        >
          {decodeURIComponent(success)}
        </div>
      ) : null}

      <ChangeRequestListClient
        initialStatus={validStatus ?? 'all'}
        initialData={{
          items,
          allItems,
          activeStatus: validStatus ?? 'all',
          statusCounts,
          capabilities: all.capabilities,
        }}
      />
    </section>
  );
}
