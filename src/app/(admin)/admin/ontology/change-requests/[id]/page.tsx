import { notFound } from 'next/navigation';

import {
  getGovernanceChangeRequest,
  getGovernanceVersions,
  JavaBackendHttpError,
  requireJavaOntologyAdminSession,
} from '@/infrastructure/java-backend';
import { ChangeRequestDetailClient } from '../../_components/change-request-detail-client';

type CRDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function OntologyAdminChangeRequestDetailPage({
  params,
  searchParams,
}: CRDetailPageProps) {
  const { id } = await params;
  await searchParams;

  const state = await requireJavaOntologyAdminSession(`/admin/ontology/change-requests/${id}`);
  if (state.accessDeniedMessage) return null;

  let detail;
  try {
    detail = await getGovernanceChangeRequest(id);
  } catch (error) {
    if (error instanceof JavaBackendHttpError && error.status === 404) notFound();
    throw error;
  }
  const versions = await getGovernanceVersions(100);

  return (
    <ChangeRequestDetailClient
      changeRequestId={id}
      initialData={{
        changeRequest: detail.changeRequest,
        approvalHistory: detail.approvals,
        version: versions.items.find((version) =>
          version.id === detail.changeRequest.ontologyVersionId) ?? null,
        capabilities: detail.capabilities,
      }}
    />
  );
}
