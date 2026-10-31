import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getWorkspaceHome, JavaBackendHttpError } from '@/infrastructure/java-backend';
import { readJavaBackend } from '@/infrastructure/java-backend/read-client';
import { ingestionAccessSchema, ingestionHealthSchema } from '@/infrastructure/java-backend/ingestion-schema';
import { describeCapabilityScope } from '@/application/workspace/home';
import { IngestionHealthPanel } from '@/app/(admin)/admin/ingestion/ingestion-health-panel';

export default async function AnalysisDataPage() {
  let home;
  let health;
  let access;
  try {
    [home, health, access] = await Promise.all([
      getWorkspaceHome(),
      readJavaBackend('/api/admin/ingestion/health', ingestionHealthSchema),
      readJavaBackend('/api/admin/ingestion/access', ingestionAccessSchema),
    ]);
  } catch (error) {
    if (error instanceof JavaBackendHttpError && error.status === 401) redirect('/login?next=%2Fworkspace%2Fdata');
    throw error;
  }
  const domains = new Set(home.capabilities.filter(capability => capability.available).map(capability => capability.domainKey));
  const visibleHealth = { ...health, products: health.products.filter(product => domains.has(product.domainKey)) };

  return <section className="mx-auto w-full max-w-4xl space-y-10">
    <header className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">分析数据</h1>
        {access.canManage ? <Link href="/admin/ingestion" className="py-2 text-sm text-muted-foreground hover:text-foreground">管理数据更新 →</Link> : null}
      </div>
    </header>
    <section aria-label="分析能力" className="space-y-6">
      {home.capabilities.map(capability => <article key={`${capability.domainKey}:${capability.capabilityKey}`} className="space-y-3">
        <h2 className="text-base font-semibold">{capability.displayName}</h2>
        <p className="text-sm leading-6 text-muted-foreground">{describeCapabilityScope(capability)}</p>
        {capability.available ? <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <Link href={`/workspace?draft=${encodeURIComponent(capability.exampleQuestion)}`} className="py-2 text-primary hover:underline">填写分析示例 →</Link>
          {capability.domainKey === 'easyv' ? <Link href="/workspace/screens" className="py-2 text-primary hover:underline">浏览大屏 →</Link> : null}
        </div> : null}
      </article>)}
      {!home.capabilities.length ? <p className="text-sm text-muted-foreground">当前账号没有已开放的分析能力，请联系管理员。</p> : null}
    </section>
    {visibleHealth.products.length ? <IngestionHealthPanel health={visibleHealth} /> : null}
  </section>;
}
