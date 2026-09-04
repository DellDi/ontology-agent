package com.dip3.ontologyagent.easyv.internal.adapter.out.postgres;

import com.dip3.ontologyagent.config.EasyVPostgresProperties;
import com.dip3.ontologyagent.support.BackendException;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.sql.DataSource;
import org.springframework.jdbc.core.JdbcTemplate;

/** First-query guard for source roles that could mutate EasyV business data. */
public final class EasyVReadOnlyRoleGate {
  private static final List<String> TABLES = List.of(
      "ai_screen_app", "ai_screen_prototype", "ai_pipeline_node_record",
      "generation_tasks", "dt_ai_operation_log");
  private final JdbcTemplate jdbc;
  private final EasyVPostgresProperties properties;
  private final AtomicBoolean checked = new AtomicBoolean();

  public EasyVReadOnlyRoleGate(DataSource dataSource, EasyVPostgresProperties properties) {
    this.jdbc = new JdbcTemplate(dataSource);
    this.properties = properties;
  }

  public void ensureChecked() {
    if (checked.get()) return;
    RolePrivileges privileges;
    try {
      privileges = jdbc.queryForObject(roleSql(properties.schema()), (result, rowNum) ->
          new RolePrivileges(
              result.getString("role_name"),
              result.getBoolean("rolsuper"),
              result.getBoolean("rolcreatedb"),
              result.getBoolean("rolcreaterole"),
              result.getBoolean("rolbypassrls"),
              result.getBoolean("can_select"),
              result.getBoolean("can_insert"),
              result.getBoolean("can_update"),
              result.getBoolean("can_delete")));
    } catch (RuntimeException error) {
      throw new BackendException(
          "EASYV_READ_ONLY_ROLE_CHECK_FAILED",
          "EasyV PostgreSQL 只读角色门禁检查失败（" + error.getClass().getSimpleName() + "）。",
          error);
    }
    if (privileges == null) {
      throw new BackendException("EASYV_READ_ONLY_ROLE_CHECK_FAILED", "EasyV PostgreSQL 当前角色不存在。");
    }
    if (!privileges.canSelect()) {
      throw new BackendException("EASYV_READ_ONLY_PERMISSION_DENIED", "EasyV PostgreSQL 当前角色缺少候选表 SELECT 权限。");
    }
    boolean elevated = privileges.superuser() || privileges.createDb()
        || privileges.createRole() || privileges.bypassRls()
        || privileges.canInsert() || privileges.canUpdate() || privileges.canDelete();
    if (properties.requireReadOnlyRole() && elevated) {
      throw new BackendException(
          "EASYV_READ_ONLY_ROLE_REQUIRED",
          "EasyV PostgreSQL 当前角色具有高权限或候选表 DML 权限，拒绝继续读取。");
    }
    checked.set(true);
  }

  private static String roleSql(String schema) {
    String select = selectPrivilegeExpression(schema);
    String insert = privilegeExpression(schema, "INSERT");
    String update = privilegeExpression(schema, "UPDATE");
    String delete = privilegeExpression(schema, "DELETE");
    return "SELECT r.rolname AS role_name, r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolbypassrls, "
        + select + " AS can_select, " + insert + " AS can_insert, " + update + " AS can_update, "
        + delete + " AS can_delete FROM pg_roles r WHERE r.rolname = current_user";
  }

  private static String selectPrivilegeExpression(String schema) {
    return TABLES.stream()
        .map(table -> "has_table_privilege(current_user, '" + schema + "." + table + "', 'SELECT')")
        .reduce("true", (left, right) -> "(" + left + " AND " + right + ")");
  }

  private static String privilegeExpression(String schema, String privilege) {
    return TABLES.stream()
        .map(table -> "has_table_privilege(current_user, '" + schema + "." + table + "', '" + privilege + "')")
        .reduce("false", (left, right) -> "(" + left + " OR " + right + ")");
  }

  private record RolePrivileges(String roleName, boolean superuser, boolean createDb,
                                boolean createRole, boolean bypassRls, boolean canSelect,
                                boolean canInsert, boolean canUpdate, boolean canDelete) {}
}
