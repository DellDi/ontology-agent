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
 * <p>V1 定位为「新库重建与初始化的 init 脚本」：全部历史迁移已合并为
 * {@code V1__init.sql}，且脚本本身幂等（IF NOT EXISTS），后续变更使用 V2+：
 * <ul>
 *   <li>全新空库 → 完整初始化全部 schema/表/索引。</li>
 *   <li>已初始化库（有 Flyway 历史）→ Flyway 校验 checksum 后 no-op，不重跑。</li>
 *   <li>无 Flyway 历史的旧业务库 → baseline 0 后仍执行 V1（脚本幂等补全缺失列/索引），
 *       不会丢数据、不会报错。</li>
 * </ul>
 * <p>baselineVersion 固定为 0：任何已有库都不会跳过 V1 迁移（区别于默认 baseline 1 跳过首个迁移）。
 */
@Component
@Profile("migrate")
public final class DatabaseMigrationService {
    private static final Logger log = LoggerFactory.getLogger(DatabaseMigrationService.class);

    public enum Decision {
        /** 首次执行（执行前无 Flyway 历史），初始化完成 */
        INITIALIZED,
        /** 已存在 Flyway 历史，重复执行（幂等 no-op 或增量） */
        MIGRATED_INCREMENTAL
    }

    private final JdbcTemplate jdbc;

    public DatabaseMigrationService(DataSource dataSource) {
        this.jdbc = new JdbcTemplate(dataSource);
    }

    public Decision run() {
        boolean hadHistory = historyExists();

        Flyway flyway = Flyway.configure()
                .dataSource(jdbc.getDataSource())
                .baselineOnMigrate(true)
                .baselineVersion("0")
                .locations("classpath:db/migration")
                .load();
        MigrateResult result = flyway.migrate();

        if (hadHistory) {
            log.info("flyway_migrate_incremental executed={} target={}",
                    result.migrationsExecuted, result.targetSchemaVersion);
            return Decision.MIGRATED_INCREMENTAL;
        }
        log.info("flyway_init_complete executed={} target={}",
                result.migrationsExecuted, result.targetSchemaVersion);
        return Decision.INITIALIZED;
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
}
