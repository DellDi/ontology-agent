CREATE TABLE IF NOT EXISTS ingestion.source_view_grants (
    source_key text NOT NULL REFERENCES ingestion.source_definitions(source_key),
    organization_id text NOT NULL CHECK (length(trim(organization_id)) > 0),
    granted_by text NOT NULL,
    granted_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (source_key, organization_id)
);
CREATE INDEX IF NOT EXISTS source_view_grants_organization_idx ON ingestion.source_view_grants(organization_id);
