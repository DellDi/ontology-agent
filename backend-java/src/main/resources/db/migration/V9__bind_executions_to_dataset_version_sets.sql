-- P4 execution reproducibility: an execution may pin one already frozen
-- canonical dataset version set. Historical executions remain nullable and
-- are explicitly treated as not fully reproducible by the application.

ALTER TABLE "platform"."analysis_execution_snapshots"
    ADD COLUMN IF NOT EXISTS "dataset_version_set_id" text;
--> statement-breakpoint

ALTER TABLE "platform"."jobs"
    ADD COLUMN IF NOT EXISTS "dataset_version_set_id" text;
--> statement-breakpoint

ALTER TABLE "platform"."analysis_session_follow_ups"
    ADD COLUMN IF NOT EXISTS "dataset_version_set_id" text;
--> statement-breakpoint

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'analysis_execution_snapshots_dataset_version_set_fk'
          AND conrelid = 'platform.analysis_execution_snapshots'::regclass
    ) THEN
        ALTER TABLE platform.analysis_execution_snapshots
            ADD CONSTRAINT analysis_execution_snapshots_dataset_version_set_fk
            FOREIGN KEY (dataset_version_set_id)
            REFERENCES ingestion.dataset_version_sets(set_id);
    END IF;
END;
$$;
--> statement-breakpoint

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'jobs_dataset_version_set_fk'
          AND conrelid = 'platform.jobs'::regclass
    ) THEN
        ALTER TABLE platform.jobs
            ADD CONSTRAINT jobs_dataset_version_set_fk
            FOREIGN KEY (dataset_version_set_id)
            REFERENCES ingestion.dataset_version_sets(set_id);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'analysis_session_follow_ups_dataset_version_set_fk'
          AND conrelid = 'platform.analysis_session_follow_ups'::regclass
    ) THEN
        ALTER TABLE platform.analysis_session_follow_ups
            ADD CONSTRAINT analysis_session_follow_ups_dataset_version_set_fk
            FOREIGN KEY (dataset_version_set_id)
            REFERENCES ingestion.dataset_version_sets(set_id);
    END IF;
END;
$$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "analysis_execution_snapshots_dataset_version_set_idx"
    ON "platform"."analysis_execution_snapshots" ("dataset_version_set_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "jobs_dataset_version_set_idx"
    ON "platform"."jobs" ("dataset_version_set_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "analysis_session_follow_ups_dataset_version_set_idx"
    ON "platform"."analysis_session_follow_ups" ("dataset_version_set_id");
--> statement-breakpoint

-- Frozen version sets are immutable. Revocation is allowed only while no
-- execution snapshot references the set.
CREATE OR REPLACE FUNCTION "ingestion"."guard_frozen_version_set_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.status IN ('frozen', 'revoked') THEN
        IF TG_OP = 'UPDATE'
           AND OLD.status = 'frozen'
           AND NEW.status = 'revoked'
           AND (to_jsonb(NEW) - 'status') = (to_jsonb(OLD) - 'status') THEN
            IF EXISTS (
                SELECT 1 FROM platform.analysis_execution_snapshots snapshot
                WHERE snapshot.dataset_version_set_id = OLD.set_id
                UNION ALL
                SELECT 1 FROM platform.jobs job
                WHERE job.dataset_version_set_id = OLD.set_id
                UNION ALL
                SELECT 1 FROM platform.analysis_session_follow_ups follow_up
                WHERE follow_up.dataset_version_set_id = OLD.set_id
            ) THEN
                RAISE EXCEPTION 'execution-bound dataset version set cannot be revoked: %', OLD.set_id
                    USING ERRCODE = '55000';
            END IF;
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'frozen dataset version set is immutable: %', OLD.set_id
            USING ERRCODE = '55000';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'dataset_version_sets_immutable_trg'
          AND tgrelid = 'ingestion.dataset_version_sets'::regclass
    ) THEN
        CREATE TRIGGER dataset_version_sets_immutable_trg
        BEFORE UPDATE OR DELETE ON ingestion.dataset_version_sets
        FOR EACH ROW EXECUTE FUNCTION ingestion.guard_frozen_version_set_mutation();
    END IF;
END;
$$;
--> statement-breakpoint

-- A published product version referenced by a still-valid frozen manifest
-- cannot be revoked, otherwise a submitted execution could lose its input.
CREATE OR REPLACE FUNCTION "ingestion"."guard_data_product_version_revoke"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.status = 'published' AND NEW.status = 'revoked' AND EXISTS (
        SELECT 1
        FROM ingestion.dataset_version_set_items item
        JOIN ingestion.dataset_version_sets version_set ON version_set.set_id = item.set_id
        WHERE item.product_key = OLD.product_key
          AND item.product_version_id = OLD.id
          AND version_set.status = 'frozen'
    ) THEN
        RAISE EXCEPTION 'frozen-set product version cannot be revoked: %', OLD.id
            USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;
--> statement-breakpoint

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'data_product_versions_revoke_guard_trg'
          AND tgrelid = 'ingestion.data_product_versions'::regclass
    ) THEN
        CREATE TRIGGER data_product_versions_revoke_guard_trg
        BEFORE UPDATE OF status ON ingestion.data_product_versions
        FOR EACH ROW EXECUTE FUNCTION ingestion.guard_data_product_version_revoke();
    END IF;
END;
$$;
