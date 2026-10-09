package com.dip3.ontologyagent.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.config.BeanFactoryPostProcessor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;

/** 在任何数据源、Worker 与调度器创建之前完成环境校验；校验失败时进程无法启动。 */
@Configuration(proxyBeanMethods = false)
class RuntimeEnvironmentConfiguration {
  private static final Logger log = LoggerFactory.getLogger(RuntimeEnvironmentConfiguration.class);

  @Bean
  static BeanFactoryPostProcessor runtimeEnvironmentGuard(Environment properties) {
    return beanFactory -> {
      var environment = RuntimeEnvironment.resolve(
          properties.getProperty("dip3.environment.name", RuntimeEnvironment.LOCAL_DEV),
          properties.getProperty("dip3.environment.label", ""),
          properties.getProperty("spring.datasource.url"),
          properties.getProperty("dip3.environment.allow-remote-database", Boolean.class, false));
      var database = environment.database();
      log.info("runtime_environment name={} kind={} database={} remoteDatabase={}", environment.name(), environment.kind(),
          database == null ? "none" : database.host() + ":" + database.port() + "/" + database.name(), environment.remoteDatabase());
      if (environment.remoteDatabase()) {
        log.warn("runtime_environment_remote_database_allowed name={} DIP3_ALLOW_REMOTE_DATABASE=true；本进程的 Worker 将与该库上的其他实例并行消费任务", environment.name());
      }
      beanFactory.registerSingleton("runtimeEnvironment", environment);
    };
  }
}
