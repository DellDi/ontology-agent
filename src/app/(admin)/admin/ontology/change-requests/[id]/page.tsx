import { notFound } from 'next/navigation';

import { createCompositionRoot, requireOntologyAdminSession } from '@/composition-root';
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

  const state = await requireOntologyAdminSession(`/admin/ontology/change-requests/${id}`);
  if (state.accessDeniedMessage) return null;

  const { adminUseCases } = createCompositionRoot().ontologyAdminRuntime;
  const detail = await adminUseCases.getChangeRequestDetail(id);
  if (!detail) {
    notFound();
  }

  return (
    <ChangeRequestDetailClient
      changeRequestId={id}
      initialData={{
        ...detail,
        capabilities: state.capabilities,
      }}
    />
  );
}
