package com.dip3.ontologyagent.config;

import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 本进程声明的运行环境及其平台库坐标。声明来自 DIP3_ENVIRONMENT，不由数据库地址推断；
 * 声明为 local-dev 却指向非本机库时拒绝启动，避免本地进程作为第二个 Worker 接入共享库。
 */
public record RuntimeEnvironment(String name, String label, Kind kind, Database database, boolean remoteDatabase) {
  public enum Kind { LOCAL, SHARED, PRODUCTION }

  public record Database(String host, int port, String name) {}

  public static final String LOCAL_DEV = "local-dev";
  private static final Pattern NAME = Pattern.compile("^[a-z][a-z0-9-]{1,30}$");
  private static final Pattern JDBC = Pattern.compile("^jdbc:postgresql://(\\[[0-9a-fA-F:]+\\]|[^/:?\\s]+)(?::(\\d+))?/([^/?\\s]+)(?:\\?.*)?$");
  private static final Set<String> THIS_MACHINE = Set.of("localhost", "127.0.0.1", "[::1]", "host.docker.internal", "postgres");
  private static final Map<String, String> LABELS = Map.of(LOCAL_DEV, "本地开发", "easyv-dev", "公司验收 easyv-dev", "production", "生产");

  public static RuntimeEnvironment resolve(String name, String label, String jdbcUrl, boolean allowRemoteDatabase) {
    if (name == null || !NAME.matcher(name).matches()) {
      throw new IllegalStateException("DIP3_ENVIRONMENT 必须是 2-31 位小写字母、数字或连字符且以字母开头（如 local-dev、easyv-dev、production），当前值：[" + name + "]。");
    }
    Kind kind = LOCAL_DEV.equals(name) ? Kind.LOCAL : "production".equals(name) ? Kind.PRODUCTION : Kind.SHARED;
    Database database = jdbcUrl == null || jdbcUrl.isBlank() ? null : parse(jdbcUrl);
    boolean remote = kind == Kind.LOCAL && database != null && !THIS_MACHINE.contains(database.host());
    if (remote && !allowRemoteDatabase) {
      throw new IllegalStateException("环境护栏：当前声明为本地开发环境（DIP3_ENVIRONMENT=" + name + "），但平台库指向非本机地址 "
          + database.host() + ":" + database.port() + "/" + database.name() + "。本地进程不得接入共享或公司数据库"
          + "（Worker 会与该环境争抢任务）。请把 JAVA_DATABASE_URL 指向本地库；若这是部署环境，请声明 DIP3_ENVIRONMENT；"
          + "只有明确需要时才设置 DIP3_ALLOW_REMOTE_DATABASE=true。说明见 docs/environments.md。");
    }
    String shown = label != null && !label.isBlank() ? label.trim() : LABELS.getOrDefault(name, name);
    return new RuntimeEnvironment(name, shown, kind, database, remote);
  }

  private static Database parse(String jdbcUrl) {
    Matcher matcher = JDBC.matcher(jdbcUrl.trim());
    if (!matcher.matches()) {
      throw new IllegalStateException("JAVA_DATABASE_URL 必须形如 jdbc:postgresql://主机[:端口]/库名，无法识别平台库地址。");
    }
    return new Database(matcher.group(1), matcher.group(2) == null ? 5432 : Integer.parseInt(matcher.group(2)), matcher.group(3));
  }
}
