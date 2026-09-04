-- V3 introduced a non-null legacy marker for rows that predate persisted
-- capability bindings.  A binding may be recovered only when the execution
-- job is the unambiguous source and its JSON has the same shape accepted by
-- CapabilityBinding.fromSnapshot.  Rows without that proof remain legacy.
WITH job_bindings AS (
    SELECT j.id,
           j.session_id,
           j.owner_user_id,
           j.payload,
           j.payload -> 'capabilityBinding' AS capability_binding,
           j.payload -> 'capabilityBinding' -> 'resolvedScope' AS resolved_scope
    FROM platform.jobs j
    WHERE j.type = 'analysis-execution'
      AND jsonb_typeof(j.payload) = 'object'
), valid_job_bindings AS (
    SELECT *
    FROM job_bindings
    WHERE jsonb_typeof(capability_binding) = 'object'
      AND jsonb_typeof(capability_binding -> 'domainKey') = 'string'
      AND btrim(capability_binding ->> 'domainKey') <> ''
      AND jsonb_typeof(capability_binding -> 'capabilityKey') = 'string'
      AND btrim(capability_binding ->> 'capabilityKey') <> ''
      AND jsonb_typeof(capability_binding -> 'ontologyVersionId') = 'string'
      AND btrim(capability_binding ->> 'ontologyVersionId') <> ''
      AND jsonb_typeof(payload -> 'ontologyVersionId') = 'string'
      AND btrim(payload ->> 'ontologyVersionId') <> ''
      AND capability_binding ->> 'ontologyVersionId' = payload ->> 'ontologyVersionId'
      AND jsonb_typeof(resolved_scope) = 'object'
      AND jsonb_typeof(resolved_scope -> 'domainKey') = 'string'
      AND btrim(resolved_scope ->> 'domainKey') <> ''
      AND resolved_scope ->> 'domainKey' = capability_binding ->> 'domainKey'
      AND jsonb_typeof(resolved_scope -> 'schemaVersion') = 'number'
      AND CASE
              WHEN btrim(resolved_scope ->> 'schemaVersion') ~ '^[0-9]+$'
                  THEN (resolved_scope ->> 'schemaVersion')::numeric BETWEEN 1 AND 2147483647
              ELSE false
          END
      AND jsonb_typeof(resolved_scope -> 'values') = 'object'
      AND resolved_scope -> 'values' <> '{}'::jsonb
)
UPDATE platform.analysis_execution_snapshots AS s
SET capability_binding = j.capability_binding
FROM valid_job_bindings AS j
WHERE s.capability_binding ->> 'source' = 'legacy/unknown'
  AND s.execution_id = j.id
  AND s.session_id = j.session_id
  AND s.owner_user_id = j.owner_user_id
  AND (s.ontology_version_id IS NULL
       OR s.ontology_version_id = j.capability_binding ->> 'ontologyVersionId')
  AND (
      (s.follow_up_id IS NULL
       AND j.payload ->> 'executionContract' = 'java-initial-v1')
      OR
      (s.follow_up_id IS NOT NULL
       AND j.payload ->> 'executionContract' = 'java-follow-up-v1'
       AND j.payload ->> 'followUpId' = s.follow_up_id)
  );

-- A follow-up inherits its binding from the referenced execution.  If that
-- execution is unavailable or malformed, a result execution is acceptable
-- only when it is the follow-up's own job (same session/owner and follow-up
-- id).  DISTINCT ON makes the referenced execution deterministically win.
WITH job_bindings AS (
    SELECT j.id,
           j.session_id,
           j.owner_user_id,
           j.payload,
           j.payload -> 'capabilityBinding' AS capability_binding,
           j.payload -> 'capabilityBinding' -> 'resolvedScope' AS resolved_scope
    FROM platform.jobs j
    WHERE j.type = 'analysis-execution'
      AND jsonb_typeof(j.payload) = 'object'
), valid_job_bindings AS (
    SELECT *
    FROM job_bindings
    WHERE jsonb_typeof(capability_binding) = 'object'
      AND jsonb_typeof(capability_binding -> 'domainKey') = 'string'
      AND btrim(capability_binding ->> 'domainKey') <> ''
      AND jsonb_typeof(capability_binding -> 'capabilityKey') = 'string'
      AND btrim(capability_binding ->> 'capabilityKey') <> ''
      AND jsonb_typeof(capability_binding -> 'ontologyVersionId') = 'string'
      AND btrim(capability_binding ->> 'ontologyVersionId') <> ''
      AND jsonb_typeof(payload -> 'ontologyVersionId') = 'string'
      AND btrim(payload ->> 'ontologyVersionId') <> ''
      AND capability_binding ->> 'ontologyVersionId' = payload ->> 'ontologyVersionId'
      AND jsonb_typeof(resolved_scope) = 'object'
      AND jsonb_typeof(resolved_scope -> 'domainKey') = 'string'
      AND btrim(resolved_scope ->> 'domainKey') <> ''
      AND resolved_scope ->> 'domainKey' = capability_binding ->> 'domainKey'
      AND jsonb_typeof(resolved_scope -> 'schemaVersion') = 'number'
      AND CASE
              WHEN btrim(resolved_scope ->> 'schemaVersion') ~ '^[0-9]+$'
                  THEN (resolved_scope ->> 'schemaVersion')::numeric BETWEEN 1 AND 2147483647
              ELSE false
          END
      AND jsonb_typeof(resolved_scope -> 'values') = 'object'
      AND resolved_scope -> 'values' <> '{}'::jsonb
), candidates AS (
    SELECT f.id AS follow_up_id,
           1 AS source_priority,
           j.capability_binding
    FROM platform.analysis_session_follow_ups AS f
    JOIN valid_job_bindings AS j
      ON j.id = f.referenced_execution_id
     AND j.session_id = f.session_id
     AND j.owner_user_id = f.owner_user_id
    WHERE f.capability_binding ->> 'source' = 'legacy/unknown'
      AND (f.ontology_version_id IS NULL
           OR f.ontology_version_id = j.capability_binding ->> 'ontologyVersionId')
      AND (
          (f.parent_follow_up_id IS NULL
           AND j.payload ->> 'executionContract' = 'java-initial-v1')
          OR
          (f.parent_follow_up_id IS NOT NULL
           AND j.payload ->> 'executionContract' = 'java-follow-up-v1'
           AND j.payload ->> 'followUpId' = f.parent_follow_up_id)
      )
    UNION ALL
    SELECT f.id AS follow_up_id,
           2 AS source_priority,
           j.capability_binding
    FROM platform.analysis_session_follow_ups AS f
    JOIN valid_job_bindings AS j
      ON j.id = f.result_execution_id
     AND j.session_id = f.session_id
     AND j.owner_user_id = f.owner_user_id
    WHERE f.capability_binding ->> 'source' = 'legacy/unknown'
      AND f.result_execution_id IS NOT NULL
      AND (f.ontology_version_id IS NULL
           OR f.ontology_version_id = j.capability_binding ->> 'ontologyVersionId')
      AND j.payload ->> 'executionContract' = 'java-follow-up-v1'
      AND j.payload ->> 'followUpId' = f.id
), chosen AS (
    SELECT DISTINCT ON (follow_up_id) follow_up_id, capability_binding
    FROM candidates
    ORDER BY follow_up_id, source_priority
)
UPDATE platform.analysis_session_follow_ups AS f
SET capability_binding = c.capability_binding
FROM chosen AS c
WHERE f.id = c.follow_up_id
  AND f.capability_binding ->> 'source' = 'legacy/unknown';
