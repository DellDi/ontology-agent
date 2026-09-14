-- 平台自有身份体系：统一业务账号与平台管理员账号。
-- Provider（local/bridge/未来外部 IdP）只证明"你是谁"；
-- 角色与组织归属由平台库中的 role_grants / accounts.organization_id 决定。
-- 既有 platform.admin_accounts 迁入 identity.accounts 并授予 PLATFORM_ADMIN，随后删除旧表。

CREATE SCHEMA IF NOT EXISTS identity;

CREATE TABLE IF NOT EXISTS identity.accounts (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account text NOT NULL UNIQUE,
    display_name text NOT NULL,
    password_hash text,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    source text NOT NULL DEFAULT 'local' CHECK (source IN ('local', 'bridge', 'external')),
    organization_id text,
    failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
    locked_until timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS identity.role_grants (
    account_id bigint NOT NULL REFERENCES identity.accounts (id) ON DELETE CASCADE,
    role_code text NOT NULL,
    granted_by text,
    granted_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, role_code)
);

--> statement-breakpoint

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables
               WHERE schemaname = 'platform' AND tablename = 'admin_accounts') THEN
        INSERT INTO identity.accounts (account, display_name, password_hash, source, organization_id)
        SELECT username, '平台管理员', password_hash, 'local', 'platform'
        FROM platform.admin_accounts
        ON CONFLICT (account) DO NOTHING;

        INSERT INTO identity.role_grants (account_id, role_code, granted_by)
        SELECT a.id, 'PLATFORM_ADMIN', 'migration-v16'
        FROM identity.accounts a
        JOIN platform.admin_accounts legacy ON legacy.username = a.account
        ON CONFLICT DO NOTHING;

        DROP TABLE platform.admin_accounts;
    END IF;
END $$;
