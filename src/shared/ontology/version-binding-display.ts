import type { OntologyVersionBinding } from '@/domain/ontology/version-binding';

export function formatOntologyVersionBindingBadge(
  binding: OntologyVersionBinding,
): string {
  if (binding.source === 'legacy/unknown') {
    return 'Ontology 旧版本 / 未知';
  }

  return `Ontology ${binding.source}：${binding.ontologyVersionId}`;
}
