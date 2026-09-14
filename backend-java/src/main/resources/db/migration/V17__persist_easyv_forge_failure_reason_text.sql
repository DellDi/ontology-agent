alter table if exists facts.easyv_forge_generation_task
    add column if not exists failure_reason text;

update ingestion.data_product_definitions
    set transform_ref = 'easyv-forge-task-v2',
        metadata = jsonb_set(metadata, '{failureReason}', '"md5+text"'::jsonb, true)
    where product_key = 'easyv-forge-task';

update ingestion.dataset_definitions
    set metadata = jsonb_set(
        metadata, '{sensitiveHandling,failure_reason}', '"md5+text"'::jsonb, true)
    where dataset_key = 'easyv-forge-task';
