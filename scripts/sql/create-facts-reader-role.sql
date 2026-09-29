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

CREATE ROLE :"role" LOGIN PASSWORD :'password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
GRANT CONNECT ON DATABASE :"database" TO :"role";
