CREATE TABLE "erp_staging"."dw_datacenter_house" (
	"house_id" text PRIMARY KEY NOT NULL,
	"org_id" text,
	"precinct_id" text,
	"precinct_name" text,
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
	"rent_status" text,
	"owner_property" text,
	"is_block_up" integer,
	"is_delete" integer,
	"create_date" timestamp with time zone,
	"update_date" timestamp with time zone,
	"sync_date" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "erp_staging"."dw_datacenter_system_user" (
	"source_id" text PRIMARY KEY NOT NULL,
	"organization_id" text,
	"user_account" text,
	"password" text,
	"user_telephone" text,
	"user_password" text,
	"is_deleted" text,
	"is_actived" text,
	"sync_date" timestamp with time zone,
	"sys_date" date
);
--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_system_organization" ADD COLUMN "organization_code" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_system_organization" ADD COLUMN "organization_type" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_system_organization" ADD COLUMN "remark" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_system_organization" ADD COLUMN "version_id" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_system_organization" ADD COLUMN "create_user_id" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_system_organization" ADD COLUMN "create_user_name" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_system_organization" ADD COLUMN "create_time" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_system_organization" ADD COLUMN "update_user_id" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_system_organization" ADD COLUMN "update_user_name" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_system_organization" ADD COLUMN "update_time" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_precinct" ADD COLUMN "pro_nature" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_precinct" ADD COLUMN "green_area" numeric;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_precinct" ADD COLUMN "precinct_area" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_precinct" ADD COLUMN "create_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_precinct" ADD COLUMN "update_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_owner" ADD COLUMN "enterprise_id" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_owner" ADD COLUMN "is_delete" text;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_owner" ADD COLUMN "create_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_owner" ADD COLUMN "update_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_charge" ADD COLUMN "should_account_book" integer;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_charge" ADD COLUMN "account_book" integer;--> statement-breakpoint
ALTER TABLE "erp_staging"."dw_datacenter_charge" ADD COLUMN "actual_account_book" integer;--> statement-breakpoint
CREATE INDEX "erp_houses_org_idx" ON "erp_staging"."dw_datacenter_house" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "erp_houses_precinct_idx" ON "erp_staging"."dw_datacenter_house" USING btree ("precinct_id");--> statement-breakpoint
CREATE INDEX "erp_system_users_org_idx" ON "erp_staging"."dw_datacenter_system_user" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "erp_system_users_account_idx" ON "erp_staging"."dw_datacenter_system_user" USING btree ("user_account");
