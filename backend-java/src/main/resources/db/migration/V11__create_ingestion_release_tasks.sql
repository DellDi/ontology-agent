-- Durable web-requested releases. Catalog ownership remains platform-wide;
-- organization_id records the submitting actor's audit context, not data ownership.
CREATE TABLE IF NOT EXISTS ingestion.release_tasks (
    id text PRIMARY KEY,
    source_key text NOT NULL REFERENCES ingestion.source_definitions(source_key),
    product_keys text[] NOT NULL CHECK (cardinality(product_keys) > 0),
    mode text NOT NULL CHECK (mode IN ('full', 'incremental')),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    retry_of text REFERENCES ingestion.release_tasks(id),
    requested_by text NOT NULL,
    organization_id text NOT NULL,
    session_id text NOT NULL,
    correlation_id text NOT NULL,
    error_code text,
    created_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    finished_at timestamptz,
    CHECK ((status IN ('completed', 'failed')) = (finished_at IS NOT NULL)),
    CHECK (status <> 'running' OR started_at IS NOT NULL),
    CHECK ((status = 'failed') = (error_code IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS release_tasks_pending_idx ON ingestion.release_tasks(created_at, id)
    WHERE status IN ('pending', 'running');
CREATE INDEX IF NOT EXISTS release_tasks_recent_idx ON ingestion.release_tasks(created_at DESC, id DESC);
