-- Retain version/run/lineage metadata; only explicitly retired payloads may be removed.
CREATE OR REPLACE FUNCTION ingestion.guard_retired_payload_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF TG_TABLE_SCHEMA = 'facts' THEN
            IF EXISTS (SELECT 1 FROM ingestion.data_product_versions
                       WHERE id = OLD.product_version_id AND status = 'revoked') THEN RETURN OLD; END IF;
        ELSIF TG_TABLE_SCHEMA = 'ingestion' AND TG_TABLE_NAME = 'source_dataset_batches' THEN
            IF EXISTS (SELECT 1 FROM ingestion.source_dataset_versions
                       WHERE id = OLD.source_dataset_version_id AND status = 'revoked') THEN RETURN OLD; END IF;
        END IF;
    END IF;
    RAISE EXCEPTION 'active version payload is immutable: %.%', TG_TABLE_SCHEMA, TG_TABLE_NAME
        USING ERRCODE = '55000';
END;
$$;

DO $$
DECLARE item record;
BEGIN
    FOR item IN
        SELECT n.nspname schema_name,c.relname table_name,t.tgname
        FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE t.tgfoid='ingestion.guard_immutable_row_mutation()'::regprocedure
          AND (n.nspname='facts' OR (n.nspname='ingestion' AND c.relname='source_dataset_batches'))
    LOOP
        EXECUTE format('DROP TRIGGER %I ON %I.%I',item.tgname,item.schema_name,item.table_name);
        EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I.%I FOR EACH ROW EXECUTE FUNCTION ingestion.guard_retired_payload_mutation()',
            item.tgname,item.schema_name,item.table_name);
    END LOOP;
END;
$$;

-- A retired child/product no longer requires a reconstructable source payload.
CREATE OR REPLACE FUNCTION ingestion.guard_source_dataset_version_revoke()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status='published' AND NEW.status='revoked' THEN
        IF EXISTS (SELECT 1 FROM ingestion.source_dataset_versions child
                   WHERE child.parent_version_id=OLD.id AND child.status IN ('building','published'))
           OR EXISTS (SELECT 1 FROM ingestion.data_product_version_lineage l
                      JOIN ingestion.data_product_versions p ON p.id=l.product_version_id
                      WHERE l.source_dataset_version_id=OLD.id AND p.status IN ('building','published'))
           OR EXISTS (SELECT 1 FROM ingestion.product_materialization_runs r,jsonb_each_text(r.input_summary) i
                      WHERE r.status IN ('pending','running') AND i.value=OLD.id)
           OR EXISTS (SELECT 1 FROM ingestion.dataset_cursors WHERE last_successful_version_id=OLD.id) THEN
            RAISE EXCEPTION 'referenced source dataset version cannot be revoked: %',OLD.id USING ERRCODE='55000';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

-- Serializes a new execution pin with retirement; FK existence alone cannot reject revoked sets.
CREATE OR REPLACE FUNCTION ingestion.guard_execution_version_pin()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selected_id text; selected_status text;
BEGIN
    IF TG_TABLE_NAME='graph_sync_runs' THEN selected_id=NEW.cursor_snapshot->>'datasetVersionSetId';
    ELSE selected_id=NEW.dataset_version_set_id; END IF;
    IF selected_id IS NOT NULL THEN
        SELECT status INTO selected_status FROM ingestion.dataset_version_sets WHERE set_id=selected_id FOR SHARE;
        IF selected_status IS DISTINCT FROM 'frozen' THEN
            RAISE EXCEPTION 'execution requires an available frozen version set: %',selected_id USING ERRCODE='55000';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DO $$
DECLARE relation_name text;
BEGIN
    FOREACH relation_name IN ARRAY ARRAY['analysis_execution_snapshots','jobs','analysis_session_follow_ups'] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS execution_version_pin_trg ON platform.%I',relation_name);
        EXECUTE format('CREATE TRIGGER execution_version_pin_trg BEFORE INSERT OR UPDATE OF dataset_version_set_id ON platform.%I FOR EACH ROW EXECUTE FUNCTION ingestion.guard_execution_version_pin()',relation_name);
    END LOOP;
END;
$$;
DROP TRIGGER IF EXISTS execution_version_pin_trg ON platform.graph_sync_runs;
CREATE TRIGGER execution_version_pin_trg BEFORE INSERT OR UPDATE OF cursor_snapshot ON platform.graph_sync_runs
FOR EACH ROW EXECUTE FUNCTION ingestion.guard_execution_version_pin();
