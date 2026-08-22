import {
  getGovernancePublishHistory,
  getGovernanceVersions,
  requireJavaOntologyAdminSession,
} from '@/infrastructure/java-backend';

import {
  AdminPageHeader,
} from '../../../_components/admin-shell';
import { PublishHistoryClient } from '../_components/publish-history-client';

export default async function OntologyAdminPublishHistoryPage() {
  const state = await requireJavaOntologyAdminSession('/admin/ontology/publishes');
  if (state.accessDeniedMessage) return null;

  const [history, versions] = await Promise.all([
    getGovernancePublishHistory(50),
    getGovernanceVersions(100),
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
          records: history.items,
          versions: versions.items,
          capabilities: history.capabilities,
        }}
      />
    </section>
  );
}
