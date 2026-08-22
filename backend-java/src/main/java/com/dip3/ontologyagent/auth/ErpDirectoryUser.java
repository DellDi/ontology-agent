package com.dip3.ontologyagent.auth;

/**
 * erp_staging.dw_datacenter_system_user 的目录登录所需字段。
 *
 * <p>使用公共字段风格（与 MyBatis 结果映射兼容，参照 WorkspaceHomeMapper 行类约定）。
 */
public final class ErpDirectoryUser {
    public long sourceId;
    public String userAccount;
    public String userPassword;
    public Long organizationId;
    public String isActived;
    public Integer isDeleted;
    public String sentryName;

    /** 账号是否停用：is_deleted=1 或 is_actived 为 0/false。 */
    public boolean disabled() {
        return (isDeleted != null && isDeleted == 1)
                || "0".equals(isActived)
                || "false".equalsIgnoreCase(isActived);
    }
}
