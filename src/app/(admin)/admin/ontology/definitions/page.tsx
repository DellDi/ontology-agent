import { createCompositionRoot, requireOntologyAdminSession } from '@/composition-root';
import { Button } from '@/app/_components/button';

import {
  AdminCard,
  AdminPageHeader,
  DataTable,
  EmptyState,
  StatusBadge,
  TabBar,
  formatTimestamp,
} from '../../../_components/admin-shell';
import { getVersionStatusLabel } from '../../../_lib/admin-labels';

type DefinitionsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function readParam(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0];
  return undefined;
}

type DefinitionItem = {
  id: string;
  businessKey: string;
  displayName: string;
  status: string;
};

type DefinitionGroup = {
  key: string;
  title: string;
  items: DefinitionItem[];
};

function getDefinitionGroups(definitions: {
  entities: DefinitionItem[];
  metrics: DefinitionItem[];
  metricVariants: DefinitionItem[];
  factors: DefinitionItem[];
  planStepTemplates: DefinitionItem[];
  timeSemantics: DefinitionItem[];
  causalityEdges: DefinitionItem[];
  evidenceTypes: DefinitionItem[];
}): DefinitionGroup[] {
  return [
    { key: 'entities', title: '实体定义', items: definitions.entities },
    { key: 'metrics', title: '指标定义', items: definitions.metrics },
    { key: 'metricVariants', title: '指标变体', items: definitions.metricVariants },
    { key: 'factors', title: '因素定义', items: definitions.factors },
    { key: 'planStepTemplates', title: '计划步骤模板', items: definitions.planStepTemplates },
    { key: 'timeSemantics', title: '时间语义', items: definitions.timeSemantics },
    { key: 'causalityEdges', title: '因果边', items: definitions.causalityEdges },
    { key: 'evidenceTypes', title: '证据类型', items: definitions.evidenceTypes },
  ];
}

function getStatusTone(status: string): 'success' | 'warning' | 'neutral' {
  if (status === 'approved') return 'success';
  if (status === 'deprecated') return 'warning';
  return 'neutral';
}

function getStatusLabel(status: string): string {
  if (status === 'approved') return '已批准';
  if (status === 'deprecated') return '已废弃';
  if (status === 'draft') return '草稿';
  return status;
}

export default async function OntologyAdminDefinitionsPage({
  searchParams,
}: DefinitionsPageProps) {
  const state = await requireOntologyAdminSession('/admin/ontology/definitions');
  if (state.accessDeniedMessage) return null;

  const params = (await searchParams) ?? {};
  const requestedVersionId = readParam(params.versionId);
  const activeTab = readParam(params.tab) ?? 'all';

  const { adminUseCases } = createCompositionRoot().ontologyAdminRuntime;

  const view = requestedVersionId
    ? await adminUseCases.loadDefinitionsForVersion(requestedVersionId)
    : await adminUseCases.loadDefinitionsForCurrentVersion();
  const versions = await adminUseCases.listVersions(20);

  if (!view) {
    return (
      <section className="space-y-6">
        <AdminPageHeader
          eyebrow="定义管理"
          title="本体定义查阅"
          description="查询当前生效版本下的实体、指标、因素、计划模板等正式定义。"
        />
        <article
          className="rounded-md border border-[color:var(--brand-300)]/40 bg-[color:color-mix(in_srgb,var(--brand-500)_10%,transparent)] px-4 py-3 text-sm leading-6 text-foreground"
          role="status"
          aria-live="polite"
        >
          当前还没有任何 ontology version 可供查阅。请先通过 bootstrap 流程或正式的变更申请创建首个版本。
        </article>
      </section>
    );
  }

  const { version, definitions } = view;
  const groups = getDefinitionGroups(definitions);

  const tabs = [
    { key: 'all', label: '全部', count: groups.reduce((sum, g) => sum + g.items.length, 0) },
    ...groups
      .filter((g) => g.items.length > 0)
      .map((g) => ({ key: g.key, label: g.title, count: g.items.length })),
  ];

  const tableHeaders = [
    { key: 'name', label: '名称' },
    { key: 'key', label: '业务键' },
    { key: 'status', label: '状态' },
  ];

  const displayGroups = activeTab === 'all'
    ? groups.filter((g) => g.items.length > 0)
    : groups.filter((g) => g.key === activeTab);

  return (
    <section className="space-y-6">
      <AdminPageHeader
        eyebrow="定义管理"
        title="本体定义查阅"
        description="按版本查阅当前 ontology 治理对象。首期只读，变更请走变更申请流程。"
        trailing={
          <div className="flex items-center gap-3">
            <form method="get" className="flex items-center gap-2">
              <select
                name="versionId"
                defaultValue={version.id}
                className="h-11 w-full min-w-[200px] rounded-md border border-input bg-card px-3.5 py-2 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/40"
              >
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.semver} · {v.displayName} · {getVersionStatusLabel(v.status)}
                  </option>
                ))}
              </select>
              <Button variant="secondary" type="submit" className="py-2 text-sm">
                切换版本
              </Button>
            </form>
            <StatusBadge tone="success">
              {version.semver} · {getVersionStatusLabel(version.status)}
            </StatusBadge>
          </div>
        }
      />

      <AdminCard title="版本信息">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg bg-muted p-4">
            <p className="text-xs tracking-[0.12em] text-primary">版本名称</p>
            <p className="mt-1 text-base font-semibold text-foreground">{version.displayName}</p>
          </div>
          <div className="rounded-lg bg-muted p-4">
            <p className="text-xs tracking-[0.12em] text-primary">发布时间</p>
            <p className="mt-1 text-base text-foreground">{formatTimestamp(version.publishedAt)}</p>
          </div>
          <div className="rounded-lg bg-muted p-4">
            <p className="text-xs tracking-[0.12em] text-primary">创建时间</p>
            <p className="mt-1 text-base text-foreground">{formatTimestamp(version.createdAt)}</p>
          </div>
        </div>
        {version.description && (
          <p className="mt-3 text-sm text-muted-foreground">{version.description}</p>
        )}
      </AdminCard>

      <AdminCard title="">
        <TabBar
          tabs={tabs}
          activeKey={activeTab}
          basePath="/admin/ontology/definitions"
          paramName="tab"
        />
      </AdminCard>

      {displayGroups.length === 0 ? (
        <AdminCard title="">
          <EmptyState
            title="暂无定义数据"
            description="当前版本下还没有任何定义记录。请通过变更申请流程添加。"
          />
        </AdminCard>
      ) : (
        displayGroups.map((group) => (
          <AdminCard
            key={group.key}
            title={group.title}
            description={`共 ${group.items.length} 条`}
          >
            <DataTable headers={tableHeaders}>
              {group.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <span className="font-semibold text-foreground">{item.displayName}</span>
                  </td>
                  <td>
                    <span className="font-mono text-sm text-muted-foreground">{item.businessKey}</span>
                  </td>
                  <td>
                    <StatusBadge tone={getStatusTone(item.status)}>
                      {getStatusLabel(item.status)}
                    </StatusBadge>
                  </td>
                </tr>
              ))}
            </DataTable>
          </AdminCard>
        ))
      )}
    </section>
  );
}
