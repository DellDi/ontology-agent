import type { ErpProject } from '@/domain/erp-read/models';
import type {
  OntologyMetricDefinition,
  OntologyMetricVariant,
  OntologyVersion,
} from '@/domain/ontology/models';

type RuntimeMetricDefinitions = {
  version: Pick<OntologyVersion, 'semver' | 'displayName'>;
  metrics: Pick<OntologyMetricDefinition, 'businessKey' | 'displayName' | 'metadata'>[];
  metricVariants: Pick<
    OntologyMetricVariant,
    'businessKey' | 'displayName' | 'semanticDiscriminator' | 'metadata'
  >[];
};

function addNonEmpty(set: Set<string>, value: string | null | undefined) {
  const trimmed = value?.trim();
  if (trimmed) {
    set.add(trimmed);
  }
}

function addMetadataAliases(set: Set<string>, metadata: Record<string, unknown>) {
  const aliases = metadata.aliases ?? metadata.synonyms;

  if (!Array.isArray(aliases)) {
    return;
  }

  for (const alias of aliases) {
    if (typeof alias === 'string') {
      addNonEmpty(set, alias);
    }
  }
}

export function buildProjectNameDictionary(
  projects: Pick<ErpProject, 'name'>[],
) {
  const names = new Set<string>();

  for (const project of projects) {
    addNonEmpty(names, project.name);
  }

  return [...names];
}

export function buildMetricDictionaryFromOntology(
  definitions: RuntimeMetricDefinitions | null | undefined,
) {
  if (!definitions) {
    return [];
  }

  const dictionary = new Set<string>();

  for (const metric of definitions.metrics) {
    addNonEmpty(dictionary, metric.displayName);
    addNonEmpty(dictionary, metric.businessKey);
    addMetadataAliases(dictionary, metric.metadata);
  }

  for (const variant of definitions.metricVariants) {
    addNonEmpty(dictionary, variant.displayName);
    addNonEmpty(dictionary, variant.businessKey);
    addNonEmpty(dictionary, variant.semanticDiscriminator);
    addMetadataAliases(dictionary, variant.metadata);
  }

  return [...dictionary];
}

export function summarizeOntologyForContextExtraction(
  definitions: RuntimeMetricDefinitions | null | undefined,
) {
  if (!definitions) {
    return undefined;
  }

  return [
    `version=${definitions.version.displayName}(${definitions.version.semver})`,
    `metrics=${definitions.metrics.length}`,
    `metricVariants=${definitions.metricVariants.length}`,
  ].join('; ');
}
