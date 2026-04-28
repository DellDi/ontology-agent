import { getOntologyAdminRuntime } from '@/infrastructure/ontology-admin';
import { requireOntologyAdminSession } from '@/infrastructure/session/admin-auth';

import {
  AdminCard,
  AdminPageHeader,
  StatusBadge,
  formatTimestamp,
} from '../../../_components/admin-shell';

type DefinitionsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function readParam(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0];
  return undefined;
}

export default async function OntologyAdminDefinitionsPage({
  searchParams,
}: DefinitionsPageProps) {
  const state = await requireOntologyAdminSession('/admin/ontology/definitions');
  if (state.accessDeniedMessage) return null;

  const params = (await searchParams) ?? {};
  const requestedVersionId = readParam(params.versionId);

  const { adminUseCases } = getOntologyAdminRuntime();

  const view = requestedVersionId
    ? await adminUseCases.loadDefinitionsForVersion(requestedVersionId)
    : await adminUseCases.loadDefinitionsForCurrentVersion();
  const versions = await adminUseCases.listVersions(20);

  if (!view) {
    return (
      <section className="space-y-6">
        <AdminPageHeader
          eyebrow="Definitions"
          title="本体定义查阅"
          description="查询当前生效版本下的实体、指标、因素、计划模板等正式定义。"
        />
        <article className="status-banner" data-tone="info">
          当前还没有任何 ontology version 可供查阅。请先通过 Story 9.7 的 bootstrap 流程或正式的变更申请创建首个版本。
        </article>
      </section>
    );
  }

  const { version, definitions } = view;

  const groups: Array<{ title: string; items: Array<{ id: string; key: string; name: string; status: string }> }> = [
    {
      title: '实体定义',
      items: definitions.entities.map((d) => ({
        id: d.id,
        key: d.businessKey,
        name: d.displayName,
        status: d.status,
      })),
    },
    {
      title: '指标定义',
      items: definitions.metrics.map((d) => ({
        id: d.id,
        key: d.businessKey,
        name: d.displayName,
        status: d.status,
      })),
    },
    {
      title: '指标变体',
      items: definitions.metricVariants.map((d) => ({
        id: d.id,
        key: d.businessKey,
        name: d.displayName,
        status: d.status,
      })),
    },
    {
      title: '因素定义',
      items: definitions.factors.map((d) => ({
        id: d.id,
        key: d.businessKey,
        name: d.displayName,
        status: d.status,
      })),
    },
    {
      title: '计划步骤模板',
      items: definitions.planStepTemplates.map((d) => ({
        id: d.id,
        key: d.businessKey,
        name: d.displayName,
        status: d.status,
      })),
    },
    {
      title: '时间语义',
      items: definitions.timeSemantics.map((d) => ({
        id: d.id,
        key: d.businessKey,
        name: d.displayName,
        status: d.status,
      })),
    },
    {
      title: '因果边',
      items: definitions.causalityEdges.map((d) => ({
        id: d.id,
        key: d.businessKey,
        name: d.displayName,
        status: d.status,
      })),
    },
    {
      title: '证据类型',
      items: definitions.evidenceTypes.map((d) => ({
        id: d.id,
        key: d.businessKey,
        name: d.displayName,
        status: d.status,
      })),
    },
  ];

  return (
    <section className="space-y-6">
      <AdminPageHeader
        eyebrow="Definitions"
        title="本体定义查阅"
        description="按版本查阅当前 ontology 治理对象。首期只读，变更请走变更申请。"
        trailing={
          <div className="rounded-full border border-[color:var(--line-200)] bg-white/80 px-4 py-2 text-sm font-medium text-[color:var(--brand-700)]">
            版本 {version.semver} · {version.status}
          </div>
        }
      />

      <AdminCard
        title="版本切换"
        description="选择历史版本进行回溯查阅；默认聚焦当前生效版本。"
      >
        <form method="get" className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-[color:var(--ink-600)]" htmlFor="versionId">
            选择版本
          </label>
          <select
            id="versionId"
            name="versionId"
            defaultValue={version.id}
            className="field-input min-w-[260px]"
          >
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.semver} · {v.displayName} · {v.status}
                {v.publishedAt ? ' · 已发布' : ''}
              </option>
            ))}
          </select>
          <button className="primary-button" type="submit">
            查看
          </button>
        </form>
      </AdminCard>

      <AdminCard
        title={`版本元数据：${version.displayName}`}
        description={version.description ?? '无描述'}
      >
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-3xl bg-white/76 p-4 text-sm">
            <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--brand-700)]">状态</p>
            <p className="mt-1 text-base font-semibold text-[color:var(--ink-900)]">{version.status}</p>
          </div>
          <div className="rounded-3xl bg-white/76 p-4 text-sm">
            <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--brand-700)]">发布时间</p>
            <p className="mt-1 text-base text-[color:var(--ink-900)]">{formatTimestamp(version.publishedAt)}</p>
          </div>
          <div className="rounded-3xl bg-white/76 p-4 text-sm">
            <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--brand-700)]">创建时间</p>
            <p className="mt-1 text-base text-[color:var(--ink-900)]">{formatTimestamp(version.createdAt)}</p>
          </div>
        </div>
      </AdminCard>

      {groups.map((group) => (
        <AdminCard
          key={group.title}
          title={group.title}
          description={`共 ${group.items.length} 条`}
        >
          {group.items.length === 0 ? (
            <div className="status-banner" data-tone="info">该分类暂无定义。</div>
          ) : (
            <div className="grid gap-2">
              {group.items.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white/76 p-4"
                >
                  <div>
                    <p className="text-base font-semibold text-[color:var(--ink-900)]">
                      {item.name}
                    </p>
                    <p className="text-xs text-[color:var(--ink-600)]">{item.key}</p>
                  </div>
                  <StatusBadge tone={item.status === 'approved' ? 'success' : item.status === 'deprecated' ? 'warning' : 'neutral'}>
                    {item.status}
                  </StatusBadge>
                </div>
              ))}
            </div>
          )}
        </AdminCard>
      ))}
    </section>
  );
}
