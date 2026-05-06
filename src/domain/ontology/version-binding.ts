import type { OntologyVersion } from './models';

export type OntologyVersionBindingSource =
  | 'grounded-context'
  | 'inherited'
  | 'switched'
  | 'legacy/unknown';

export type OntologyVersionBinding = {
  ontologyVersionId: string | null;
  source: OntologyVersionBindingSource;
};

export class InvalidOntologyVersionBindingError extends Error {
  constructor(ontologyVersionId: string, reason: string) {
    super(
      `Ontology version binding "${ontologyVersionId}" must reference an approved and published ontology version: ${reason}`,
    );
    this.name = 'InvalidOntologyVersionBindingError';
  }
}

export function createOntologyVersionBinding(
  ontologyVersionId: string | null | undefined,
  source?: Exclude<OntologyVersionBindingSource, 'legacy/unknown'>,
): OntologyVersionBinding {
  const normalizedVersionId =
    typeof ontologyVersionId === 'string' && ontologyVersionId.trim().length > 0
      ? ontologyVersionId.trim()
      : null;

  return {
    ontologyVersionId: normalizedVersionId,
    source: normalizedVersionId ? (source ?? 'inherited') : 'legacy/unknown',
  };
}

export function normalizeOntologyVersionBindingSource(
  source: string | null | undefined,
  hasVersion: boolean,
): OntologyVersionBindingSource {
  if (!hasVersion) {
    return 'legacy/unknown';
  }

  if (
    source === 'grounded-context' ||
    source === 'inherited' ||
    source === 'switched'
  ) {
    return source;
  }

  return 'grounded-context';
}

export function resolveOntologyVersionBindingSource(input: {
  previousOntologyVersionId: string | null | undefined;
  nextOntologyVersionId: string | null | undefined;
}): OntologyVersionBindingSource {
  const previous = createOntologyVersionBinding(
    input.previousOntologyVersionId,
  ).ontologyVersionId;
  const next = createOntologyVersionBinding(
    input.nextOntologyVersionId,
  ).ontologyVersionId;

  if (!next) {
    return 'legacy/unknown';
  }

  if (!previous) {
    return 'grounded-context';
  }

  return previous !== next ? 'switched' : 'inherited';
}

export function resolveOntologyVersionBindingForDisplay(input: {
  snapshotBinding?: OntologyVersionBinding | null;
  followUpBinding?: OntologyVersionBinding | null;
}): OntologyVersionBinding | null {
  const { snapshotBinding, followUpBinding } = input;

  if (!followUpBinding) {
    return snapshotBinding ?? null;
  }

  if (followUpBinding.source === 'legacy/unknown') {
    return followUpBinding;
  }

  return createOntologyVersionBinding(
    snapshotBinding?.ontologyVersionId ?? followUpBinding.ontologyVersionId,
    followUpBinding.source,
  );
}

export function assertOntologyVersionBindingIsPublished(input: {
  ontologyVersionId: string;
  version: OntologyVersion | null;
}): void {
  const { ontologyVersionId, version } = input;

  if (!version) {
    throw new InvalidOntologyVersionBindingError(
      ontologyVersionId,
      'version not found',
    );
  }

  const statusCanBeReferenced =
    version.status === 'approved' || version.status === 'deprecated';

  if (!statusCanBeReferenced || !version.publishedAt) {
    throw new InvalidOntologyVersionBindingError(
      ontologyVersionId,
      `status=${version.status}, publishedAt=${version.publishedAt ?? 'null'}`,
    );
  }
}

export function getPlanOntologyVersionId(plan: unknown): string | null {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    return null;
  }

  const groundedSource = (plan as { _groundedSource?: unknown })._groundedSource;

  return typeof groundedSource === 'string' && groundedSource.trim().length > 0
    ? groundedSource.trim()
    : null;
}
