CREATE UNIQUE INDEX "agent_invocations_agent_run_uidx" ON "platform"."agent_invocations" USING btree ("execution_id") WHERE kind = 'agent-run';
