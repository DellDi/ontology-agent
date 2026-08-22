import Link from 'next/link';

import {
  getGovernanceVersions,
  requireJavaOntologyAdminSession,
} from '@/infrastructure/java-backend';
import { Button } from '@/app/_components/button';

import {
  AdminCard,
  AdminPageHeader,
} from '../../../../_components/admin-shell';
import { NewChangeRequestClient } from '../../_components/new-change-request-client';

export default async function NewChangeRequestPage() {
  const state = await requireJavaOntologyAdminSession('/admin/ontology/change-requests/new');
  if (state.accessDeniedMessage) return null;

  if (!state.capabilities.canAuthor) {
    return (
      <section className="space-y-6">
        <AdminPageHeader
          eyebrow="变更申请"
          title="权限不足"
          description="您没有创建变更申请的权限。"
        />
        <AdminCard title="">
          <p className="text-sm text-muted-foreground">
            请联系管理员获取变更申请的创建权限。
          </p>
          <Button variant="secondary" asChild className="mt-4">
            <Link href="/admin/ontology/change-requests">
              返回变更申请列表
            </Link>
          </Button>
        </AdminCard>
      </section>
    );
  }

  const versions = (await getGovernanceVersions(20)).items;

  if (versions.length === 0) {
    return (
      <section className="space-y-6">
        <AdminPageHeader
          eyebrow="变更申请"
          title="无法创建"
          description="当前没有可用的目标版本，请先通过 bootstrap 流程创建首个版本。"
        />
        <Button variant="secondary" asChild>
          <Link href="/admin/ontology/change-requests">
            返回变更申请列表
          </Link>
        </Button>
      </section>
    );
  }

  return <NewChangeRequestClient versions={versions} />;
}
