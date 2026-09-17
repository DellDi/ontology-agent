import { redirect } from 'next/navigation';

import { describeCapabilityScope } from '@/application/workspace/home';
import {
  getWorkspaceHome,
  JavaBackendHttpError,
} from '@/infrastructure/java-backend';

export default async function WorkspaceMePage() {
  let home;
  try {
    home = await getWorkspaceHome();
  } catch (error) {
    if (error instanceof JavaBackendHttpError && error.status === 401) {
      redirect('/login?next=/workspace/me');
    }
    throw error;
  }

  const { viewer } = home;
  const projectNames = new Map(home.projects.map((project) => [project.id, project.name]));

  return (
    <section className="mx-auto max-w-2xl space-y-8" data-testid="workspace-me-page">
      <h1 className="text-xl font-semibold tracking-tight text-foreground">个人中心</h1>

      <section aria-label="账号信息" className="rounded-md border border-border bg-card p-6">
        <h2 className="text-sm font-semibold text-foreground">账号信息</h2>
        <dl className="mt-4 space-y-3 text-sm">
          <div className="flex gap-4">
            <dt className="w-20 shrink-0 text-muted-foreground">账号名称</dt>
            <dd className="text-foreground">{viewer.displayName}</dd>
          </div>
          <div className="flex gap-4">
            <dt className="w-20 shrink-0 text-muted-foreground">账号 ID</dt>
            <dd className="text-foreground">{viewer.userId}</dd>
          </div>
          <div className="flex gap-4">
            <dt className="w-20 shrink-0 text-muted-foreground">所属组织</dt>
            <dd className="text-foreground">{viewer.scope.organizationId}</dd>
          </div>
          <div className="flex gap-4">
            <dt className="w-20 shrink-0 text-muted-foreground">角色</dt>
            <dd className="text-foreground">
              {viewer.scope.roleCodes.length ? viewer.scope.roleCodes.join('、') : '未分配'}
            </dd>
          </div>
          <div className="flex gap-4">
            <dt className="w-20 shrink-0 text-muted-foreground">项目范围</dt>
            <dd className="text-foreground">
              {viewer.scope.projectIds.length
                ? viewer.scope.projectIds.map((id) => projectNames.get(id) ?? id).join('、')
                : '全部可见'}
            </dd>
          </div>
        </dl>
      </section>

      <section aria-label="能力与范围" className="rounded-md border border-border bg-card p-6">
        <h2 className="text-sm font-semibold text-foreground">能力与范围</h2>
        <p className="mt-2 text-xs text-muted-foreground">
          仅列出当前环境已启用的能力。可发起表示已获授权；实际分析还需要可用的数据。
        </p>
        {home.capabilities.length ? (
          <ul className="mt-4 divide-y divide-border">
            {home.capabilities.map((capability) => (
              <li key={`${capability.domainKey}:${capability.capabilityKey}`} className="py-3">
                <p className="font-medium text-foreground">
                  {capability.displayName}
                  <span className="ml-3 text-xs font-normal text-muted-foreground">
                    {capability.available ? '可发起' : '不可用'}
                  </span>
                </p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {describeCapabilityScope(capability)}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">当前环境尚未开放分析能力，请联系管理员。</p>
        )}
      </section>
    </section>
  );
}
