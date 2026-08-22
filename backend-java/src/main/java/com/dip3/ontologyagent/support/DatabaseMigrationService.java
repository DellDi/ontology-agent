package com.dip3.ontologyagent.support;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationInfo;
import org.flywaydb.core.api.output.MigrateResult;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import javax.sql.DataSource;

/**
 * 数据库初始化：PostgreSQL 事实源 schema 由 Java 侧 Flyway 独占执行。
 *
 * <p>迁移脚本定位为「新库重建与初始化」：全部历史迁移已合并为单份
 * {@code V1__init.sql}，对全新空库一次性执行完整初始化。
 *
 * <p>策略（幂等 + fail loud，不允许对已有业务库静默重跑）：
 * <ul>
 *   <li>已存在 Flyway 历史 → 幂等增量迁移（已初始化则 no-op），并校验既有脚本 checksum。</li>
 *   <li>全新空库 → 执行 V1__init.sql 完成初始化。</li>
 *   <li>存在业务 schema（platform / erp_staging）但无 Flyway 历史 → 拒绝执行，
 *       提示先手动重建数据库（本脚本是初始化脚本，不会自动 drop 数据）。</li>
 * </ul>
 */
@Component
@Profile("migrate")
public final class DatabaseMigrationService {
    private static final Logger log = LoggerFactory.getLogger(DatabaseMigrationService.class);

    public enum Decision {
        /** 全新库，V1__init.sql 已完整执行 */
        INITIALIZED_FROM_EMPTY,
        /** 已存在 Flyway 历史，增量迁移完成（幂等） */
        MIGRATED_INCREMENTAL
    }

    private final JdbcTemplate jdbc;

    public DatabaseMigrationService(DataSource dataSource) {
        this.jdbc = new JdbcTemplate(dataSource);
    }

    public Decision run() {
        Flyway flyway = Flyway.configure()
                .dataSource(jdbc.getDataSource())
                .baselineOnMigrate(false)
                .locations("classpath:db/migration")
                .load();

        if (historyExists()) {
            MigrateResult result = flyway.migrate();
            log.info("flyway_migrate_incremental executed={} target={}",
                    result.migrationsExecuted, result.targetSchemaVersion);
            return Decision.MIGRATED_INCREMENTAL;
        }

        if (schemaExists("platform") || schemaExists("erp_staging")) {
            throw new IllegalStateException(
                    "数据库已存在业务 schema（platform/erp_staging）但没有 Flyway 历史。"
                            + "迁移脚本是全新库初始化脚本，不会对已有库执行，也不会自动 drop 数据。"
                            + "如需重建请先手动删除数据库或数据卷，再重新初始化。");
        }

        MigrateResult result = flyway.migrate();
        log.info("flyway_init_fresh executed={} target={}",
                result.migrationsExecuted, result.targetSchemaVersion);
        return Decision.INITIALIZED_FROM_EMPTY;
    }

    public MigrationInfo[] pendingMigrations() {
        Flyway flyway = Flyway.configure()
                .dataSource(jdbc.getDataSource())
                .baselineOnMigrate(false)
                .locations("classpath:db/migration")
                .load();
        return flyway.info().pending();
    }

    private boolean historyExists() {
        return Boolean.TRUE.equals(jdbc.queryForObject(
                "select to_regclass('public.flyway_schema_history') is not null", Boolean.class));
    }

    private boolean schemaExists(String schema) {
        return Boolean.TRUE.equals(jdbc.queryForObject(
                "select exists (select 1 from information_schema.schemata where schema_name = ?)",
                Boolean.class, schema));
    }
}
