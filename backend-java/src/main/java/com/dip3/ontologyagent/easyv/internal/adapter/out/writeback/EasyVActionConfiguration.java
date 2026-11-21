package com.dip3.ontologyagent.easyv.internal.adapter.out.writeback;

import com.dip3.ontologyagent.config.EasyVActionProperties;
import com.dip3.ontologyagent.easyv.internal.application.EasyVBlockActionPort;
import com.dip3.ontologyagent.easyv.internal.application.EasyVWritebackContractPort;
import io.lettuce.core.RedisClient;
import io.lettuce.core.RedisURI;
import io.lettuce.core.api.StatefulRedisConnection;
import io.lettuce.core.api.sync.RedisCommands;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.time.Duration;
import java.util.Properties;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(prefix = "dip3.easyv", name = "enabled", havingValue = "true")
@EnableConfigurationProperties(EasyVActionProperties.class)
public class EasyVActionConfiguration {

  @Bean
  EasyVBlockActionPort easyVBlockActionPort(EasyVActionProperties properties,
      ObjectProvider<SharedActionConnections> connections) {
    if (!properties.enabled()) {
      return new EasyVBlockActionDatabaseAdapter(null, null, properties.schema());
    }
    SharedActionConnections shared = connections.getObject();
    return new EasyVBlockActionDatabaseAdapter(
        shared.jdbc(), shared.redisCommandsProxy(), properties.schema());
  }

  @Bean
  EasyVWritebackContractPort easyVWritebackContractPort(EasyVActionProperties properties,
      ObjectProvider<SharedActionConnections> connections) {
    if (!properties.enabled()) {
      return EasyVWritebackContractProbe.disabled(
          properties.schema(),
          "EasyV 写回未启用（dip3.easyv.action.enabled=false），探针未连接写回源库与源 Redis。");
    }
    SharedActionConnections shared = connections.getObject();
    return new EasyVWritebackContractProbe(
        shared.jdbc(), shared::redisCommands, properties.schema());
  }

  @Configuration(proxyBeanMethods = false)
  @ConditionalOnProperty(prefix = "dip3.easyv", name = {"enabled", "action.enabled"}, havingValue = "true")
  static class Connections {
    @Bean(name = "easyvActionRedisClient", destroyMethod = "shutdown")
    RedisClient redisClient(EasyVActionProperties properties) {
      RedisURI uri;
      try {
        uri = RedisURI.create(properties.redisUrl());
      } catch (IllegalArgumentException error) {
        throw new IllegalArgumentException("EasyV 源 Redis URL 不合法");
      }
      uri.setTimeout(Duration.ofSeconds(5));
      return RedisClient.create(uri);
    }

    @Bean(destroyMethod = "close")
    SharedActionConnections easyvSharedActionConnections(
        EasyVActionProperties properties,
        @Qualifier("easyvActionRedisClient") RedisClient client) {
      return new SharedActionConnections(properties, client);
    }
  }

  static final class SharedActionConnections implements AutoCloseable {
    private final JdbcTemplate jdbc;
    private final RedisClient redisClient;
    private StatefulRedisConnection<String, String> redisConnection;

    SharedActionConnections(EasyVActionProperties properties, RedisClient redisClient) {
      // 该连接不注册为平台 DataSource/JdbcTemplate，避免触发主库自动配置退让或误注入。
      var source = new DriverManagerDataSource(
          properties.jdbcUrl(), properties.username(), properties.password());
      Properties options = new Properties();
      options.setProperty("connectTimeout", "5");
      options.setProperty("socketTimeout", "20");
      options.setProperty("ApplicationName", "ontology-agent-easyv-actions");
      source.setConnectionProperties(options);
      var template = new JdbcTemplate(source);
      template.setQueryTimeout(15);
      this.jdbc = template;
      this.redisClient = redisClient;
    }

    JdbcTemplate jdbc() {
      return jdbc;
    }

    synchronized RedisCommands<String, String> redisCommands() {
      if (redisConnection != null && redisConnection.isOpen()) {
        return redisConnection.sync();
      }
      if (redisConnection != null) {
        try {
          redisConnection.close();
        } catch (RuntimeException ignored) {
          // Discard broken connection before reconnecting.
        }
        redisConnection = null;
      }
      redisConnection = redisClient.connect();
      return redisConnection.sync();
    }

    @SuppressWarnings("unchecked")
    RedisCommands<String, String> redisCommandsProxy() {
      return (RedisCommands<String, String>) Proxy.newProxyInstance(
          RedisCommands.class.getClassLoader(),
          new Class<?>[] {RedisCommands.class},
          (proxy, method, args) -> {
            if (method.getDeclaringClass() == Object.class) {
              return switch (method.getName()) {
                case "toString" -> "EasyVActionRedisCommandsProxy";
                case "hashCode" -> System.identityHashCode(proxy);
                case "equals" -> proxy == args[0];
                default -> method.invoke(this, args);
              };
            }
            try {
              return method.invoke(redisCommands(), args);
            } catch (InvocationTargetException error) {
              throw error.getTargetException();
            }
          });
    }

    @Override
    public synchronized void close() {
      if (redisConnection != null) {
        try {
          redisConnection.close();
        } finally {
          redisConnection = null;
        }
      }
    }
  }
}
