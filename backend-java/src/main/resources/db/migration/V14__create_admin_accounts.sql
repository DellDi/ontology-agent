CREATE TABLE IF NOT EXISTS platform.admin_accounts (
    username text PRIMARY KEY,
    user_id text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
    locked_until timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
