ALTER TABLE "ingestion"."source_dataset_versions"
    ADD COLUMN IF NOT EXISTS "parent_version_id" text;
--> statement-breakpoint

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM ingestion.source_dataset_versions v
        JOIN ingestion.source_ingestion_runs r ON r.id = v.source_ingestion_run_id
        WHERE r.mode = 'incremental' AND v.parent_version_id IS NULL
    ) THEN
        RAISE EXCEPTION
            'existing incremental source dataset versions have no reproducible parent; rebuild them before V7';
    END IF;
END;
$$;
--> statement-breakpoint

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'source_dataset_versions_parent_fk'
          AND conrelid = 'ingestion.source_dataset_versions'::regclass
    ) THEN
        ALTER TABLE "ingestion"."source_dataset_versions"
            ADD CONSTRAINT "source_dataset_versions_parent_fk"
            FOREIGN KEY ("dataset_key", "parent_version_id")
            REFERENCES "ingestion"."source_dataset_versions" ("dataset_key", "id");
    END IF;
END;
$$;
--> statement-breakpoint

ALTER TABLE "ingestion"."source_dataset_versions"
    DROP CONSTRAINT IF EXISTS "source_dataset_versions_parent_not_self_check";
--> statement-breakpoint

ALTER TABLE "ingestion"."source_dataset_versions"
    ADD CONSTRAINT "source_dataset_versions_parent_not_self_check"
    CHECK ("parent_version_id" IS NULL OR "parent_version_id" <> "id");
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "ingestion"."guard_source_dataset_version_parent"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    run_mode text;
    parent_status text;
    parent_number bigint;
BEGIN
    SELECT mode INTO STRICT run_mode
    FROM ingestion.source_ingestion_runs
    WHERE id = NEW.source_ingestion_run_id;

    IF run_mode = 'incremental' AND NEW.parent_version_id IS NULL THEN
        RAISE EXCEPTION 'incremental source dataset version requires a parent: %', NEW.id
            USING ERRCODE = '23514';
    END IF;
    IF run_mode <> 'incremental' AND NEW.parent_version_id IS NOT NULL THEN
        RAISE EXCEPTION 'full or reconcile source dataset version cannot have a parent: %', NEW.id
            USING ERRCODE = '23514';
    END IF;

    IF NEW.parent_version_id IS NOT NULL THEN
        SELECT status, version_number INTO STRICT parent_status, parent_number
        FROM ingestion.source_dataset_versions
        WHERE dataset_key = NEW.dataset_key AND id = NEW.parent_version_id
        FOR SHARE;
        IF parent_status <> 'published' OR parent_number >= NEW.version_number THEN
            RAISE EXCEPTION 'source dataset parent must be an earlier published version: %',
                NEW.parent_version_id USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
--> statement-breakpoint

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'source_dataset_versions_parent_guard_trg'
          AND tgrelid = 'ingestion.source_dataset_versions'::regclass
    ) THEN
        CREATE TRIGGER source_dataset_versions_parent_guard_trg
        BEFORE INSERT OR UPDATE OF parent_version_id, version_number,
            source_ingestion_run_id, dataset_key
        ON ingestion.source_dataset_versions
        FOR EACH ROW EXECUTE FUNCTION ingestion.guard_source_dataset_version_parent();
    END IF;
END;
$$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "source_dataset_versions_parent_idx"
    ON "ingestion"."source_dataset_versions" USING btree ("dataset_key", "parent_version_id");
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "ingestion"."guard_source_dataset_version_revoke"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.status = 'published' AND NEW.status = 'revoked' THEN
        IF EXISTS (
            SELECT 1 FROM ingestion.source_dataset_versions child
            WHERE child.dataset_key = OLD.dataset_key
              AND child.parent_version_id = OLD.id
              AND child.status IN ('building', 'published', 'revoked')
        ) OR EXISTS (
            SELECT 1 FROM ingestion.data_product_version_lineage lineage
            WHERE lineage.source_dataset_key = OLD.dataset_key
              AND lineage.source_dataset_version_id = OLD.id
        ) OR EXISTS (
            SELECT 1 FROM ingestion.dataset_cursors cursor_state
            WHERE cursor_state.dataset_key = OLD.dataset_key
              AND cursor_state.last_successful_version_id = OLD.id
        ) THEN
            RAISE EXCEPTION 'referenced source dataset version cannot be revoked: %', OLD.id
                USING ERRCODE = '55000';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
--> statement-breakpoint

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'source_dataset_versions_dependency_guard_trg'
          AND tgrelid = 'ingestion.source_dataset_versions'::regclass
    ) THEN
        CREATE TRIGGER source_dataset_versions_dependency_guard_trg
        BEFORE UPDATE OF status ON ingestion.source_dataset_versions
        FOR EACH ROW EXECUTE FUNCTION ingestion.guard_source_dataset_version_revoke();
    END IF;
END;
$$;
