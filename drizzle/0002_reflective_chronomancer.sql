CREATE SCHEMA "erp_staging";
--> statement-breakpoint
CREATE TABLE "erp_staging"."dw_datacenter_chargeitem" (
	"charge_item_id" text PRIMARY KEY NOT NULL,
	"charge_item_code" text,
	"charge_item_name" text NOT NULL,
	"charge_item_type" text,
	"charge_item_type_name" text,
	"charge_item_class" text,
	"charge_item_class_name" text,
	"one_level_charge_item_name" text,
	"organization_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "erp_staging"."dw_datacenter_system_organization" (
	"source_id" text PRIMARY KEY NOT NULL,
	"organization_parent_id" text,
	"organization_path" text,
	"organization_level" integer,
	"organization_name" text NOT NULL,
	"organization_short_name" text,
	"organization_nature" text,
	"enterprise_id" text,
	"group_id" text,
	"company_id" text,
	"department_id" text,
	"organization_enable_state" text,
	"is_deleted" text
);
--> statement-breakpoint
CREATE TABLE "erp_staging"."dw_datacenter_owner" (
	"record_id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"owner_name" text NOT NULL,
	"owner_type" text,
	"is_current" text,
	"house_id" text,
	"house_name" text,
	"precinct_id" text NOT NULL,
	"precinct_name" text,
	"org_id" text NOT NULL,
	"area_id" text
);
--> statement-breakpoint
CREATE TABLE "erp_staging"."dw_datacenter_bill" (
	"record_id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"precinct_id" text,
	"precinct_name" text,
	"area_id" text,
	"house_id" text,
	"house_name" text,
	"owner_id" text,
	"owner_name" text,
	"charge_item_id" text,
	"charge_item_code" text,
	"charge_item_name" text,
	"charge_detail_id" text,
	"charge_paid" numeric,
	"discount" numeric,
	"delay_sum" numeric,
	"operator_date" timestamp with time zone,
	"calc_start_date" timestamp with time zone,
	"calc_end_date" timestamp with time zone,
	"is_enter_account" text,
	"is_canceled" text,
	"data_type" text,
	"refund_status" text,
	"is_account" text,
	"is_delete" text
);
--> statement-breakpoint
CREATE TABLE "erp_staging"."dw_datacenter_precinct" (
	"precinct_id" text PRIMARY KEY NOT NULL,
	"precinct_no" text,
	"precinct_name" text NOT NULL,
	"org_id" text NOT NULL,
	"organization_id" text,
	"enterprise_id" text,
	"area_id" text,
	"area_name" text,
	"precinct_type" text,
	"precinct_type_name" text,
	"delivery_time" timestamp with time zone,
	"contract_area" numeric,
	"nozzle_area" numeric,
	"pay_charge_area" numeric,
	"total_house_holder" integer,
	"is_delete" text,
	"delete_flag" text
);
--> statement-breakpoint
CREATE TABLE "erp_staging"."dw_datacenter_charge" (
	"record_id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"precinct_id" text,
	"precinct_name" text,
	"area_id" text,
	"house_id" text,
	"house_name" text,
	"owner_id" text,
	"owner_name" text,
	"charge_item_id" text,
	"charge_item_code" text,
	"charge_item_name" text,
	"charge_sum" numeric,
	"actual_charge_sum" numeric,
	"paid_charge_sum" numeric,
	"arrears" numeric,
	"discount" numeric,
	"delay_sum" numeric,
	"delay_discount" numeric,
	"should_charge_date" timestamp with time zone,
	"calc_start_date" timestamp with time zone,
	"calc_end_date" timestamp with time zone,
	"create_date" timestamp with time zone,
	"update_date" timestamp with time zone,
	"is_check" text,
	"is_delete" text,
	"is_freezed" text
);
--> statement-breakpoint
CREATE TABLE "erp_staging"."dw_datacenter_services" (
	"services_no" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"organization_path" text,
	"precinct_id" text,
	"precinct_name" text,
	"area_id" text,
	"house_id" text,
	"customer_id" text,
	"customer_name" text,
	"service_type_id" text,
	"service_type_name" text,
	"service_style_id" text,
	"service_style_name" text,
	"service_kind_id" text,
	"service_kind_id_name" text,
	"service_source_id" text,
	"service_source_name" text,
	"service_status" text,
	"service_status_name" text,
	"content" text,
	"create_date_time" timestamp with time zone,
	"accomplish_date" timestamp with time zone,
	"update_date_time" timestamp with time zone,
	"satisfaction" numeric,
	"satisfaction_eval" integer,
	"is_completed" text,
	"is_delete" text
);
--> statement-breakpoint
CREATE INDEX "erp_charge_items_org_idx" ON "erp_staging"."dw_datacenter_chargeitem" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "erp_organizations_parent_idx" ON "erp_staging"."dw_datacenter_system_organization" USING btree ("organization_parent_id");--> statement-breakpoint
CREATE INDEX "erp_organizations_path_idx" ON "erp_staging"."dw_datacenter_system_organization" USING btree ("organization_path");--> statement-breakpoint
CREATE INDEX "erp_owners_owner_idx" ON "erp_staging"."dw_datacenter_owner" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "erp_owners_project_idx" ON "erp_staging"."dw_datacenter_owner" USING btree ("precinct_id");--> statement-breakpoint
CREATE INDEX "erp_payments_project_idx" ON "erp_staging"."dw_datacenter_bill" USING btree ("precinct_id");--> statement-breakpoint
CREATE INDEX "erp_payments_owner_idx" ON "erp_staging"."dw_datacenter_bill" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "erp_precincts_org_idx" ON "erp_staging"."dw_datacenter_precinct" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "erp_precincts_area_idx" ON "erp_staging"."dw_datacenter_precinct" USING btree ("area_id");--> statement-breakpoint
CREATE INDEX "erp_receivables_project_idx" ON "erp_staging"."dw_datacenter_charge" USING btree ("precinct_id");--> statement-breakpoint
CREATE INDEX "erp_receivables_owner_idx" ON "erp_staging"."dw_datacenter_charge" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "erp_service_orders_project_idx" ON "erp_staging"."dw_datacenter_services" USING btree ("precinct_id");--> statement-breakpoint
CREATE INDEX "erp_service_orders_style_idx" ON "erp_staging"."dw_datacenter_services" USING btree ("service_style_name");