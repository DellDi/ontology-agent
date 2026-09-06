-- P5 Property Domain Pack.
--
-- erp_staging is the current controlled PostgreSQL source for the Property
-- pack.  The source connection is resolved by the runtime using
-- property-staging-source; credentials never belong in a migration.

CREATE SCHEMA IF NOT EXISTS "facts";
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "facts"."property_organization" (
    "product_version_id" text NOT NULL,
    "source_dataset_key" text NOT NULL,
    "source_dataset_version_id" text NOT NULL,
    "organization_id" bigint NOT NULL,
    "parent_organization_id" bigint,
    "enterprise_id" bigint,
    "organization_name" text NOT NULL,
    "organization_code" text,
    "organization_path" text,
    "is_deleted" boolean NOT NULL,
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "property_organization_pk"
        PRIMARY KEY ("product_version_id", "organization_id"),
    CONSTRAINT "property_organization_product_version_fk"
        FOREIGN KEY ("product_version_id")
            REFERENCES "ingestion"."data_product_versions" ("id"),
    CONSTRAINT "property_organization_source_version_fk"
        FOREIGN KEY ("source_dataset_key", "source_dataset_version_id")
            REFERENCES "ingestion"."source_dataset_versions" ("dataset_key", "id"),
    CONSTRAINT "property_organization_source_dataset_check"
        CHECK ("source_dataset_key" = 'property-organization')
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "facts"."property_project" (
    "product_version_id" text NOT NULL,
    "source_dataset_key" text NOT NULL,
    "source_dataset_version_id" text NOT NULL,
    "project_id" text NOT NULL,
    "organization_id" text,
    "area_id" text,
    "enterprise_id" text,
    "project_name" text NOT NULL,
    "is_deleted" boolean NOT NULL,
    "delete_flag" boolean NOT NULL,
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "synced_at" timestamp with time zone,
    "ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "property_project_pk"
        PRIMARY KEY ("product_version_id", "project_id"),
    CONSTRAINT "property_project_product_version_fk"
        FOREIGN KEY ("product_version_id")
            REFERENCES "ingestion"."data_product_versions" ("id"),
    CONSTRAINT "property_project_source_version_fk"
        FOREIGN KEY ("source_dataset_key", "source_dataset_version_id")
            REFERENCES "ingestion"."source_dataset_versions" ("dataset_key", "id"),
    CONSTRAINT "property_project_source_dataset_check"
        CHECK ("source_dataset_key" = 'property-project')
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "facts"."property_charge_item" (
    "product_version_id" text NOT NULL,
    "source_dataset_key" text NOT NULL,
    "source_dataset_version_id" text NOT NULL,
    "charge_item_id" text NOT NULL,
    "organization_id" text,
    "enterprise_id" text,
    "charge_item_code" text,
    "charge_item_name" text NOT NULL,
    "charge_item_type" text,
    "is_deleted" boolean NOT NULL,
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "synced_at" timestamp with time zone,
    "ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "property_charge_item_pk"
        PRIMARY KEY ("product_version_id", "charge_item_id"),
    CONSTRAINT "property_charge_item_product_version_fk"
        FOREIGN KEY ("product_version_id")
            REFERENCES "ingestion"."data_product_versions" ("id"),
    CONSTRAINT "property_charge_item_source_version_fk"
        FOREIGN KEY ("source_dataset_key", "source_dataset_version_id")
            REFERENCES "ingestion"."source_dataset_versions" ("dataset_key", "id"),
    CONSTRAINT "property_charge_item_source_dataset_check"
        CHECK ("source_dataset_key" = 'property-charge-item')
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "facts"."property_receivable" (
    "product_version_id" text NOT NULL,
    "source_dataset_key" text NOT NULL,
    "source_dataset_version_id" text NOT NULL,
    "record_id" bigint NOT NULL,
    "organization_id" text NOT NULL,
    "enterprise_id" text,
    "project_id" text,
    "project_name" text,
    "charge_detail_id" text,
    "charge_item_id" text,
    "charge_item_name" text,
    "charge_item_type" text,
    "owner_id" text,
    "receivable_amount" numeric NOT NULL,
    "arrears_amount" numeric NOT NULL,
    "receivable_accounting_period" date,
    "billing_cycle_end_date" timestamp with time zone,
    "is_deleted" boolean NOT NULL,
    "is_checked" boolean NOT NULL,
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "synced_at" timestamp with time zone,
    "ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "property_receivable_pk"
        PRIMARY KEY ("product_version_id", "record_id"),
    CONSTRAINT "property_receivable_product_version_fk"
        FOREIGN KEY ("product_version_id")
            REFERENCES "ingestion"."data_product_versions" ("id"),
    CONSTRAINT "property_receivable_source_version_fk"
        FOREIGN KEY ("source_dataset_key", "source_dataset_version_id")
            REFERENCES "ingestion"."source_dataset_versions" ("dataset_key", "id"),
    CONSTRAINT "property_receivable_source_dataset_check"
        CHECK ("source_dataset_key" = 'property-receivable')
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "facts"."property_payment" (
    "product_version_id" text NOT NULL,
    "source_dataset_key" text NOT NULL,
    "source_dataset_version_id" text NOT NULL,
    "record_id" bigint NOT NULL,
    "organization_id" text NOT NULL,
    "enterprise_id" text,
    "project_id" text,
    "project_name" text,
    "charge_detail_id" text,
    "charge_item_id" text,
    "charge_item_name" text,
    "charge_item_type" text,
    "owner_id" text,
    "paid_amount" numeric NOT NULL,
    "payment_date" timestamp with time zone,
    "receivable_accounting_period" date,
    "billing_cycle_end_date" timestamp with time zone,
    "refund_status" text,
    "collection_type" integer,
    "subject_code" text,
    "is_deleted" boolean NOT NULL,
    "is_entered_account" boolean NOT NULL,
    "is_charge_deleted" boolean,
    "is_charge_checked" boolean,
    "updated_at" timestamp with time zone,
    "synced_at" timestamp with time zone,
    "ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "property_payment_pk"
        PRIMARY KEY ("product_version_id", "record_id"),
    CONSTRAINT "property_payment_product_version_fk"
        FOREIGN KEY ("product_version_id")
            REFERENCES "ingestion"."data_product_versions" ("id"),
    CONSTRAINT "property_payment_source_version_fk"
        FOREIGN KEY ("source_dataset_key", "source_dataset_version_id")
            REFERENCES "ingestion"."source_dataset_versions" ("dataset_key", "id"),
    CONSTRAINT "property_payment_source_dataset_check"
        CHECK ("source_dataset_key" = 'property-payment')
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "facts"."property_service_order" (
    "product_version_id" text NOT NULL,
    "source_dataset_key" text NOT NULL,
    "source_dataset_version_id" text NOT NULL,
    "service_order_id" text NOT NULL,
    "organization_id" text NOT NULL,
    "project_id" text,
    "project_name" text,
    "service_type_name" text,
    "service_style_name" text,
    "service_status" text,
    "service_status_name" text,
    "created_at" timestamp with time zone,
    "accepted_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "satisfaction" integer,
    "satisfaction_evaluated" boolean NOT NULL,
    "is_deleted" boolean NOT NULL,
    "updated_at" timestamp with time zone,
    "synced_at" timestamp with time zone,
    "ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "property_service_order_pk"
        PRIMARY KEY ("product_version_id", "service_order_id"),
    CONSTRAINT "property_service_order_product_version_fk"
        FOREIGN KEY ("product_version_id")
            REFERENCES "ingestion"."data_product_versions" ("id"),
    CONSTRAINT "property_service_order_source_version_fk"
        FOREIGN KEY ("source_dataset_key", "source_dataset_version_id")
            REFERENCES "ingestion"."source_dataset_versions" ("dataset_key", "id"),
    CONSTRAINT "property_service_order_source_dataset_check"
        CHECK ("source_dataset_key" = 'property-service-order')
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_organization_scope_idx"
    ON "facts"."property_organization" ("product_version_id", "organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "property_project_scope_idx"
    ON "facts"."property_project" ("product_version_id", "organization_id", "project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "property_project_area_scope_idx"
    ON "facts"."property_project" ("product_version_id", "organization_id", "area_id", "project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "property_charge_item_scope_idx"
    ON "facts"."property_charge_item" ("product_version_id", "organization_id", "charge_item_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "property_receivable_scope_idx"
    ON "facts"."property_receivable" ("product_version_id", "organization_id", "project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "property_payment_scope_idx"
    ON "facts"."property_payment" ("product_version_id", "organization_id", "project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "property_service_order_scope_idx"
    ON "facts"."property_service_order" ("product_version_id", "organization_id", "project_id");
--> statement-breakpoint

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'property_organization_building_insert_trg'
                   AND tgrelid = 'facts.property_organization'::regclass) THEN
        CREATE TRIGGER property_organization_building_insert_trg
        BEFORE INSERT ON facts.property_organization
        FOR EACH ROW EXECUTE FUNCTION ingestion.guard_canonical_fact_insert();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'property_project_building_insert_trg'
                   AND tgrelid = 'facts.property_project'::regclass) THEN
        CREATE TRIGGER property_project_building_insert_trg
        BEFORE INSERT ON facts.property_project
        FOR EACH ROW EXECUTE FUNCTION ingestion.guard_canonical_fact_insert();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'property_charge_item_building_insert_trg'
                   AND tgrelid = 'facts.property_charge_item'::regclass) THEN
        CREATE TRIGGER property_charge_item_building_insert_trg
        BEFORE INSERT ON facts.property_charge_item
        FOR EACH ROW EXECUTE FUNCTION ingestion.guard_canonical_fact_insert();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'property_receivable_building_insert_trg'
                   AND tgrelid = 'facts.property_receivable'::regclass) THEN
        CREATE TRIGGER property_receivable_building_insert_trg
        BEFORE INSERT ON facts.property_receivable
        FOR EACH ROW EXECUTE FUNCTION ingestion.guard_canonical_fact_insert();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'property_payment_building_insert_trg'
                   AND tgrelid = 'facts.property_payment'::regclass) THEN
        CREATE TRIGGER property_payment_building_insert_trg
        BEFORE INSERT ON facts.property_payment
        FOR EACH ROW EXECUTE FUNCTION ingestion.guard_canonical_fact_insert();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'property_service_order_building_insert_trg'
                   AND tgrelid = 'facts.property_service_order'::regclass) THEN
        CREATE TRIGGER property_service_order_building_insert_trg
        BEFORE INSERT ON facts.property_service_order
        FOR EACH ROW EXECUTE FUNCTION ingestion.guard_canonical_fact_insert();
    END IF;
END;
$$;
--> statement-breakpoint

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'property_organization_immutable_trg'
                   AND tgrelid = 'facts.property_organization'::regclass) THEN
        CREATE TRIGGER property_organization_immutable_trg
        BEFORE UPDATE OR DELETE ON facts.property_organization
        FOR EACH ROW EXECUTE FUNCTION ingestion.guard_immutable_row_mutation();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'property_project_immutable_trg'
                   AND tgrelid = 'facts.property_project'::regclass) THEN
        CREATE TRIGGER property_project_immutable_trg
        BEFORE UPDATE OR DELETE ON facts.property_project
        FOR EACH ROW EXECUTE FUNCTION ingestion.guard_immutable_row_mutation();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'property_charge_item_immutable_trg'
                   AND tgrelid = 'facts.property_charge_item'::regclass) THEN
        CREATE TRIGGER property_charge_item_immutable_trg
        BEFORE UPDATE OR DELETE ON facts.property_charge_item
        FOR EACH ROW EXECUTE FUNCTION ingestion.guard_immutable_row_mutation();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'property_receivable_immutable_trg'
                   AND tgrelid = 'facts.property_receivable'::regclass) THEN
        CREATE TRIGGER property_receivable_immutable_trg
        BEFORE UPDATE OR DELETE ON facts.property_receivable
        FOR EACH ROW EXECUTE FUNCTION ingestion.guard_immutable_row_mutation();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'property_payment_immutable_trg'
                   AND tgrelid = 'facts.property_payment'::regclass) THEN
        CREATE TRIGGER property_payment_immutable_trg
        BEFORE UPDATE OR DELETE ON facts.property_payment
        FOR EACH ROW EXECUTE FUNCTION ingestion.guard_immutable_row_mutation();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'property_service_order_immutable_trg'
                   AND tgrelid = 'facts.property_service_order'::regclass) THEN
        CREATE TRIGGER property_service_order_immutable_trg
        BEFORE UPDATE OR DELETE ON facts.property_service_order
        FOR EACH ROW EXECUTE FUNCTION ingestion.guard_immutable_row_mutation();
    END IF;
END;
$$;
--> statement-breakpoint

INSERT INTO "ingestion"."source_definitions"
    ("source_key", "connector_type", "connection_ref", "status")
VALUES ('property', 'postgres', 'property-staging-source', 'active')
ON CONFLICT ("source_key") DO NOTHING;
--> statement-breakpoint

INSERT INTO "ingestion"."dataset_definitions"
    ("dataset_key", "source_key", "source_namespace", "source_relation",
     "primary_key_columns", "column_contract", "cursor_spec", "delete_policy",
     "delete_spec", "schema_version", "status", "metadata")
VALUES
('property-organization', 'property', 'erp_staging', 'dw_datacenter_system_organization',
 ARRAY['source_id'],
 '[
    {"name":"source_id","type":"LONG","nullable":false},
    {"name":"enterprise_id","type":"LONG","nullable":true},
    {"name":"organization_parent_id","type":"LONG","nullable":true},
    {"name":"organization_name","type":"STRING","nullable":false},
    {"name":"organization_code","type":"STRING","nullable":true},
    {"name":"organization_path","type":"STRING","nullable":true},
    {"name":"is_deleted","type":"INTEGER","nullable":true},
    {"name":"create_time","type":"TIMESTAMPTZ","nullable":true,
      "timeSemantics":{"column":"create_time","kind":"TIMESTAMPTZ"}},
    {"name":"update_time","type":"TIMESTAMPTZ","nullable":true,
      "timeSemantics":{"column":"update_time","kind":"TIMESTAMPTZ"}}
 ]'::jsonb,
 '{"strategy":"RECONCILE"}'::jsonb, 'snapshot_diff', '{}'::jsonb, 1, 'active',
 '{"businessTimeZone":"Asia/Shanghai","reconciliation":"required","sourcePrimaryKey":["source_id"]}'::jsonb),
('property-project', 'property', 'erp_staging', 'dw_datacenter_precinct',
 ARRAY['precinct_id'],
 '[
    {"name":"precinct_id","type":"STRING","nullable":false},
    {"name":"enterprise_id","type":"STRING","nullable":true},
    {"name":"org_id","type":"STRING","nullable":true},
    {"name":"area_id","type":"STRING","nullable":true},
    {"name":"organization_id","type":"LONG","nullable":true},
    {"name":"precinct_name","type":"STRING","nullable":false},
    {"name":"is_delete","type":"INTEGER","nullable":true},
    {"name":"delete_flag","type":"INTEGER","nullable":true},
    {"name":"create_date","type":"TIMESTAMPTZ","nullable":true,
      "timeSemantics":{"column":"create_date","kind":"TIMESTAMPTZ"}},
    {"name":"update_date","type":"TIMESTAMPTZ","nullable":true,
      "timeSemantics":{"column":"update_date","kind":"TIMESTAMPTZ"}},
    {"name":"sync_date","type":"TIMESTAMPTZ","nullable":true,
      "timeSemantics":{"column":"sync_date","kind":"TIMESTAMPTZ"}}
 ]'::jsonb,
 '{"strategy":"RECONCILE"}'::jsonb, 'snapshot_diff', '{}'::jsonb, 1, 'active',
 '{"businessTimeZone":"Asia/Shanghai","reconciliation":"required","sourcePrimaryKey":["precinct_id"]}'::jsonb),
('property-charge-item', 'property', 'erp_staging', 'dw_datacenter_chargeitem',
 ARRAY['charge_item_id'],
 '[
    {"name":"charge_item_id","type":"STRING","nullable":false},
    {"name":"enterprise_id","type":"STRING","nullable":true},
    {"name":"organization_id","type":"STRING","nullable":true},
    {"name":"charge_item_code","type":"STRING","nullable":true},
    {"name":"charge_item_name","type":"STRING","nullable":false},
    {"name":"charge_item_type","type":"STRING","nullable":true},
    {"name":"delete_flag","type":"INTEGER","nullable":true},
    {"name":"create_date","type":"TIMESTAMPTZ","nullable":true,
      "timeSemantics":{"column":"create_date","kind":"TIMESTAMPTZ"}},
    {"name":"update_date","type":"TIMESTAMPTZ","nullable":true,
      "timeSemantics":{"column":"update_date","kind":"TIMESTAMPTZ"}},
    {"name":"sync_date","type":"TIMESTAMPTZ","nullable":true,
      "timeSemantics":{"column":"sync_date","kind":"TIMESTAMPTZ"}}
 ]'::jsonb,
 '{"strategy":"RECONCILE"}'::jsonb, 'snapshot_diff', '{}'::jsonb, 1, 'active',
 '{"businessTimeZone":"Asia/Shanghai","reconciliation":"required","sourcePrimaryKey":["charge_item_id"]}'::jsonb),
('property-receivable', 'property', 'erp_staging', 'dw_datacenter_charge',
 ARRAY['record_id'],
 '[
    {"name":"record_id","type":"LONG","nullable":false},
    {"name":"enterprise_id","type":"STRING","nullable":true},
    {"name":"organization_id","type":"STRING","nullable":false},
    {"name":"charge_detail_id","type":"STRING","nullable":true},
    {"name":"precinct_id","type":"STRING","nullable":true},
    {"name":"precinct_name","type":"STRING","nullable":true},
    {"name":"house_id","type":"STRING","nullable":true},
    {"name":"owner_id","type":"STRING","nullable":true},
    {"name":"charge_item_id","type":"STRING","nullable":true},
    {"name":"charge_item_name","type":"STRING","nullable":true},
    {"name":"should_account_book","type":"INTEGER","nullable":true},
    {"name":"calc_end_date","type":"TIMESTAMPTZ","nullable":true,
      "timeSemantics":{"column":"calc_end_date","kind":"TIMESTAMPTZ"}},
    {"name":"actual_charge_sum","type":"DECIMAL","nullable":true},
    {"name":"arrears","type":"DECIMAL","nullable":true},
    {"name":"is_check","type":"STRING","nullable":true},
    {"name":"is_delete","type":"INTEGER","nullable":true},
    {"name":"should_charge_date","type":"TIMESTAMPTZ","nullable":true,
      "timeSemantics":{"column":"should_charge_date","kind":"TIMESTAMPTZ"}},
    {"name":"create_date","type":"TIMESTAMPTZ","nullable":true,
      "timeSemantics":{"column":"create_date","kind":"TIMESTAMPTZ"}},
    {"name":"update_date","type":"TIMESTAMPTZ","nullable":true,
      "timeSemantics":{"column":"update_date","kind":"TIMESTAMPTZ"}},
    {"name":"sync_date","type":"TIMESTAMPTZ","nullable":true,
      "timeSemantics":{"column":"sync_date","kind":"TIMESTAMPTZ"}}
 ]'::jsonb,
 '{"strategy":"RECONCILE"}'::jsonb, 'snapshot_diff', '{}'::jsonb, 1, 'active',
 '{"businessTimeZone":"Asia/Shanghai","reconciliation":"required","sourcePrimaryKey":["record_id"]}'::jsonb),
('property-payment', 'property', 'erp_staging', 'dw_datacenter_bill',
 ARRAY['record_id'],
 '[
    {"name":"record_id","type":"LONG","nullable":false},
    {"name":"enterprise_id","type":"STRING","nullable":true},
    {"name":"organization_id","type":"STRING","nullable":false},
    {"name":"charge_payment_id","type":"STRING","nullable":true},
    {"name":"charge_detail_id","type":"STRING","nullable":true},
    {"name":"precinct_id","type":"STRING","nullable":true},
    {"name":"precinct_name","type":"STRING","nullable":true},
    {"name":"owner_id","type":"STRING","nullable":true},
    {"name":"charge_item_id","type":"STRING","nullable":true},
    {"name":"charge_item_name","type":"STRING","nullable":true},
    {"name":"charge_paid","type":"DECIMAL","nullable":true},
    {"name":"operator_date","type":"TIMESTAMPTZ","nullable":true,
      "timeSemantics":{"column":"operator_date","kind":"TIMESTAMPTZ"}},
    {"name":"paid_year","type":"INTEGER","nullable":true},
    {"name":"paid_month","type":"INTEGER","nullable":true},
    {"name":"paid_day","type":"INTEGER","nullable":true},
    {"name":"is_enter_account","type":"STRING","nullable":true},
    {"name":"is_delete","type":"INTEGER","nullable":true},
    {"name":"refund_status","type":"STRING","nullable":true},
    {"name":"precinct_collection_type","type":"INTEGER","nullable":true},
    {"name":"subject_code","type":"STRING","nullable":true},
    {"name":"update_date","type":"TIMESTAMPTZ","nullable":true,
      "timeSemantics":{"column":"update_date","kind":"TIMESTAMPTZ"}},
    {"name":"sync_date","type":"TIMESTAMPTZ","nullable":true,
      "timeSemantics":{"column":"sync_date","kind":"TIMESTAMPTZ"}}
 ]'::jsonb,
 '{"strategy":"RECONCILE"}'::jsonb, 'snapshot_diff', '{}'::jsonb, 1, 'active',
 '{"businessTimeZone":"Asia/Shanghai","reconciliation":"required","sourcePrimaryKey":["record_id"]}'::jsonb),
('property-service-order', 'property', 'erp_staging', 'dw_datacenter_services',
 ARRAY['services_no'],
 '[
    {"name":"services_no","type":"STRING","nullable":false},
    {"name":"organization_id","type":"STRING","nullable":false},
    {"name":"precinct_id","type":"STRING","nullable":true},
    {"name":"precinct_name","type":"STRING","nullable":true},
    {"name":"service_type_name","type":"STRING","nullable":true},
    {"name":"service_style_name","type":"STRING","nullable":true},
    {"name":"service_status","type":"STRING","nullable":true},
    {"name":"service_status_name","type":"STRING","nullable":true},
    {"name":"create_date_time","type":"TIMESTAMPTZ","nullable":true,
      "timeSemantics":{"column":"create_date_time","kind":"TIMESTAMPTZ"}},
    {"name":"accept_date","type":"TIMESTAMPTZ","nullable":true,
      "timeSemantics":{"column":"accept_date","kind":"TIMESTAMPTZ"}},
    {"name":"accomplish_date","type":"TIMESTAMPTZ","nullable":true,
      "timeSemantics":{"column":"accomplish_date","kind":"TIMESTAMPTZ"}},
    {"name":"satisfaction","type":"INTEGER","nullable":true},
    {"name":"satisfaction_eval","type":"INTEGER","nullable":true},
    {"name":"is_delete","type":"INTEGER","nullable":true},
    {"name":"update_date_time","type":"TIMESTAMPTZ","nullable":true,
      "timeSemantics":{"column":"update_date_time","kind":"TIMESTAMPTZ"}},
    {"name":"sync_date","type":"TIMESTAMPTZ","nullable":true,
      "timeSemantics":{"column":"sync_date","kind":"TIMESTAMPTZ"}}
 ]'::jsonb,
 '{"strategy":"RECONCILE"}'::jsonb, 'snapshot_diff', '{}'::jsonb, 1, 'active',
 '{"businessTimeZone":"Asia/Shanghai","reconciliation":"required","sourcePrimaryKey":["services_no"]}'::jsonb)
ON CONFLICT ("dataset_key") DO NOTHING;
--> statement-breakpoint

INSERT INTO "ingestion"."data_product_definitions"
    ("product_key", "domain_key", "canonical_schema", "canonical_relation",
     "transform_ref", "schema_version", "freshness_policy", "status", "metadata")
VALUES
('property-organization', 'property', 'facts', 'property_organization', 'property-organization-v1', 1,
 '{"mode":"reconcile","businessTimeZone":"Asia/Shanghai"}'::jsonb, 'active',
 '{"sourceDataset":"property-organization","primaryKey":["product_version_id","organization_id"]}'::jsonb),
('property-project', 'property', 'facts', 'property_project', 'property-project-v1', 1,
 '{"mode":"reconcile","businessTimeZone":"Asia/Shanghai"}'::jsonb, 'active',
 '{"sourceDataset":"property-project","primaryKey":["product_version_id","project_id"]}'::jsonb),
('property-charge-item', 'property', 'facts', 'property_charge_item', 'property-charge-item-v1', 1,
 '{"mode":"reconcile","businessTimeZone":"Asia/Shanghai"}'::jsonb, 'active',
 '{"sourceDataset":"property-charge-item","primaryKey":["product_version_id","charge_item_id"]}'::jsonb),
('property-receivable', 'property', 'facts', 'property_receivable', 'property-receivable-v1', 1,
 '{"mode":"reconcile","businessTimeZone":"Asia/Shanghai"}'::jsonb, 'active',
 '{"sourceDataset":"property-receivable","primaryKey":["product_version_id","record_id"],"derivedFrom":["property-charge-item"]}'::jsonb),
('property-payment', 'property', 'facts', 'property_payment', 'property-payment-v1', 1,
 '{"mode":"reconcile","businessTimeZone":"Asia/Shanghai"}'::jsonb, 'active',
 '{"sourceDataset":"property-payment","primaryKey":["product_version_id","record_id"],"derivedFrom":["property-receivable","property-charge-item"]}'::jsonb),
('property-service-order', 'property', 'facts', 'property_service_order', 'property-service-order-v1', 1,
 '{"mode":"reconcile","businessTimeZone":"Asia/Shanghai"}'::jsonb, 'active',
 '{"sourceDataset":"property-service-order","primaryKey":["product_version_id","service_order_id"]}'::jsonb)
ON CONFLICT ("product_key") DO NOTHING;
--> statement-breakpoint

INSERT INTO "ingestion"."data_product_inputs"
    ("product_key", "input_key", "dataset_key", "ordinal", "is_required", "mapping_spec", "metadata")
VALUES
('property-organization', 'source', 'property-organization', 0, true,
 '{"source_id":"organization_id","organization_parent_id":"parent_organization_id","organization_name":"organization_name","organization_code":"organization_code","organization_path":"organization_path","is_deleted":"is_deleted","create_time":"created_at","update_time":"updated_at"}'::jsonb, '{}'::jsonb),
('property-project', 'source', 'property-project', 0, true,
 '{"precinct_id":"project_id","org_id":"organization_id","area_id":"area_id","precinct_name":"project_name","is_delete":"is_deleted","delete_flag":"delete_flag","create_date":"created_at","update_date":"updated_at","sync_date":"synced_at"}'::jsonb, '{}'::jsonb),
('property-charge-item', 'source', 'property-charge-item', 0, true,
 '{"charge_item_id":"charge_item_id","organization_id":"organization_id","charge_item_name":"charge_item_name","charge_item_type":"charge_item_type","delete_flag":"is_deleted","create_date":"created_at","update_date":"updated_at","sync_date":"synced_at"}'::jsonb, '{}'::jsonb),
('property-receivable', 'source', 'property-receivable', 0, true,
 '{"record_id":"record_id","organization_id":"organization_id","precinct_id":"project_id","precinct_name":"project_name","charge_detail_id":"charge_detail_id","charge_item_id":"charge_item_id","charge_item_name":"charge_item_name","actual_charge_sum":"receivable_amount","arrears":"arrears_amount","should_account_book":"receivable_accounting_period","calc_end_date":"billing_cycle_end_date","is_delete":"is_deleted","is_check":"is_checked"}'::jsonb, '{}'::jsonb),
('property-receivable', 'charge-items', 'property-charge-item', 1, true,
 '{"charge_item_id":"charge_item_id","charge_item_type":"charge_item_type"}'::jsonb, '{"joinKey":"charge_item_id"}'::jsonb),
('property-payment', 'source', 'property-payment', 0, true,
 '{"record_id":"record_id","organization_id":"organization_id","precinct_id":"project_id","precinct_name":"project_name","charge_detail_id":"charge_detail_id","charge_item_id":"charge_item_id","charge_item_name":"charge_item_name","charge_paid":"paid_amount","operator_date":"payment_date","is_delete":"is_deleted","is_enter_account":"is_entered_account","refund_status":"refund_status","precinct_collection_type":"collection_type","subject_code":"subject_code"}'::jsonb, '{}'::jsonb),
('property-payment', 'receivables', 'property-receivable', 1, true,
 '{"charge_detail_id":"charge_detail_id","receivable_accounting_period":"receivable_accounting_period","billing_cycle_end_date":"billing_cycle_end_date","is_deleted":"is_charge_deleted","is_checked":"is_charge_checked"}'::jsonb, '{"joinKey":"charge_detail_id"}'::jsonb),
('property-payment', 'charge-items', 'property-charge-item', 2, true,
 '{"charge_item_id":"charge_item_id","charge_item_type":"charge_item_type"}'::jsonb, '{"joinKey":"charge_item_id"}'::jsonb),
('property-service-order', 'source', 'property-service-order', 0, true,
 '{"services_no":"service_order_id","organization_id":"organization_id","precinct_id":"project_id","precinct_name":"project_name","service_type_name":"service_type_name","service_style_name":"service_style_name","service_status":"service_status","service_status_name":"service_status_name","create_date_time":"created_at","accept_date":"accepted_at","accomplish_date":"completed_at","satisfaction":"satisfaction","satisfaction_eval":"satisfaction_evaluated","is_delete":"is_deleted","update_date_time":"updated_at","sync_date":"synced_at"}'::jsonb, '{}'::jsonb)
ON CONFLICT ("product_key", "input_key") DO NOTHING;
