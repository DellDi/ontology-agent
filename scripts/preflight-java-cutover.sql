SELECT to_regnamespace('platform') IS NULL AS fresh_database \gset
\if :fresh_database
  \echo 'JAVA_CUTOVER_PREFLIGHT_OK: fresh database has no historical platform facts.'
\else
DO $$
DECLARE
  duplicate_follow_up_snapshots bigint;
  duplicate_result_bindings bigint;
  active_legacy_analysis_jobs bigint;
  inconsistent_follow_up_bindings bigint;
  current_ontology_versions bigint;
  duplicate_publish_versions bigint;
  active_graph_sync_runs bigint;
  duplicate_pending_graph_scopes bigint;
  processing_graph_scopes bigint;
BEGIN
  SELECT count(*) INTO current_ontology_versions
  FROM platform.ontology_versions
  WHERE status = 'approved' AND published_at IS NOT NULL;

  SELECT count(*) INTO duplicate_publish_versions
  FROM (
    SELECT ontology_version_id
    FROM platform.ontology_publish_records
    GROUP BY ontology_version_id
    HAVING count(*) > 1
  ) duplicates;

  SELECT count(*) INTO active_graph_sync_runs
  FROM platform.graph_sync_runs
  WHERE status IN ('pending', 'running');

  SELECT count(*) INTO duplicate_pending_graph_scopes
  FROM (
    SELECT scope_type, scope_key
    FROM platform.graph_sync_dirty_scopes
    WHERE status IN ('pending', 'processing')
    GROUP BY scope_type, scope_key
    HAVING count(*) > 1
  ) duplicates;

  SELECT count(*) INTO processing_graph_scopes
  FROM platform.graph_sync_dirty_scopes
  WHERE status = 'processing';

  SELECT count(*) INTO duplicate_follow_up_snapshots
  FROM (
    SELECT follow_up_id
    FROM platform.analysis_execution_snapshots
    WHERE follow_up_id IS NOT NULL
    GROUP BY follow_up_id
    HAVING count(*) > 1
  ) duplicates;

  SELECT count(*) INTO duplicate_result_bindings
  FROM (
    SELECT result_execution_id
    FROM platform.analysis_session_follow_ups
    WHERE result_execution_id IS NOT NULL
    GROUP BY result_execution_id
    HAVING count(*) > 1
  ) duplicates;

  SELECT count(*) INTO active_legacy_analysis_jobs
  FROM platform.jobs
  WHERE type = 'analysis-execution'
    AND status IN ('pending', 'queued', 'processing')
    AND coalesce(payload->>'executionContract', '') NOT IN ('java-initial-v1', 'java-follow-up-v1');

  SELECT count(*) INTO inconsistent_follow_up_bindings
  FROM platform.analysis_session_follow_ups follow_up
  LEFT JOIN platform.analysis_execution_snapshots snapshot
    ON snapshot.execution_id = follow_up.result_execution_id
  WHERE follow_up.result_execution_id IS NOT NULL
    AND (snapshot.execution_id IS NULL OR snapshot.follow_up_id IS DISTINCT FROM follow_up.id);

  IF duplicate_follow_up_snapshots > 0 THEN
    RAISE EXCEPTION 'JAVA_CUTOVER_PREFLIGHT_FAILED: duplicate snapshot follow_up_id groups=%', duplicate_follow_up_snapshots;
  END IF;
  IF current_ontology_versions <> 1 THEN
    RAISE EXCEPTION 'JAVA_CUTOVER_PREFLIGHT_FAILED: expected exactly one current ontology version, found=%', current_ontology_versions;
  END IF;
  IF duplicate_publish_versions > 0 THEN
    RAISE EXCEPTION 'JAVA_CUTOVER_PREFLIGHT_FAILED: duplicate ontology publish record groups=%', duplicate_publish_versions;
  END IF;
  IF active_graph_sync_runs > 0 THEN
    RAISE EXCEPTION 'JAVA_CUTOVER_PREFLIGHT_FAILED: active graph sync runs=%; resolve their terminal state before Java graph cutover', active_graph_sync_runs;
  END IF;
  IF duplicate_pending_graph_scopes > 0 THEN
    RAISE EXCEPTION 'JAVA_CUTOVER_PREFLIGHT_FAILED: duplicate pending graph scope groups=%', duplicate_pending_graph_scopes;
  END IF;
  IF processing_graph_scopes > 0 THEN
    RAISE EXCEPTION 'JAVA_CUTOVER_PREFLIGHT_FAILED: processing graph dirty scopes=%; recover or fail them before cutover', processing_graph_scopes;
  END IF;
  IF duplicate_result_bindings > 0 THEN
    RAISE EXCEPTION 'JAVA_CUTOVER_PREFLIGHT_FAILED: duplicate follow-up result_execution_id groups=%', duplicate_result_bindings;
  END IF;
  IF active_legacy_analysis_jobs > 0 THEN
    RAISE EXCEPTION 'JAVA_CUTOVER_PREFLIGHT_FAILED: active legacy analysis jobs=%; drain or fail them before removing the Node worker', active_legacy_analysis_jobs;
  END IF;
  IF inconsistent_follow_up_bindings > 0 THEN
    RAISE EXCEPTION 'JAVA_CUTOVER_PREFLIGHT_FAILED: inconsistent follow-up result bindings=%', inconsistent_follow_up_bindings;
  END IF;
END $$;
\endif
