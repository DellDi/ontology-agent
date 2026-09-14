package com.dip3.ontologyagent.auth;

import org.springframework.stereotype.Service;

import java.util.List;

/**
 * ERP 目录权限范围解析：组织节点路径 → propertyProject 组织 → 项目（precinct）。
 *
 * <p>角色不做账号名特判（不存在内置平台管理员）。当前阶段产品聚焦 EasyV 域且
 * 不限制可见范围，目录账号统一授予 EASYV_ANALYST 与 PROPERTY_ANALYST。
 */
@Service
public final class ErpDirectoryService {
    public static final String PROPERTY_ANALYST = "PROPERTY_ANALYST";
    public static final String EASYV_ANALYST = "EASYV_ANALYST";

    private final ErpDirectoryMapper mapper;

    public ErpDirectoryService(ErpDirectoryMapper mapper) {
        this.mapper = mapper;
    }

    public List<ErpDirectoryUser> findUserByAccount(String account) {
        return mapper.findUserByAccount(account);
    }

    /**
     * 解析组织可访问的项目范围：先定位当前组织及其后代的 propertyProject 组织，
     * 再取这些组织下未删除的 precinct（project）集合。
     */
    public AccessScope resolveUserScope(String userId, long organizationId, String userAccount) {
        String orgId = String.valueOf(organizationId);
        List<String> propertyProjectOrgIds = mapper.findPropertyProjectOrgIds(orgId,
                        "%/" + orgId + "/%", "%/" + orgId)
                .stream().map(String::valueOf).toList();

        List<String> projectIds = propertyProjectOrgIds.isEmpty()
                ? List.of()
                : mapper.findProjectIdsByOrgIds(propertyProjectOrgIds);

        return new AccessScope(orgId, projectIds, List.of(), List.of(PROPERTY_ANALYST, EASYV_ANALYST));
    }
}
