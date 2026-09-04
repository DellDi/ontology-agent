package com.dip3.ontologyagent.config;

import com.zaxxer.hikari.HikariDataSource;
import javax.sql.DataSource;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.jdbc.autoconfigure.DataSourceProperties;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.PlatformTransactionManager;

/** Keeps the application's write-capable datasource when the optional EasyV datasource is enabled. */
@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(prefix = "dip3.easyv", name = "enabled", havingValue = "true")
class EasyVPrimaryDataSourceConfiguration {

  @Bean(name = "dataSource")
  @Primary
  @ConditionalOnMissingBean(name = "dataSource")
  @ConfigurationProperties("spring.datasource.hikari")
  HikariDataSource dataSource(DataSourceProperties properties) {
    return properties.initializeDataSourceBuilder()
        .type(HikariDataSource.class)
        .build();
  }

  @Bean(name = "transactionManager")
  @Primary
  @ConditionalOnMissingBean(name = "transactionManager")
  PlatformTransactionManager transactionManager(@Qualifier("dataSource") DataSource dataSource) {
    return new DataSourceTransactionManager(dataSource);
  }
}
