import { getOntologyAdminRuntime } from '@/infrastructure/ontology-admin';
import { requireOntologyAdminSession } from '@/infrastructure/session/admin-auth';

import {
  AdminCard,
  AdminPageHeader,
  formatTimestamp,
} from '../../../_components/admin-shell';

export default async function OntologyAdminPublishHistoryPage() {
  const state = await requireOntologyAdminSession('/admin/ontology/publishes');
  if (state.accessDeniedMessage) return null;

  const { adminUseCases } = getOntologyAdminRuntime();
  const records = await adminUseCases.listPublishHistory(50);

  return (
    <section className="space-y-6">
      <AdminPageHeader
        eyebrow="Publish History"
        title="发布记录"
        description="所有 ontology version 的发布记录与对应的变更申请批次。默认运行时只认 published 版本。"
      />

      <AdminCard title={`共 ${records.length} 条发布记录`}>
        {records.length === 0 ? (
          <div className="status-banner" data-tone="info">
            还没有任何发布记录。请在通过审批后从变更申请详情页执行发布。
          </div>
        ) : (
          <div className="grid gap-3">
            {records.map((record) => (
              <div
                key={record.id}
                className="rounded-3xl bg-white/76 p-5 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-[color:var(--ink-900)]">
                      版本 ID：{record.ontologyVersionId}
                    </p>
                    <p className="text-xs text-[color:var(--ink-600)]">
                      发布人 {record.publishedBy} · 发布时间 {formatTimestamp(record.createdAt)}
                    </p>
                  </div>
                  <span className="rounded-full bg-[color:var(--sky-100)] px-3 py-1 text-xs font-medium text-[color:var(--brand-700)]">
                    包含 {record.changeRequestIds.length} 个变更
                  </span>
                </div>
                {record.previousVersionId ? (
                  <p className="mt-2 text-xs text-[color:var(--ink-600)]">
                    上一生效版本：{record.previousVersionId}
                  </p>
                ) : null}
                {record.publishNote ? (
                  <p className="mt-2 text-xs leading-6 text-[color:var(--ink-700)]">
                    {record.publishNote}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </AdminCard>
    </section>
  );
}
