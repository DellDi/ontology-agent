package com.dip3.ontologyagent.easyv.internal.adapter.out.postgres;

import com.dip3.ontologyagent.config.EasyVPostgresProperties;
import com.dip3.ontologyagent.easyv.internal.application.EasyVGenerationFacts;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import javax.sql.DataSource;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.PlatformTransactionManager;

/** Wiring for the optional EasyV source database. It is absent when the feature is disabled. */
@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(prefix = "dip3.easyv", name = "enabled", havingValue = "true")
@EnableConfigurationProperties(EasyVPostgresProperties.class)
public class EasyVPostgresConfiguration {

  @Bean(name = "easyvDataSource", destroyMethod = "close")
  HikariDataSource easyvDataSource(EasyVPostgresProperties properties) {
    HikariConfig config = new HikariConfig();
    config.setPoolName("easyv-facts-readonly");
    config.setJdbcUrl(properties.jdbcUrl());
    config.setUsername(properties.username());
    config.setPassword(properties.password());
    config.setDriverClassName("org.postgresql.Driver");
    config.setMaximumPoolSize(properties.maximumPoolSize());
    config.setMinimumIdle(0);
    config.setConnectionTimeout(properties.connectionTimeout().toMillis());
    config.setValidationTimeout(properties.validationTimeout().toMillis());
    config.setInitializationFailTimeout(-1);
    config.setReadOnly(true);
    config.setConnectionInitSql("SET TIME ZONE 'Asia/Shanghai'; SET default_transaction_read_only = on; "
        + "SET statement_timeout = " + properties.statementTimeout().toMillis() + "; "
        + "SET lock_timeout = " + properties.lockTimeout().toMillis() + "; "
        + "SET idle_in_transaction_session_timeout = "
        + properties.idleInTransactionSessionTimeout().toMillis());
    return new HikariDataSource(config);
  }

  @Bean(name = "easyvTransactionManager")
  PlatformTransactionManager easyvTransactionManager(
      @Qualifier("easyvDataSource") DataSource easyvDataSource) {
    DataSourceTransactionManager manager = new DataSourceTransactionManager(easyvDataSource);
    manager.setEnforceReadOnly(true);
    return manager;
  }

  @Bean
  EasyVReadOnlyRoleGate easyVReadOnlyRoleGate(
      @Qualifier("easyvDataSource") DataSource easyvDataSource,
      EasyVPostgresProperties properties) {
    return new EasyVReadOnlyRoleGate(easyvDataSource, properties);
  }

  @Bean
  EasyVGenerationFacts easyVGenerationFacts(
      @Qualifier("easyvDataSource") DataSource easyvDataSource,
      @Qualifier("easyvTransactionManager") PlatformTransactionManager easyvTransactionManager,
      EasyVReadOnlyRoleGate roleGate,
      EasyVPostgresProperties properties) {
    return new EasyVPostgresFactAdapter(
        easyvDataSource, easyvTransactionManager, roleGate, properties);
  }
}
