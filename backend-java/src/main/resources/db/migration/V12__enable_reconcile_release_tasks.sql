ALTER TABLE ingestion.release_tasks DROP CONSTRAINT IF EXISTS release_tasks_mode_check;
ALTER TABLE ingestion.release_tasks ADD CONSTRAINT release_tasks_mode_check
    CHECK (mode IN ('full', 'incremental', 'reconcile'));
