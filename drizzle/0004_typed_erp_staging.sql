DROP TABLE IF EXISTS "erp_staging"."dw_datacenter_system_user" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "erp_staging"."dw_datacenter_house" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "erp_staging"."dw_datacenter_services" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "erp_staging"."dw_datacenter_bill" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "erp_staging"."dw_datacenter_charge" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "erp_staging"."dw_datacenter_chargeitem" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "erp_staging"."dw_datacenter_owner" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "erp_staging"."dw_datacenter_precinct" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "erp_staging"."dw_datacenter_system_organization" CASCADE;
--> statement-breakpoint
CREATE TABLE "erp_staging"."dw_datacenter_system_organization" (
	"source_id" bigint PRIMARY KEY NOT NULL,
	"enterprise_id" bigint,
	"group_id" bigint,
	"company_id" bigint,
	"department_id" bigint,
	"organization_parent_id" bigint,
	"organization_name" text NOT NULL,
	"organization_short_name" text,
	"organization_code" text,
	"organization_type" integer,
	"organization_enable_state" integer,
	"organization_path" text,
	"organization_level" integer,
	"organization_order_column" integer,
	"is_deleted" integer,
	"remark" text,
	"version_id" bigint,
	"create_user_id" bigint,
	"create_user_name" text,
	"create_time" timestamp with time zone,
	"update_user_id" bigint,
	"update_user_name" text,
	"update_time" timestamp with time zone,
	"sync_department_id" text,
	"sync_organization_id" text,
	"sync_organization_parent_id" text,
	"sync_status" integer,
	"organization_dimension" text,
	"organization_dimension_alias_name" text,
	"organization_scope" text,
	"organization_manager_id" text,
	"organization_part_manager_id" text,
	"organization_hr_type_code" text,
	"organization_hierarchical_class_code" text,
	"organization_stage_code" text,
	"organization_stage_level_code" text,
	"organization_source" text,
	"organization_nature" text,
	"data_analysis_type" text,
	"sys_date" date
);
--> statement-breakpoint
CREATE TABLE "erp_staging"."dw_datacenter_precinct" (
	"record_id" bigint,
	"enterprise_id" text,
	"data_source" text,
	"org_id" text,
	"area_id" text,
	"area_name" text,
	"precinct_id" text PRIMARY KEY NOT NULL,
	"precinct_no" text,
	"precinct_name" text NOT NULL,
	"delivery_time" timestamp with time zone,
	"province_id" text,
	"city_id" text,
	"area_city_id" text,
	"street_id" text,
	"pro_nature" text,
	"check_merger" text,
	"check_old_precinct" text,
	"old_tax_rate" numeric(3, 2),
	"precinct_type" text,
	"precinct_type_name" text,
	"is_delete" integer,
	"create_date" timestamp with time zone,
	"update_date" timestamp with time zone,
	"sync_date" timestamp with time zone,
	"contract_area" numeric,
	"green_area" numeric,
	"nozzle_area" numeric,
	"pay_charge_area" numeric,
	"precinct_area" text,
	"total_house_holder" integer,
	"parking_amount" integer,
	"organization_id" bigint,
	"delete_flag" integer,
	"create_user_id" bigint,
	"create_user_name" text,
	"create_date_time" date,
	"update_user_id" bigint,
	"update_user_name" text,
	"update_date_time" date
);
--> statement-breakpoint
CREATE TABLE "erp_staging"."dw_datacenter_owner" (
	"record_id" bigint PRIMARY KEY NOT NULL,
	"enterprise_id" text,
	"data_source" text,
	"org_id" text,
	"precinct_id" text NOT NULL,
	"precinct_name" text,
	"house_id" text,
	"house_name" text,
	"owner_id" text NOT NULL,
	"owner_name" text NOT NULL,
	"owner_type" text,
	"is_current" text,
	"is_delete" integer,
	"create_date" timestamp with time zone,
	"update_date" timestamp with time zone,
	"sync_date" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "erp_staging"."dw_datacenter_chargeitem" (
	"record_id" bigint,
	"enterprise_id" text,
	"organization_id" text,
	"data_source" text,
	"charge_item_id" text PRIMARY KEY NOT NULL,
	"charge_item_code" text,
	"charge_item_name" text NOT NULL,
	"charge_item_type" text,
	"charge_item_type_name" text,
	"tax_rate" numeric(3, 2),
	"item_group_id" bigint,
	"item_detail_group_id" bigint,
	"cash_flow_group_id" bigint,
	"charge_item_class" integer,
	"charge_item_class_name" text,
	"path" text,
	"create_date" timestamp with time zone,
	"update_date" timestamp with time zone,
	"sync_date" timestamp with time zone,
	"delete_flag" integer,
	"create_user_id" bigint,
	"create_user_name" text,
	"create_date_time" date,
	"update_user_id" bigint,
	"update_user_name" text,
	"update_date_time" date,
	"charge_item_out_type" text,
	"one_level_charge_item_name" text
);
--> statement-breakpoint
CREATE TABLE "erp_staging"."dw_datacenter_charge" (
	"record_id" bigint PRIMARY KEY NOT NULL,
	"db_id" integer,
	"enterprise_id" text,
	"organization_id" text NOT NULL,
	"data_source" text,
	"charge_detail_id" text,
	"precinct_id" text,
	"precinct_name" text,
	"house_id" text,
	"house_name" text,
	"room_type" text,
	"charge_area" numeric,
	"owner_id" text,
	"owner_name" text,
	"charge_item_id" text,
	"charge_item_code" text,
	"charge_item_name" text,
	"should_account_book" integer,
	"should_charge_date" timestamp with time zone,
	"calc_start_date" timestamp with time zone,
	"calc_end_date" timestamp with time zone,
	"calc_end_year" integer,
	"amount" numeric,
	"actual_charge_sum" numeric,
	"charge_sum" numeric,
	"discount" numeric,
	"delay_sum" numeric,
	"delay_discount" numeric,
	"paid_charge_sum" numeric,
	"arrears" numeric,
	"is_check" text,
	"is_estate" integer,
	"is_delete" integer,
	"create_date" timestamp with time zone,
	"update_date" timestamp with time zone,
	"sync_date" timestamp with time zone,
	"is_freezed" integer,
	"discount_date" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "erp_staging"."dw_datacenter_bill" (
	"record_id" bigint PRIMARY KEY NOT NULL,
	"db_id" integer,
	"enterprise_id" text,
	"organization_id" text NOT NULL,
	"data_source" text,
	"charge_payment_id" text,
	"charge_detail_id" text,
	"precinct_id" text,
	"precinct_name" text,
	"house_id" text,
	"house_name" text,
	"room_type" text,
	"owner_id" text,
	"owner_name" text,
	"charge_item_id" text,
	"charge_item_code" text,
	"charge_item_name" text,
	"calc_start_date" timestamp with time zone,
	"calc_end_date" timestamp with time zone,
	"calc_end_year" integer,
	"should_account_book" integer,
	"account_book" integer,
	"actual_account_book" integer,
	"charge_paid" numeric,
	"discount" numeric,
	"delay_sum" numeric,
	"operator_date" timestamp with time zone,
	"paid_year" integer,
	"paid_month" integer,
	"paid_day" integer,
	"is_enter_account" text,
	"charge_area" numeric,
	"subject_code" text,
	"source_income" text,
	"square_type_id" text,
	"square_type_name" text,
	"is_canceled" text,
	"is_delete" integer,
	"data_type" integer,
	"precinct_collection_type" integer,
	"refund_status" text,
	"update_date" timestamp with time zone,
	"sync_date" timestamp with time zone,
	"is_account" integer
);
--> statement-breakpoint
CREATE TABLE "erp_staging"."dw_datacenter_services" (
	"record_id" bigint,
	"enterprise_id" text,
	"organization_id" text NOT NULL,
	"data_source" text,
	"precinct_id" text,
	"precinct_name" text,
	"house_id" text,
	"customer_id" integer,
	"customer_house_id" integer,
	"customer_house_name" text,
	"customer_name" text,
	"house_name" text,
	"services_no" text PRIMARY KEY NOT NULL,
	"content" text,
	"create_user_name" text,
	"create_date_time" timestamp with time zone,
	"update_date_time" timestamp with time zone,
	"is_delete" integer,
	"create_year" integer,
	"create_month" integer,
	"dispatching_user_name" text,
	"dispatching_date" timestamp with time zone,
	"accept_user_name" text,
	"accept_date" timestamp with time zone,
	"arrive_date" timestamp with time zone,
	"reception_date" timestamp with time zone,
	"accomplish_user_name" text,
	"accomplish_date" timestamp with time zone,
	"service_status" text,
	"service_status_name" text,
	"service_type_id" text,
	"service_type_name" text,
	"service_source_id" text,
	"service_source_name" text,
	"service_style_id" text,
	"service_style_name" text,
	"is_completed" text,
	"is_over_time" text,
	"is_reprocess" text,
	"is_return_visit" text,
	"satisfaction" integer,
	"sync_date" timestamp with time zone,
	"accept_over_time" integer,
	"satisfaction_eval" integer,
	"service_pay_type_id" integer,
	"one_type_name" text,
	"second_type_name" text,
	"three_type_name" text,
	"service_kind_id" text,
	"service_kind_id_name" text
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
CREATE INDEX "erp_organizations_parent_idx" ON "erp_staging"."dw_datacenter_system_organization" USING btree ("organization_parent_id");
--> statement-breakpoint
CREATE INDEX "erp_organizations_path_idx" ON "erp_staging"."dw_datacenter_system_organization" USING btree ("organization_path");
--> statement-breakpoint
CREATE INDEX "erp_organizations_nature_idx" ON "erp_staging"."dw_datacenter_system_organization" USING btree ("organization_nature");
--> statement-breakpoint
CREATE INDEX "erp_precincts_org_idx" ON "erp_staging"."dw_datacenter_precinct" USING btree ("org_id");
--> statement-breakpoint
CREATE INDEX "erp_precincts_area_idx" ON "erp_staging"."dw_datacenter_precinct" USING btree ("area_id");
--> statement-breakpoint
CREATE INDEX "erp_precincts_org_fk_idx" ON "erp_staging"."dw_datacenter_precinct" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "erp_owners_owner_idx" ON "erp_staging"."dw_datacenter_owner" USING btree ("owner_id");
--> statement-breakpoint
CREATE INDEX "erp_owners_project_idx" ON "erp_staging"."dw_datacenter_owner" USING btree ("precinct_id");
--> statement-breakpoint
CREATE INDEX "erp_charge_items_org_idx" ON "erp_staging"."dw_datacenter_chargeitem" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "erp_receivables_project_idx" ON "erp_staging"."dw_datacenter_charge" USING btree ("precinct_id");
--> statement-breakpoint
CREATE INDEX "erp_receivables_owner_idx" ON "erp_staging"."dw_datacenter_charge" USING btree ("owner_id");
--> statement-breakpoint
CREATE INDEX "erp_payments_project_idx" ON "erp_staging"."dw_datacenter_bill" USING btree ("precinct_id");
--> statement-breakpoint
CREATE INDEX "erp_payments_owner_idx" ON "erp_staging"."dw_datacenter_bill" USING btree ("owner_id");
--> statement-breakpoint
CREATE INDEX "erp_service_orders_project_idx" ON "erp_staging"."dw_datacenter_services" USING btree ("precinct_id");
--> statement-breakpoint
CREATE INDEX "erp_service_orders_style_idx" ON "erp_staging"."dw_datacenter_services" USING btree ("service_style_name");
--> statement-breakpoint
CREATE INDEX "erp_houses_org_idx" ON "erp_staging"."dw_datacenter_house" USING btree ("org_id");
--> statement-breakpoint
CREATE INDEX "erp_houses_precinct_idx" ON "erp_staging"."dw_datacenter_house" USING btree ("precinct_id");
--> statement-breakpoint
CREATE INDEX "erp_system_users_org_idx" ON "erp_staging"."dw_datacenter_system_user" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "erp_system_users_account_idx" ON "erp_staging"."dw_datacenter_system_user" USING btree ("user_account");
--> statement-breakpoint
CREATE INDEX "erp_system_users_phone_idx" ON "erp_staging"."dw_datacenter_system_user" USING btree ("user_telephone");
