CREATE TABLE "platform"."analysis_execution_snapshots" (
	"execution_id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"follow_up_id" text,
	"status" text NOT NULL,
	"plan_snapshot" jsonb NOT NULL,
	"step_results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"conclusion_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result_blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mobile_projection" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"failure_point" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."analysis_session_follow_ups" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"question_text" text NOT NULL,
	"parent_follow_up_id" text,
	"referenced_execution_id" text NOT NULL,
	"referenced_conclusion_title" text,
	"referenced_conclusion_summary" text,
	"result_execution_id" text,
	"inherited_context" jsonb NOT NULL,
	"merged_context" jsonb NOT NULL,
	"created_order" bigint DEFAULT nextval('"platform"."analysis_session_follow_ups_created_order_seq"') NOT NULL,
	"plan_version" integer,
	"current_plan_snapshot" jsonb,
	"previous_plan_snapshot" jsonb,
	"current_plan_diff" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"session_id" text,
	"event_type" text NOT NULL,
	"event_result" text NOT NULL,
	"event_source" text NOT NULL,
	"correlation_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retention_until" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "erp_staging"."dw_datacenter_house" (
	"record_id" bigint,
	"enterprise_id" text,
	"data_source" text,
	"org_id" text,
	"precinct_id" text,
	"precinct_name" text,
	"house_id" text PRIMARY KEY NOT NULL,
	"house_name" text,
	"room_type" text,
	"room_type_name" text,
	"house_type" text,
	"charge_area" numeric,
	"build_area" numeric,
	"is_show" integer,
	"is_spilt" integer,
	"is_virtual" integer,
	"stage" text,
	"rent_stage" text,
	"decorate_stage" text,
	"building_id" text,
	"regional_company_id" text,
	"area_id" text,
	"cluster_id" text,
	"business_cluster_id" text,
	"unit_id" text,
	"is_delete" integer,
	"is_block_up" integer,
	"create_date" timestamp with time zone,
	"update_date" timestamp with time zone,
	"sync_date" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "erp_staging"."dw_datacenter_system_user" (
	"source_id" bigint PRIMARY KEY NOT NULL,
	"enterprise_id" bigint,
	"organization_id" bigint,
	"group_id" bigint,
	"company_id" bigint,
	"department_id" bigint,
	"sentry_id" text,
	"sentry_name" text,
	"user_account" text,
	"password" text,
	"user_telephone" text,
	"user_password" text,
	"user_birthday" timestamp with time zone,
	"user_hiredate" timestamp with time zone,
	"user_state" text,
	"user_type" integer,
	"user_certificate_type" text,
	"user_certificate_number" text,
	"user_picurl" text,
	"is_deleted" integer,
	"is_actived" text,
	"remark" text,
	"enable2_fa" integer,
	"qw_user_id" text,
	"qw_open_id" text,
	"sync_date" timestamp with time zone,
	"sys_date" date
);
--> statement-breakpoint
CREATE TABLE "platform"."graph_sync_cursors" (
	"source_name" text PRIMARY KEY NOT NULL,
	"cursor_time" timestamp with time zone,
	"cursor_pk" text,
	"last_run_id" text,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."graph_sync_dirty_scopes" (
	"id" text PRIMARY KEY NOT NULL,
	"scope_type" text NOT NULL,
	"scope_key" text NOT NULL,
	"reason" text NOT NULL,
	"source_name" text NOT NULL,
	"source_pk" text,
	"source_progress" jsonb NOT NULL,
	"first_detected_at" timestamp with time zone NOT NULL,
	"last_detected_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_run_id" text,
	"error_summary" text
);
--> statement-breakpoint
CREATE TABLE "platform"."graph_sync_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"status" text NOT NULL,
	"scope_type" text NOT NULL,
	"scope_key" text NOT NULL,
	"trigger_type" text NOT NULL,
	"triggered_by" text NOT NULL,
	"cursor_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"nodes_written" integer DEFAULT 0 NOT NULL,
	"edges_written" integer DEFAULT 0 NOT NULL,
	"error_summary" text,
	"error_detail" jsonb,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."ontology_entity_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"ontology_version_id" text NOT NULL,
	"business_key" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"status" text NOT NULL,
	"synonyms" text[] DEFAULT '{}' NOT NULL,
	"parent_business_key" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."ontology_factor_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"ontology_version_id" text NOT NULL,
	"business_key" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"status" text NOT NULL,
	"category" text NOT NULL,
	"related_metric_keys" text[] DEFAULT '{}' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."ontology_metric_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"ontology_version_id" text NOT NULL,
	"business_key" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"status" text NOT NULL,
	"applicable_subject_keys" text[] DEFAULT '{}' NOT NULL,
	"default_aggregation" text,
	"unit" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."ontology_plan_step_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"ontology_version_id" text NOT NULL,
	"business_key" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"status" text NOT NULL,
	"intent_types" text[] DEFAULT '{}' NOT NULL,
	"required_capabilities" text[] DEFAULT '{}' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."ontology_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"semver" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text NOT NULL,
	"description" text,
	"published_at" timestamp with time zone,
	"deprecated_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_chargeitem" ALTER COLUMN "charge_item_class" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_chargeitem" ALTER COLUMN "organization_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_system_organization" ALTER COLUMN "source_id" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_system_organization" ALTER COLUMN "organization_parent_id" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_system_organization" ALTER COLUMN "enterprise_id" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_system_organization" ALTER COLUMN "group_id" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_system_organization" ALTER COLUMN "company_id" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_system_organization" ALTER COLUMN "department_id" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_system_organization" ALTER COLUMN "organization_enable_state" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_system_organization" ALTER COLUMN "is_deleted" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_owner" ALTER COLUMN "record_id" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_owner" ALTER COLUMN "org_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_bill" ALTER COLUMN "record_id" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_bill" ALTER COLUMN "data_type" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_bill" ALTER COLUMN "is_account" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_bill" ALTER COLUMN "is_delete" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_precinct" ALTER COLUMN "org_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_precinct" ALTER COLUMN "organization_id" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_precinct" ALTER COLUMN "is_delete" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_precinct" ALTER COLUMN "delete_flag" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_charge" ALTER COLUMN "record_id" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_charge" ALTER COLUMN "is_delete" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_charge" ALTER COLUMN "is_freezed" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_services" ALTER COLUMN "customer_id" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_services" ALTER COLUMN "satisfaction" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_services" ALTER COLUMN "is_delete" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_chargeitem" ADD COLUMN "record_id" bigint;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_chargeitem" ADD COLUMN "enterprise_id" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_chargeitem" ADD COLUMN "data_source" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_chargeitem" ADD COLUMN "tax_rate" numeric(3, 2);--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_chargeitem" ADD COLUMN "item_group_id" bigint;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_chargeitem" ADD COLUMN "item_detail_group_id" bigint;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_chargeitem" ADD COLUMN "cash_flow_group_id" bigint;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_chargeitem" ADD COLUMN "path" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_chargeitem" ADD COLUMN "create_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_chargeitem" ADD COLUMN "update_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_chargeitem" ADD COLUMN "sync_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_chargeitem" ADD COLUMN "delete_flag" integer;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_chargeitem" ADD COLUMN "create_user_id" bigint;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_chargeitem" ADD COLUMN "create_user_name" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_chargeitem" ADD COLUMN "create_date_time" date;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_chargeitem" ADD COLUMN "update_user_id" bigint;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_chargeitem" ADD COLUMN "update_user_name" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_chargeitem" ADD COLUMN "update_date_time" date;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_chargeitem" ADD COLUMN "charge_item_out_type" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_system_organization" ADD COLUMN "organization_code" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_system_organization" ADD COLUMN "organization_type" integer;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_system_organization" ADD COLUMN "organization_order_column" integer;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_system_organization" ADD COLUMN "remark" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_system_organization" ADD COLUMN "version_id" bigint;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_system_organization" ADD COLUMN "create_user_id" bigint;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_system_organization" ADD COLUMN "create_user_name" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_system_organization" ADD COLUMN "create_time" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_system_organization" ADD COLUMN "update_user_id" bigint;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_system_organization" ADD COLUMN "update_user_name" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_system_organization" ADD COLUMN "update_time" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_system_organization" ADD COLUMN "sync_department_id" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_system_organization" ADD COLUMN "sync_organization_id" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_system_organization" ADD COLUMN "sync_organization_parent_id" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_system_organization" ADD COLUMN "sync_status" integer;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_system_organization" ADD COLUMN "organization_dimension" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_system_organization" ADD COLUMN "organization_dimension_alias_name" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_system_organization" ADD COLUMN "organization_scope" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_system_organization" ADD COLUMN "organization_manager_id" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_system_organization" ADD COLUMN "organization_part_manager_id" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_system_organization" ADD COLUMN "organization_hr_type_code" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_system_organization" ADD COLUMN "organization_hierarchical_class_code" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_system_organization" ADD COLUMN "organization_stage_code" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_system_organization" ADD COLUMN "organization_stage_level_code" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_system_organization" ADD COLUMN "organization_source" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_system_organization" ADD COLUMN "data_analysis_type" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_system_organization" ADD COLUMN "sys_date" date;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_owner" ADD COLUMN "enterprise_id" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_owner" ADD COLUMN "data_source" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_owner" ADD COLUMN "is_delete" integer;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_owner" ADD COLUMN "create_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_owner" ADD COLUMN "update_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_owner" ADD COLUMN "sync_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_bill" ADD COLUMN "db_id" integer;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_bill" ADD COLUMN "enterprise_id" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_bill" ADD COLUMN "data_source" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_bill" ADD COLUMN "charge_payment_id" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_bill" ADD COLUMN "room_type" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_bill" ADD COLUMN "calc_end_year" integer;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_bill" ADD COLUMN "should_account_book" integer;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_bill" ADD COLUMN "account_book" integer;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_bill" ADD COLUMN "actual_account_book" integer;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_bill" ADD COLUMN "paid_year" integer;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_bill" ADD COLUMN "paid_month" integer;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_bill" ADD COLUMN "paid_day" integer;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_bill" ADD COLUMN "charge_area" numeric;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_bill" ADD COLUMN "subject_code" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_bill" ADD COLUMN "source_income" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_bill" ADD COLUMN "square_type_id" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_bill" ADD COLUMN "square_type_name" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_bill" ADD COLUMN "precinct_collection_type" integer;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_bill" ADD COLUMN "update_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_bill" ADD COLUMN "sync_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_precinct" ADD COLUMN "record_id" bigint;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_precinct" ADD COLUMN "data_source" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_precinct" ADD COLUMN "province_id" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_precinct" ADD COLUMN "city_id" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_precinct" ADD COLUMN "area_city_id" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_precinct" ADD COLUMN "street_id" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_precinct" ADD COLUMN "pro_nature" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_precinct" ADD COLUMN "check_merger" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_precinct" ADD COLUMN "check_old_precinct" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_precinct" ADD COLUMN "old_tax_rate" numeric(3, 2);--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_precinct" ADD COLUMN "create_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_precinct" ADD COLUMN "update_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_precinct" ADD COLUMN "sync_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_precinct" ADD COLUMN "green_area" numeric;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_precinct" ADD COLUMN "precinct_area" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_precinct" ADD COLUMN "parking_amount" integer;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_precinct" ADD COLUMN "create_user_id" bigint;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_precinct" ADD COLUMN "create_user_name" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_precinct" ADD COLUMN "create_date_time" date;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_precinct" ADD COLUMN "update_user_id" bigint;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_precinct" ADD COLUMN "update_user_name" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_precinct" ADD COLUMN "update_date_time" date;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_charge" ADD COLUMN "db_id" integer;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_charge" ADD COLUMN "enterprise_id" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_charge" ADD COLUMN "data_source" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_charge" ADD COLUMN "charge_detail_id" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_charge" ADD COLUMN "room_type" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_charge" ADD COLUMN "charge_area" numeric;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_charge" ADD COLUMN "should_account_book" integer;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_charge" ADD COLUMN "calc_end_year" integer;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_charge" ADD COLUMN "amount" numeric;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_charge" ADD COLUMN "is_estate" integer;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_charge" ADD COLUMN "sync_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_charge" ADD COLUMN "discount_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_services" ADD COLUMN "record_id" bigint;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_services" ADD COLUMN "enterprise_id" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_services" ADD COLUMN "data_source" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_services" ADD COLUMN "customer_house_id" integer;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_services" ADD COLUMN "customer_house_name" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_services" ADD COLUMN "house_name" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_services" ADD COLUMN "create_user_name" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_services" ADD COLUMN "create_year" integer;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_services" ADD COLUMN "create_month" integer;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_services" ADD COLUMN "dispatching_user_name" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_services" ADD COLUMN "dispatching_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_services" ADD COLUMN "accept_user_name" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_services" ADD COLUMN "accept_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_services" ADD COLUMN "arrive_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_services" ADD COLUMN "reception_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_services" ADD COLUMN "accomplish_user_name" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_services" ADD COLUMN "is_over_time" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_services" ADD COLUMN "is_reprocess" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_services" ADD COLUMN "is_return_visit" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_services" ADD COLUMN "sync_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_services" ADD COLUMN "accept_over_time" integer;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_services" ADD COLUMN "service_pay_type_id" integer;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_services" ADD COLUMN "one_type_name" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_services" ADD COLUMN "second_type_name" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_services" ADD COLUMN "three_type_name" text;--> statement-breakpoint
CREATE INDEX "analysis_execution_snapshots_session_id_idx" ON "platform"."analysis_execution_snapshots" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "analysis_execution_snapshots_owner_updated_idx" ON "platform"."analysis_execution_snapshots" USING btree ("owner_user_id","updated_at");--> statement-breakpoint
CREATE INDEX "analysis_execution_snapshots_follow_up_id_idx" ON "platform"."analysis_execution_snapshots" USING btree ("follow_up_id");--> statement-breakpoint
CREATE INDEX "analysis_session_follow_ups_session_idx" ON "platform"."analysis_session_follow_ups" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "analysis_session_follow_ups_owner_session_idx" ON "platform"."analysis_session_follow_ups" USING btree ("owner_user_id","session_id");--> statement-breakpoint
CREATE INDEX "analysis_session_follow_ups_session_created_order_idx" ON "platform"."analysis_session_follow_ups" USING btree ("session_id","created_order");--> statement-breakpoint
CREATE INDEX "analysis_session_follow_ups_execution_idx" ON "platform"."analysis_session_follow_ups" USING btree ("referenced_execution_id");--> statement-breakpoint
CREATE INDEX "analysis_session_follow_ups_result_execution_idx" ON "platform"."analysis_session_follow_ups" USING btree ("result_execution_id");--> statement-breakpoint
CREATE INDEX "analysis_session_follow_ups_created_at_idx" ON "platform"."analysis_session_follow_ups" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_events_user_id_idx" ON "platform"."audit_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_events_session_id_idx" ON "platform"."audit_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "audit_events_event_type_idx" ON "platform"."audit_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "audit_events_created_at_idx" ON "platform"."audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_events_retention_until_idx" ON "platform"."audit_events" USING btree ("retention_until");--> statement-breakpoint
CREATE INDEX "audit_events_correlation_id_idx" ON "platform"."audit_events" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "erp_houses_org_idx" ON "erp_staging"."dw_datacenter_house" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "erp_houses_precinct_idx" ON "erp_staging"."dw_datacenter_house" USING btree ("precinct_id");--> statement-breakpoint
CREATE INDEX "erp_system_users_org_idx" ON "erp_staging"."dw_datacenter_system_user" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "erp_system_users_account_idx" ON "erp_staging"."dw_datacenter_system_user" USING btree ("user_account");--> statement-breakpoint
CREATE INDEX "erp_system_users_phone_idx" ON "erp_staging"."dw_datacenter_system_user" USING btree ("user_telephone");--> statement-breakpoint
CREATE INDEX "ontology_entity_defs_version_idx" ON "platform"."ontology_entity_definitions" USING btree ("ontology_version_id");--> statement-breakpoint
CREATE INDEX "ontology_entity_defs_business_key_idx" ON "platform"."ontology_entity_definitions" USING btree ("business_key");--> statement-breakpoint
CREATE INDEX "ontology_entity_defs_version_key_idx" ON "platform"."ontology_entity_definitions" USING btree ("ontology_version_id","business_key");--> statement-breakpoint
CREATE INDEX "ontology_entity_defs_status_idx" ON "platform"."ontology_entity_definitions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ontology_factor_defs_version_idx" ON "platform"."ontology_factor_definitions" USING btree ("ontology_version_id");--> statement-breakpoint
CREATE INDEX "ontology_factor_defs_business_key_idx" ON "platform"."ontology_factor_definitions" USING btree ("business_key");--> statement-breakpoint
CREATE INDEX "ontology_factor_defs_version_key_idx" ON "platform"."ontology_factor_definitions" USING btree ("ontology_version_id","business_key");--> statement-breakpoint
CREATE INDEX "ontology_factor_defs_category_idx" ON "platform"."ontology_factor_definitions" USING btree ("category");--> statement-breakpoint
CREATE INDEX "ontology_factor_defs_status_idx" ON "platform"."ontology_factor_definitions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ontology_metric_defs_version_idx" ON "platform"."ontology_metric_definitions" USING btree ("ontology_version_id");--> statement-breakpoint
CREATE INDEX "ontology_metric_defs_business_key_idx" ON "platform"."ontology_metric_definitions" USING btree ("business_key");--> statement-breakpoint
CREATE INDEX "ontology_metric_defs_version_key_idx" ON "platform"."ontology_metric_definitions" USING btree ("ontology_version_id","business_key");--> statement-breakpoint
CREATE INDEX "ontology_metric_defs_status_idx" ON "platform"."ontology_metric_definitions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ontology_plan_step_tmpl_version_idx" ON "platform"."ontology_plan_step_templates" USING btree ("ontology_version_id");--> statement-breakpoint
CREATE INDEX "ontology_plan_step_tmpl_business_key_idx" ON "platform"."ontology_plan_step_templates" USING btree ("business_key");--> statement-breakpoint
CREATE INDEX "ontology_plan_step_tmpl_version_key_idx" ON "platform"."ontology_plan_step_templates" USING btree ("ontology_version_id","business_key");--> statement-breakpoint
CREATE INDEX "ontology_plan_step_tmpl_status_idx" ON "platform"."ontology_plan_step_templates" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ontology_versions_status_idx" ON "platform"."ontology_versions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ontology_versions_published_at_idx" ON "platform"."ontology_versions" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "erp_organizations_nature_idx" ON "erp_staging"."dw_datacenter_system_organization" USING btree ("organization_nature");--> statement-breakpoint
CREATE INDEX "erp_precincts_org_fk_idx" ON "erp_staging"."dw_datacenter_precinct" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_owner" DROP COLUMN "area_id";--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_bill" DROP COLUMN "area_id";--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_charge" DROP COLUMN "area_id";--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_services" DROP COLUMN "organization_path";--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_services" DROP COLUMN "area_id";