package com.dip3.ontologyagent.easyv.internal.adapter.out.writeback;

import com.dip3.ontologyagent.config.EasyVActionProperties;
import com.dip3.ontologyagent.easyv.internal.application.EasyVBlockActionPort;
import java.time.Duration;
import java.util.Properties;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.*;
import io.lettuce.core.RedisClient;
import io.lettuce.core.RedisURI;
import io.lettuce.core.api.StatefulRedisConnection;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

@Configuration(proxyBeanMethods=false)
@ConditionalOnProperty(prefix="dip3.easyv", name="enabled", havingValue="true")
@EnableConfigurationProperties(EasyVActionProperties.class)
public class EasyVActionConfiguration {
  @Bean EasyVBlockActionPort easyVBlockActionPort(EasyVActionProperties properties,
      @Qualifier("easyvActionRedis") ObjectProvider<StatefulRedisConnection<String,String>> redis) {
    if (!properties.enabled()) return new EasyVBlockActionDatabaseAdapter(null,null,properties.schema());
    // 该连接不注册为平台 DataSource/JdbcTemplate，避免触发主库自动配置退让或误注入。
    var source = new DriverManagerDataSource(properties.jdbcUrl(), properties.username(), properties.password());
    Properties options = new Properties();
    options.setProperty("connectTimeout", "5"); options.setProperty("socketTimeout", "20");
    options.setProperty("ApplicationName", "ontology-agent-easyv-actions");
    source.setConnectionProperties(options);
    var jdbc = new JdbcTemplate(source); jdbc.setQueryTimeout(15);
    return new EasyVBlockActionDatabaseAdapter(jdbc,redis.getObject().sync(),properties.schema());
  }

  @Configuration(proxyBeanMethods=false)
  @ConditionalOnProperty(prefix="dip3.easyv", name={"enabled","action.enabled"}, havingValue="true")
  static class Connections {
    @Bean(name="easyvActionRedisClient", destroyMethod="shutdown")
    RedisClient redisClient(EasyVActionProperties properties) {
      RedisURI uri;
      try { uri = RedisURI.create(properties.redisUrl()); }
      catch (IllegalArgumentException error) { throw new IllegalArgumentException("EasyV 源 Redis URL 不合法"); }
      uri.setTimeout(Duration.ofSeconds(5));
      return RedisClient.create(uri);
    }
    @Bean(name="easyvActionRedis", destroyMethod="close")
    StatefulRedisConnection<String,String> redis(@Qualifier("easyvActionRedisClient") RedisClient client) {
      return client.connect();
    }
  }
}
