package com.dip3.ontologyagent.support;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import javax.sql.DataSource;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Cube facts 只读账号授权：在 Flyway 迁移成功后，把 FACTS_READER_ROLE 指定的既有角色
 * 授予 facts schema 的只读权限（USAGE + SELECT + 未来表的 DEFAULT PRIVILEGES）。
 *
 * <p>角色本身必须由 DBA/CREATEROLE 账号预创建（应用账号无建角色权限，
 * 见 scripts/sql/create-facts-reader-role.sql）；本组件只校验角色属性并执行幂等授权。
 * 本地开发使用超级用户连接 Cube 时可不配置，输出 facts_reader_grants_skipped。
 */
@Component
@Profile("migrate")
public final class FactsReaderGrants {
    private static final Logger log = LoggerFactory.getLogger(FactsReaderGrants.class);
    private static final Pattern ROLE_NAME = Pattern.compile("^[a-z_][a-z0-9_]{0,62}$");

    private final JdbcTemplate jdbc;
    private final String role;

    public FactsReaderGrants(DataSource dataSource,
            @Value("${dip3.database.facts-reader-role:}") String role) {
        this.jdbc = new JdbcTemplate(dataSource);
        this.role = role == null ? "" : role.trim();
    }

    public void apply() {
        if (role.isEmpty()) {
            log.info("facts_reader_grants_skipped reason=not-configured");
            return;
        }
        if (!ROLE_NAME.matcher(role).matches()) {
            throw new BackendException("FACTS_READER_ROLE_INVALID",
                    "FACTS_READER_ROLE 不是合法的 PostgreSQL 角色名：" + role);
        }
        Map<String, Object> attributes = jdbc.query(
                "select rolsuper, rolcreatedb, rolcreaterole from pg_roles where rolname = ?",
                rs -> rs.next()
                        ? Map.of("superuser", rs.getBoolean(1), "createdb", rs.getBoolean(2),
                                "createrole", rs.getBoolean(3))
                        : null,
                role);
        if (attributes == null) {
            throw new BackendException("FACTS_READER_ROLE_MISSING",
                    "facts 只读角色 " + role + " 在平台库中不存在；应用账号无建角色权限，请先以"
                            + " DBA/CREATEROLE 账号执行 scripts/easyv-dev facts-reader-sql"
                            + " 打印的建角色 SQL，再重新运行 migrate。");
        }
        if (Boolean.TRUE.equals(attributes.get("superuser"))
                || Boolean.TRUE.equals(attributes.get("createdb"))
                || Boolean.TRUE.equals(attributes.get("createrole"))) {
            throw new BackendException("FACTS_READER_ROLE_UNSAFE",
                    "facts 只读角色 " + role + " 不能持有 SUPERUSER/CREATEDB/CREATEROLE 权限；"
                            + "请使用最小权限角色后重新运行 migrate。");
        }
        jdbc.execute("GRANT USAGE ON SCHEMA facts TO \"" + role + "\"");
        jdbc.execute("GRANT SELECT ON ALL TABLES IN SCHEMA facts TO \"" + role + "\"");
        jdbc.execute("ALTER DEFAULT PRIVILEGES IN SCHEMA facts GRANT SELECT ON TABLES TO \"" + role + "\"");
        log.info("facts_reader_grants_applied role={}", role);
    }
}
