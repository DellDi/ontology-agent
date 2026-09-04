package com.dip3.ontologyagent.config;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/** Configuration for the optional, read-only EasyV source database connection. */
@ConfigurationProperties("dip3.easyv")
public record EasyVPostgresProperties(
    boolean enabled,
    String jdbcUrl,
    String username,
    String password,
    String schema,
    int maximumPoolSize,
    Duration connectionTimeout,
    Duration validationTimeout,
    Duration statementTimeout,
    Duration lockTimeout,
    Duration idleInTransactionSessionTimeout,
    boolean requireReadOnlyRole) {

  public EasyVPostgresProperties {
    jdbcUrl = blankToEmpty(jdbcUrl);
    username = blankToEmpty(username);
    password = password == null ? "" : password;
    schema = schema == null || schema.isBlank() ? "easyv_saas" : schema.trim();
    if (maximumPoolSize < 1 || maximumPoolSize > 4) {
      throw new IllegalArgumentException("dip3.easyv.maximum-pool-size 必须在 1 到 4 之间。");
    }
    if (connectionTimeout == null || connectionTimeout.isNegative() || connectionTimeout.isZero()
        || validationTimeout == null || validationTimeout.isNegative() || validationTimeout.isZero()
        || statementTimeout == null || statementTimeout.isNegative() || statementTimeout.isZero()
        || lockTimeout == null || lockTimeout.isNegative() || lockTimeout.isZero()
        || idleInTransactionSessionTimeout == null
        || idleInTransactionSessionTimeout.isNegative()
        || idleInTransactionSessionTimeout.isZero()) {
      throw new IllegalArgumentException("dip3.easyv PostgreSQL 超时必须为正数。");
    }
    if (!schema.matches("[A-Za-z_][A-Za-z0-9_]*")) {
      throw new IllegalArgumentException("dip3.easyv.schema 不是合法的 PostgreSQL schema 标识符。");
    }
    if (enabled && (jdbcUrl.isBlank() || username.isBlank())) {
      throw new IllegalArgumentException("启用 EasyV PostgreSQL 读取时必须配置 JDBC URL 和用户名。");
    }
  }

  private static String blankToEmpty(String value) {
    return value == null ? "" : value.trim();
  }

  @Override
  public String toString() {
    return "EasyVPostgresProperties[enabled=" + enabled + ", jdbcUrlConfigured=" + !jdbcUrl.isBlank()
        + ", usernameConfigured=" + !username.isBlank() + ", schema=" + schema
        + ", maximumPoolSize=" + maximumPoolSize + ", requireReadOnlyRole=" + requireReadOnlyRole + "]";
  }
}
