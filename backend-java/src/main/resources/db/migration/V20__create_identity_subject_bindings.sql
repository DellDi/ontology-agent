-- 平台账号与外部数据源主体的绑定（如 EasyV user_id）。
-- 通用于所有接入源：source_key 为数据源，subject_key 为该源的授权维度，subject_value 为主体标识。
-- 数据范围由各领域按绑定解析；无绑定的非管理员账号不得访问按主体限定的数据。

CREATE TABLE IF NOT EXISTS identity.subject_bindings (
    account_id bigint NOT NULL REFERENCES identity.accounts (id) ON DELETE CASCADE,
    source_key text NOT NULL CHECK (source_key ~ '^[a-z][a-z0-9-]{0,63}$'),
    subject_key text NOT NULL CHECK (subject_key ~ '^[a-zA-Z][a-zA-Z0-9]{0,63}$'),
    subject_value text NOT NULL CHECK (btrim(subject_value) <> '' AND length(subject_value) <= 200),
    bound_by text,
    bound_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, source_key, subject_key)
);
