package com.dip3.ontologyagent.support;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

/**
 * 独立迁移入口：`--spring.profiles.active=migrate` 时执行 Flyway 迁移后退出。
 *
 * <p>用于 compose migrate 服务与 CI 的显式迁移步骤，应用常规启动不会自动迁移
 * （application.yml 中 spring.flyway.enabled=false）。
 */
@Component
@Profile("migrate")
public final class DatabaseMigrationRunner implements ApplicationRunner {
    private static final Logger log = LoggerFactory.getLogger(DatabaseMigrationRunner.class);

    private final DatabaseMigrationService migration;

    public DatabaseMigrationRunner(DatabaseMigrationService migration) {
        this.migration = migration;
    }

    @Override
    public void run(ApplicationArguments args) {
        try {
            DatabaseMigrationService.Decision decision = migration.run();
            log.info("flyway_migrate_complete decision={}", decision);
            System.exit(0);
        } catch (Exception error) {
            log.error("flyway_migrate_failed message={}", error.getMessage(), error);
            System.exit(1);
        }
    }
}
