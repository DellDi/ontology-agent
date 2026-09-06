-- The extra key is needed so the batch table can enforce source + dataset +
-- version identity with one composite foreign key.  It also makes a manual
-- cross-source insert fail at the database boundary, not only in Java.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'source_dataset_versions_source_dataset_id_unique'
          AND conrelid = 'ingestion.source_dataset_versions'::regclass
    ) THEN
        ALTER TABLE "ingestion"."source_dataset_versions"
            ADD CONSTRAINT "source_dataset_versions_source_dataset_id_unique"
            UNIQUE ("source_key", "dataset_key", "id");
    END IF;
END;
$$;
--> statement-breakpoint

-- P2 durable staging stores one immutable, typed row-pack per append.  The
-- batch payload is deliberately bytea: no JSONB row document or EAV table is
-- part of the source artifact contract.
CREATE TABLE IF NOT EXISTS "ingestion"."source_dataset_batches" (
    "id" text PRIMARY KEY NOT NULL,
    "source_key" text NOT NULL,
    "dataset_key" text NOT NULL,
    "source_dataset_version_id" text NOT NULL,
    "batch_number" bigint NOT NULL,
    "codec" text DEFAULT 'row-pack-v1' NOT NULL,
    "row_count" bigint NOT NULL,
    "content_hash" text NOT NULL,
    "payload" bytea NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "source_dataset_batches_version_fk"
        FOREIGN KEY ("source_key", "dataset_key", "source_dataset_version_id")
            REFERENCES "ingestion"."source_dataset_versions"
                ("source_key", "dataset_key", "id"),
    CONSTRAINT "source_dataset_batches_key_check"
        CHECK (btrim("id") <> ''),
    CONSTRAINT "source_dataset_batches_batch_number_check"
        CHECK ("batch_number" > 0),
    CONSTRAINT "source_dataset_batches_codec_check"
        CHECK ("codec" = 'row-pack-v1'),
    CONSTRAINT "source_dataset_batches_row_count_check"
        CHECK ("row_count" >= 0),
    CONSTRAINT "source_dataset_batches_content_hash_check"
        CHECK ("content_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "source_dataset_batches_payload_check"
        CHECK (octet_length("payload") > 0),
    CONSTRAINT "source_dataset_batches_version_batch_unique"
        UNIQUE ("source_dataset_version_id", "batch_number")
);
--> statement-breakpoint

-- V5 allowed arbitrary non-empty source storage refs.  P2 makes the logical
-- locator explicit and derives it from the immutable version id.  BUILDING
-- rows may remain unpopulated only before reservation has supplied the ref.
ALTER TABLE "ingestion"."source_dataset_versions"
    DROP CONSTRAINT IF EXISTS "source_dataset_versions_storage_ref_check";
--> statement-breakpoint

ALTER TABLE "ingestion"."source_dataset_versions"
    ADD CONSTRAINT "source_dataset_versions_storage_ref_check"
    CHECK ("storage_ref" IS NULL OR
           "storage_ref" = 'ingestion://source-dataset-version/' || "id" || '/row-pack-v1');
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "source_dataset_batches_version_order_idx"
    ON "ingestion"."source_dataset_batches"
    USING btree ("source_dataset_version_id", "batch_number");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "source_dataset_batches_source_dataset_idx"
    ON "ingestion"."source_dataset_batches"
    USING btree ("source_key", "dataset_key", "created_at");
--> statement-breakpoint

-- A batch can be appended only while its parent version is BUILDING.  Once a
-- version is published or failed, its row-pack receipts remain audit data but
-- can no longer be inserted, updated, or deleted.
CREATE OR REPLACE FUNCTION "ingestion"."guard_source_dataset_batch_insert"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    parent_status text;
BEGIN
    SELECT status INTO parent_status
    FROM ingestion.source_dataset_versions
    WHERE source_key = NEW.source_key
      AND dataset_key = NEW.dataset_key
      AND id = NEW.source_dataset_version_id
    FOR UPDATE;

    IF parent_status IS DISTINCT FROM 'building' THEN
        RAISE EXCEPTION 'source dataset batch requires BUILDING parent version: %',
            NEW.source_dataset_version_id
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
        WHERE tgname = 'source_dataset_batches_building_insert_trg'
          AND tgrelid = 'ingestion.source_dataset_batches'::regclass
    ) THEN
        CREATE TRIGGER source_dataset_batches_building_insert_trg
        BEFORE INSERT ON ingestion.source_dataset_batches
        FOR EACH ROW EXECUTE FUNCTION ingestion.guard_source_dataset_batch_insert();
    END IF;
END;
$$;
--> statement-breakpoint

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'source_dataset_batches_immutable_trg'
          AND tgrelid = 'ingestion.source_dataset_batches'::regclass
    ) THEN
        CREATE TRIGGER source_dataset_batches_immutable_trg
        BEFORE UPDATE OR DELETE ON ingestion.source_dataset_batches
        FOR EACH ROW EXECUTE FUNCTION ingestion.guard_immutable_row_mutation();
    END IF;
END;
$$;
