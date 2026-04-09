CREATE SEQUENCE "platform"."analysis_session_follow_ups_created_order_seq";
--> statement-breakpoint
ALTER TABLE "platform"."analysis_session_follow_ups"
  ADD COLUMN "created_order" bigint;
--> statement-breakpoint
ALTER TABLE "platform"."analysis_session_follow_ups"
  ALTER COLUMN "created_order" SET DEFAULT nextval('"platform"."analysis_session_follow_ups_created_order_seq"');
--> statement-breakpoint
ALTER SEQUENCE "platform"."analysis_session_follow_ups_created_order_seq"
  OWNED BY "platform"."analysis_session_follow_ups"."created_order";
--> statement-breakpoint
UPDATE "platform"."analysis_session_follow_ups"
SET "created_order" = nextval('"platform"."analysis_session_follow_ups_created_order_seq"')
WHERE "created_order" IS NULL;
--> statement-breakpoint
ALTER TABLE "platform"."analysis_session_follow_ups"
  ALTER COLUMN "created_order" SET NOT NULL;
--> statement-breakpoint
CREATE INDEX "analysis_session_follow_ups_session_created_order_idx"
  ON "platform"."analysis_session_follow_ups" ("session_id", "created_order");
