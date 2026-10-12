-- 定时发布任务由调度器以 system 身份入队，没有人工会话；人工任务仍必须携带会话。
ALTER TABLE ingestion.release_tasks ADD COLUMN IF NOT EXISTS trigger_type text NOT NULL DEFAULT 'manual';
ALTER TABLE ingestion.release_tasks ALTER COLUMN session_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='release_tasks_trigger_type_check'
      AND conrelid='ingestion.release_tasks'::regclass) THEN
    ALTER TABLE ingestion.release_tasks ADD CONSTRAINT release_tasks_trigger_type_check
      CHECK (trigger_type IN ('manual', 'scheduled'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='release_tasks_trigger_actor_check'
      AND conrelid='ingestion.release_tasks'::regclass) THEN
    ALTER TABLE ingestion.release_tasks ADD CONSTRAINT release_tasks_trigger_actor_check
      CHECK ((trigger_type = 'manual') = (session_id IS NOT NULL) AND (trigger_type = 'manual' OR retry_of IS NULL));
  END IF;
END;
$$;
