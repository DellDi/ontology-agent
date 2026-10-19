package com.dip3.ontologyagent.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** 显式启用的 EasyV 写回连接，与采集只读连接及平台连接隔离。 */
@ConfigurationProperties("dip3.easyv.action")
public record EasyVActionProperties(boolean enabled, String jdbcUrl, String username, String password,
    String schema, String redisUrl) {
  public EasyVActionProperties {
    jdbcUrl = jdbcUrl == null ? "" : jdbcUrl.trim();
    username = username == null ? "" : username.trim();
    password = password == null ? "" : password;
    schema = schema == null || schema.isBlank() ? "easyv_saas" : schema.trim();
    redisUrl = redisUrl == null ? "" : redisUrl.trim();
    if (!schema.matches("[A-Za-z_][A-Za-z0-9_]*")) throw new IllegalArgumentException("EasyV 写回 schema 不合法");
    if (enabled && (!jdbcUrl.startsWith("jdbc:postgresql://") || username.isBlank() || redisUrl.isBlank()))
      throw new IllegalArgumentException("启用 EasyV 写回必须配置目标 PostgreSQL 和源 Redis 连接");
  }
  @Override public String toString() { return "EasyVActionProperties[enabled="+enabled+", schema="+schema+"]"; }
}
