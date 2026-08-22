import {
  getGovernanceDefinitions,
  getGovernanceVersions,
  requireJavaOntologyAdminSession,
} from '@/infrastructure/java-backend';

import {
  AdminPageHeader,
  StatusBadge,
} from '../../../_components/admin-shell';
import { getVersionStatusLabel } from '../../../_lib/admin-labels';
import {
  DefinitionsClient,
  type DefinitionGroup,
  type DefinitionItem,
} from '../_components/definitions-client';

type DefinitionsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function readParam(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0];
  return undefined;
}

function getDefinitionGroups(definitions: {
  entities: DefinitionItem[];
  metrics: DefinitionItem[];
  metricVariants: DefinitionItem[];
  factors: DefinitionItem[];
  planStepTemplates: DefinitionItem[];
  toolBindings: DefinitionItem[];
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
    { key: 'toolBindings', title: '工具能力绑定', items: definitions.toolBindings },
    { key: 'timeSemantics', title: '时间语义', items: definitions.timeSemantics },
    { key: 'causalityEdges', title: '因果边', items: definitions.causalityEdges },
    { key: 'evidenceTypes', title: '证据类型', items: definitions.evidenceTypes },
  ];
}

export default async function OntologyAdminDefinitionsPage({
  searchParams,
}: DefinitionsPageProps) {
  const state = await requireJavaOntologyAdminSession('/admin/ontology/definitions');
  if (state.accessDeniedMessage) return null;

  const params = (await searchParams) ?? {};
  const requestedVersionId = readParam(params.versionId);
  const activeTab = readParam(params.tab) ?? 'all';

  const versions = (await getGovernanceVersions(20)).items;
  const selectedVersionId = requestedVersionId
    ?? versions.find((version) => version.publishedAt)?.id
    ?? versions.find((version) => version.status === 'approved')?.id;
  const view = selectedVersionId ? await getGovernanceDefinitions(selectedVersionId) : null;

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

  const { version } = view;
  const groups = getDefinitionGroups(view);

  const tabs = [
    { key: 'all', label: '全部', count: groups.reduce((sum, g) => sum + g.items.length, 0) },
    ...groups
      .filter((g) => g.items.length > 0)
      .map((g) => ({ key: g.key, label: g.title, count: g.items.length })),
  ];

  return (
    <section className="space-y-6">
      <AdminPageHeader
        eyebrow="定义管理"
        title="本体定义查阅"
        description="按版本查阅当前 ontology 治理对象。首期只读，变更请走变更申请流程。"
        trailing={
          <StatusBadge tone="success">
            {version.semver} · {getVersionStatusLabel(version.status)}
          </StatusBadge>
        }
      />

      <DefinitionsClient
        version={version}
        versions={versions}
        groups={groups}
        initialTab={tabs.some((tab) => tab.key === activeTab) ? activeTab : 'all'}
      />
    </section>
  );
}
