-- Cube facts 只读角色的一次性创建脚本。
--
-- 应用账号（JAVA_DATABASE_USERNAME）没有 CREATEROLE/超级用户权限，无法自建角色；
-- 本脚本必须由 DBA 或持有 CREATEROLE 的账号执行一次：
--
--   psql '<DBA 连接串>' -v role=<role> -v password='<password>' -v database=<database> \
--     -f scripts/sql/create-facts-reader-role.sql
--
-- facts schema 内的 USAGE/SELECT 与 DEFAULT PRIVILEGES 授权由 `migrate` 进程在
-- Flyway 成功后幂等执行（dip3.database.facts-reader-role / FACTS_READER_ROLE），
-- 不在本脚本中重复。

\set ON_ERROR_STOP on
-- 发布种子通过进程环境传入口令，避免出现在命令参数中。
\if :{?password}
\else
\getenv password CUBE_DATABASE_PASSWORD
\endif
-- 重复发布保留既有角色与口令；角色属性由 migrate 校验，不静默修正过大权限。
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION', :'role', :'password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'role')
\gexec
GRANT CONNECT ON DATABASE :"database" TO :"role";
