import { PrototypeCatalog } from './prototype-catalog';

export default async function ScreensPage({ searchParams }: { searchParams: Promise<{ appId?: string; setId?: string }> }) {
  const params = await searchParams;
  return <PrototypeCatalog key={`${params.appId ?? ''}:${params.setId ?? ''}`} initialObjectId={params.appId} initialVersion={params.setId} />;
}
