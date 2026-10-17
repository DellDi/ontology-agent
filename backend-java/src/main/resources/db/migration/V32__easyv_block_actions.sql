CREATE TABLE IF NOT EXISTS platform.easyv_block_actions (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES platform.analysis_sessions(id),
  invocation_id text NOT NULL REFERENCES platform.agent_invocations(id),
  owner_user_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('prepared','applying','verified','context_pending','unknown','conflict','failed')),
  prepared jsonb NOT NULL,
  result jsonb,
  error_message text,
  confirmed_at timestamptz,
  history jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS easyv_block_actions_session_idx ON platform.easyv_block_actions(session_id, created_at);
