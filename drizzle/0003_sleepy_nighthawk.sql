CREATE TABLE "platform"."job_dispatch_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"status" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"redis_stream_entry_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "platform"."job_events" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"event_type" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"worker_id" text,
	"message" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"payload" jsonb NOT NULL,
	"result" jsonb,
	"error" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"locked_by" text,
	"locked_until" timestamp with time zone,
	"redis_stream_entry_id" text,
	"dispatch_status" text DEFAULT 'pending' NOT NULL,
	"owner_user_id" text,
	"organization_id" text,
	"session_id" text,
	"origin_correlation_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"failed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "platform"."job_dispatch_outbox" ADD CONSTRAINT "job_dispatch_outbox_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "platform"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."job_events" ADD CONSTRAINT "job_events_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "platform"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_dispatch_outbox_status_updated_at_idx" ON "platform"."job_dispatch_outbox" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "job_dispatch_outbox_job_id_idx" ON "platform"."job_dispatch_outbox" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "job_events_job_id_created_at_idx" ON "platform"."job_events" USING btree ("job_id","created_at");--> statement-breakpoint
CREATE INDEX "job_events_event_type_created_at_idx" ON "platform"."job_events" USING btree ("event_type","created_at");--> statement-breakpoint
CREATE INDEX "jobs_status_available_at_idx" ON "platform"."jobs" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "jobs_locked_until_idx" ON "platform"."jobs" USING btree ("locked_until");--> statement-breakpoint
CREATE INDEX "jobs_owner_user_id_idx" ON "platform"."jobs" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "jobs_session_id_idx" ON "platform"."jobs" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "jobs_dispatch_status_idx" ON "platform"."jobs" USING btree ("dispatch_status","updated_at");--> statement-breakpoint
CREATE INDEX "jobs_created_at_idx" ON "platform"."jobs" USING btree ("created_at");