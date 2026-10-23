import { redirect } from 'next/navigation';
import { readJavaBackend, JavaBackendHttpError } from '@/infrastructure/java-backend/read-client';
import { failureInspectionSchema } from '@/infrastructure/java-backend/inspection-schema';
import { InspectionView } from './inspection-view';

export default async function InspectionPage({ searchParams }: { searchParams: Promise<{ setId?: string; offset?: string }> }) {
  const params = await searchParams;
  const query = new URLSearchParams();
  if (params.setId) query.set('setId', params.setId);
  if (params.offset) query.set('offset', params.offset);
  let report;
  try {
    report = await readJavaBackend(`/api/easyv/inspection?${query}`, failureInspectionSchema);
  } catch (error) {
    if (error instanceof JavaBackendHttpError && error.status === 401) redirect('/login?next=%2Fworkspace%2Finspection');
    throw error;
  }
  return <InspectionView report={report} />;
}
