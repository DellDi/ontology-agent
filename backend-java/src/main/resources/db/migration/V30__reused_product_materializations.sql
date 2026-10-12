-- A successful check can reuse an existing immutable product without copying facts.
ALTER TABLE ingestion.product_materialization_runs
    ADD COLUMN IF NOT EXISTS result_product_version_id text REFERENCES ingestion.data_product_versions(id);

UPDATE ingestion.product_materialization_runs r
SET result_product_version_id = v.id
FROM ingestion.data_product_versions v
WHERE v.materialization_run_id = r.id;
