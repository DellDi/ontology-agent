CREATE INDEX "analysis_execution_snapshots_session_updated_idx" ON "platform"."analysis_execution_snapshots" USING btree ("session_id","updated_at" DESC);
