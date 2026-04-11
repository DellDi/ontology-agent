import 'server-only';

import { getApprovedGovernanceDefinitions } from '@/application/ontology/use-cases';
import { createPostgresOntologyCausalityEdgeStore } from '@/infrastructure/ontology/postgres-ontology-causality-edge-store';
import { createPostgresOntologyEntityDefinitionStore } from '@/infrastructure/ontology/postgres-ontology-entity-definition-store';
import { createPostgresOntologyEvidenceTypeDefinitionStore } from '@/infrastructure/ontology/postgres-ontology-evidence-type-definition-store';
import { createPostgresOntologyFactorDefinitionStore } from '@/infrastructure/ontology/postgres-ontology-factor-definition-store';
import { createPostgresOntologyMetricDefinitionStore } from '@/infrastructure/ontology/postgres-ontology-metric-definition-store';
import { createPostgresOntologyMetricVariantStore } from '@/infrastructure/ontology/postgres-ontology-metric-variant-store';
import { createPostgresOntologyPlanStepTemplateStore } from '@/infrastructure/ontology/postgres-ontology-plan-step-template-store';
import { createPostgresOntologyTimeSemanticStore } from '@/infrastructure/ontology/postgres-ontology-time-semantic-store';
import { createPostgresOntologyVersionStore } from '@/infrastructure/ontology/postgres-ontology-version-store';
import { createPostgresDb } from '@/infrastructure/postgres/client';

import {
  buildGovernedSemanticMetrics,
  listSemanticMetrics,
  mergeGovernedSemanticMetrics,
} from './metric-catalog';

/**
 * Transitional path for Story 9.2:
 * runtime query execution should prefer approved governance definitions for
 * fee metrics, while non-governed metrics remain on the legacy catalog until
 * later stories finish the full cutover.
 */
export async function loadApprovedSemanticMetricCatalog() {
  const { db } = createPostgresDb();
  const approved = await getApprovedGovernanceDefinitions({
    versionStore: createPostgresOntologyVersionStore(db),
    entityStore: createPostgresOntologyEntityDefinitionStore(db),
    metricStore: createPostgresOntologyMetricDefinitionStore(db),
    factorStore: createPostgresOntologyFactorDefinitionStore(db),
    planStepStore: createPostgresOntologyPlanStepTemplateStore(db),
    metricVariantStore: createPostgresOntologyMetricVariantStore(db),
    timeSemanticStore: createPostgresOntologyTimeSemanticStore(db),
    causalityEdgeStore: createPostgresOntologyCausalityEdgeStore(db),
    evidenceTypeStore: createPostgresOntologyEvidenceTypeDefinitionStore(db),
  });

  if (!approved) {
    return listSemanticMetrics();
  }

  const governedMetrics = buildGovernedSemanticMetrics(approved.definitions);
  return mergeGovernedSemanticMetrics(governedMetrics);
}
