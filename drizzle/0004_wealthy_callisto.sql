CREATE TABLE "spring_ai_chat_memory" (
	"conversation_id" varchar(36) NOT NULL,
	"content" text NOT NULL,
	"type" varchar(10) NOT NULL,
	"timestamp" timestamp NOT NULL,
	"sequence_id" bigint NOT NULL,
	CONSTRAINT "spring_ai_chat_memory_type_check" CHECK (type in ('USER', 'ASSISTANT', 'SYSTEM', 'TOOL'))
);
--> statement-breakpoint
CREATE INDEX "spring_ai_chat_memory_conversation_id_timestamp_idx" ON "spring_ai_chat_memory" USING btree ("conversation_id","timestamp");--> statement-breakpoint
CREATE INDEX "spring_ai_chat_memory_conversation_id_sequence_id_idx" ON "spring_ai_chat_memory" USING btree ("conversation_id","sequence_id");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_execution_snapshots_follow_up_id_uidx" ON "platform"."analysis_execution_snapshots" USING btree ("follow_up_id") WHERE follow_up_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_session_follow_ups_result_execution_uidx" ON "platform"."analysis_session_follow_ups" USING btree ("result_execution_id") WHERE result_execution_id is not null;
