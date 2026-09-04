UPDATE platform.jobs
SET payload = jsonb_set(
        payload,
        '{capabilityBinding}',
        jsonb_build_object(
                'domainKey', 'property',
                'capabilityKey', 'collection-rate-analysis',
                'ontologyVersionId', payload -> 'ontologyVersionId',
                'resolvedScope', jsonb_build_object(
                        'domainKey', 'property',
                        'schemaVersion', 1,
                        'values', jsonb_build_object(
                                'organizationId', payload -> 'organizationId',
                                'projectIds', payload -> 'projectIds',
                                'areaIds', payload -> 'areaIds'))),
        true)
WHERE type = 'analysis-execution'
  AND payload ->> 'executionContract' IN ('java-initial-v1', 'java-follow-up-v1')
  AND NOT payload ? 'capabilityBinding'
  AND jsonb_typeof(payload -> 'ontologyVersionId') = 'string'
  AND btrim(payload ->> 'ontologyVersionId') <> ''
  AND jsonb_typeof(payload -> 'organizationId') = 'string'
  AND btrim(payload ->> 'organizationId') <> ''
  AND jsonb_typeof(payload -> 'ownerUserId') = 'string'
  AND btrim(payload ->> 'ownerUserId') <> ''
  AND jsonb_typeof(payload -> 'sessionId') = 'string'
  AND btrim(payload ->> 'sessionId') <> ''
  AND jsonb_typeof(payload -> 'questionText') = 'string'
  AND btrim(payload ->> 'questionText') <> ''
  AND jsonb_typeof(payload -> 'traceId') = 'string'
  AND btrim(payload ->> 'traceId') <> ''
  AND owner_user_id = payload ->> 'ownerUserId'
  AND organization_id = payload ->> 'organizationId'
  AND session_id = payload ->> 'sessionId'
  AND jsonb_typeof(payload -> 'projectIds') = 'array'
  AND jsonb_typeof(payload -> 'areaIds') = 'array'
  AND jsonb_array_length(payload -> 'projectIds') + jsonb_array_length(payload -> 'areaIds') > 0
  AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(payload -> 'projectIds') AS item
      WHERE jsonb_typeof(item) <> 'string' OR btrim(item #>> '{}') = '')
  AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(payload -> 'areaIds') AS item
      WHERE jsonb_typeof(item) <> 'string' OR btrim(item #>> '{}') = '')
  AND (
      payload ->> 'executionContract' = 'java-initial-v1'
      OR (
          jsonb_typeof(payload -> 'followUpId') = 'string'
          AND btrim(payload ->> 'followUpId') <> ''
          AND jsonb_typeof(payload -> 'referencedExecutionId') = 'string'
          AND btrim(payload ->> 'referencedExecutionId') <> ''
          AND jsonb_typeof(payload -> 'referencedConclusion') = 'object'
          AND jsonb_typeof(payload -> 'referencedConclusion' -> 'title') = 'string'
          AND jsonb_typeof(payload -> 'referencedConclusion' -> 'summary') = 'string'
          AND (btrim(payload -> 'referencedConclusion' ->> 'title') <> ''
               OR btrim(payload -> 'referencedConclusion' ->> 'summary') <> '')
          AND jsonb_typeof(payload -> 'effectiveContext') = 'object'));
