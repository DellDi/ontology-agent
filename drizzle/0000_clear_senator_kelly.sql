CREATE SCHEMA "platform";
--> statement-breakpoint
CREATE TABLE "platform"."analysis_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"question_text" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."auth_sessions" (
	"session_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"display_name" text NOT NULL,
	"organization_id" text NOT NULL,
	"project_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"area_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"role_codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "analysis_sessions_owner_user_id_idx" ON "platform"."analysis_sessions" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "analysis_sessions_updated_at_idx" ON "platform"."analysis_sessions" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_id_idx" ON "platform"."auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_expires_at_idx" ON "platform"."auth_sessions" USING btree ("expires_at");