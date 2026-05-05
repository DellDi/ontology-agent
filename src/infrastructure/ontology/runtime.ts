import { createOntologyGroundingUseCases } from '@/application/ontology/grounding';
import { createOntologyToolBindingUseCases } from '@/application/ontology/tool-binding-use-cases';
import { createPostgresDb, type PostgresDb } from '@/infrastructure/postgres/client';

import { createPostgresGroundedContextStore } from './postgres-grounded-context-store';
import { createPostgresOntologyEntityDefinitionStore } from './postgres-ontology-entity-definition-store';
import { createPostgresOntologyFactorDefinitionStore } from './postgres-ontology-factor-definition-store';
import { createPostgresOntologyMetricDefinitionStore } from './postgres-ontology-metric-definition-store';
import { createPostgresOntologyMetricVariantStore } from './postgres-ontology-metric-variant-store';
import { createPostgresOntologyTimeSemanticStore } from './postgres-ontology-time-semantic-store';
import { createPostgresOntologyToolCapabilityBindingStore } from './postgres-ontology-tool-capability-binding-store';
import { createPostgresOntologyVersionStore } from './postgres-ontology-version-store';

export function createOntologyRuntimeServices(db?: PostgresDb) {
  const resolvedDb = db ?? createPostgresDb().db;
  const versionStore = createPostgresOntologyVersionStore(resolvedDb);

  return {
    versionStore,
    groundedContextStore: createPostgresGroundedContextStore(resolvedDb),
    groundingUseCases: createOntologyGroundingUseCases({
      versionStore,
      entityStore: createPostgresOntologyEntityDefinitionStore(resolvedDb),
      metricStore: createPostgresOntologyMetricDefinitionStore(resolvedDb),
      factorStore: createPostgresOntologyFactorDefinitionStore(resolvedDb),
      metricVariantStore: createPostgresOntologyMetricVariantStore(resolvedDb),
      timeSemanticStore: createPostgresOntologyTimeSemanticStore(resolvedDb),
    }),
    toolBindingUseCases: createOntologyToolBindingUseCases({
      versionStore,
      toolCapabilityBindingStore:
        createPostgresOntologyToolCapabilityBindingStore(resolvedDb),
    }),
  };
}
