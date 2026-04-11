import type {
  OntologyEntityDefinition,
  OntologyFactorDefinition,
  OntologyMetricDefinition,
  OntologyPlanStepTemplate,
  OntologyRegistryDefinitions,
  OntologyVersion,
} from '@/domain/ontology/models';

import type {
  CreateOntologyEntityDefinitionInput,
  CreateOntologyFactorDefinitionInput,
  CreateOntologyMetricDefinitionInput,
  CreateOntologyPlanStepTemplateInput,
  CreateOntologyVersionInput,
  OntologyEntityDefinitionStore,
  OntologyFactorDefinitionStore,
  OntologyMetricDefinitionStore,
  OntologyPlanStepTemplateStore,
  OntologyVersionStore,
} from './ports';

export type OntologyRegistryDeps = {
  versionStore: OntologyVersionStore;
  entityStore: OntologyEntityDefinitionStore;
  metricStore: OntologyMetricDefinitionStore;
  factorStore: OntologyFactorDefinitionStore;
  planStepStore: OntologyPlanStepTemplateStore;
};

export async function createOntologyVersion(
  deps: Pick<OntologyRegistryDeps, 'versionStore'>,
  input: CreateOntologyVersionInput,
): Promise<OntologyVersion> {
  return deps.versionStore.create(input);
}

export async function getCurrentApprovedVersion(
  deps: Pick<OntologyRegistryDeps, 'versionStore'>,
): Promise<OntologyVersion | null> {
  return deps.versionStore.findCurrentApproved();
}

export async function getOntologyVersionById(
  deps: Pick<OntologyRegistryDeps, 'versionStore'>,
  id: string,
): Promise<OntologyVersion | null> {
  return deps.versionStore.findById(id);
}

export type LoadDefinitionsInput = {
  ontologyVersionId: string;
  entities: CreateOntologyEntityDefinitionInput[];
  metrics: CreateOntologyMetricDefinitionInput[];
  factors: CreateOntologyFactorDefinitionInput[];
  planStepTemplates: CreateOntologyPlanStepTemplateInput[];
};

export type LoadDefinitionsResult = {
  entities: OntologyEntityDefinition[];
  metrics: OntologyMetricDefinition[];
  factors: OntologyFactorDefinition[];
  planStepTemplates: OntologyPlanStepTemplate[];
};

export async function loadOntologyDefinitions(
  deps: Omit<OntologyRegistryDeps, 'versionStore'>,
  input: LoadDefinitionsInput,
): Promise<LoadDefinitionsResult> {
  const [entities, metrics, factors, planStepTemplates] = await Promise.all([
    deps.entityStore.bulkCreate(input.entities),
    deps.metricStore.bulkCreate(input.metrics),
    deps.factorStore.bulkCreate(input.factors),
    deps.planStepStore.bulkCreate(input.planStepTemplates),
  ]);

  return { entities, metrics, factors, planStepTemplates };
}

export async function getDefinitionsByVersion(
  deps: Omit<OntologyRegistryDeps, 'versionStore'>,
  ontologyVersionId: string,
): Promise<OntologyRegistryDefinitions> {
  const [entities, metrics, factors, planStepTemplates] = await Promise.all([
    deps.entityStore.findByVersionId(ontologyVersionId),
    deps.metricStore.findByVersionId(ontologyVersionId),
    deps.factorStore.findByVersionId(ontologyVersionId),
    deps.planStepStore.findByVersionId(ontologyVersionId),
  ]);

  return { entities, metrics, factors, planStepTemplates };
}

export async function getCurrentApprovedDefinitions(
  deps: OntologyRegistryDeps,
): Promise<{ version: OntologyVersion; definitions: OntologyRegistryDefinitions } | null> {
  const version = await deps.versionStore.findCurrentApproved();

  if (!version) {
    return null;
  }

  const definitions = await getDefinitionsByVersion(deps, version.id);

  return { version, definitions };
}
