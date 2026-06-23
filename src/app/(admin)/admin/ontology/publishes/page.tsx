import { createCompositionRoot, requireOntologyAdminSession } from '@/composition-root';

import {
  AdminPageHeader,
} from '../../../_components/admin-shell';
import { PublishHistoryClient } from '../_components/publish-history-client';

export default async function OntologyAdminPublishHistoryPage() {
  const state = await requireOntologyAdminSession('/admin/ontology/publishes');
  if (state.accessDeniedMessage) return null;

  const { adminUseCases } = createCompositionRoot().ontologyAdminRuntime;
  const [records, versions] = await Promise.all([
    adminUseCases.listPublishHistory(50),
    adminUseCases.listVersions(100),
  ]);

  return (
    <section className="space-y-6">
      <AdminPageHeader
        eyebrow="发布记录"
        title="发布记录"
        description="查看所有 ontology 版本的发布历史与对应的变更申请批次。"
      />

      <PublishHistoryClient
        initialData={{
          records,
          versions,
          capabilities: state.capabilities,
        }}
      />
    </section>
  );
}
