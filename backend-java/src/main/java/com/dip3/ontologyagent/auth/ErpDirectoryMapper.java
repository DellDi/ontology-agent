package com.dip3.ontologyagent.auth;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Result;
import org.apache.ibatis.annotations.Results;
import org.apache.ibatis.annotations.Select;

import java.util.List;

/** ERP 目录（erp_staging）账号与权限范围读取。 */
@Mapper
public interface ErpDirectoryMapper {

    @Select("""
            select source_id, user_account, user_password, organization_id, is_actived, is_deleted, sentry_name
            from erp_staging.dw_datacenter_system_user
            where user_account = #{account}
            """)
    @Results(id = "erpDirectoryUser", value = {
            @Result(property = "sourceId", column = "source_id"),
            @Result(property = "userAccount", column = "user_account"),
            @Result(property = "userPassword", column = "user_password"),
            @Result(property = "organizationId", column = "organization_id"),
            @Result(property = "isActived", column = "is_actived"),
            @Result(property = "isDeleted", column = "is_deleted"),
            @Result(property = "sentryName", column = "sentry_name")
    })
    List<ErpDirectoryUser> findUserByAccount(@Param("account") String account);

    /**
     * 当前组织节点自身（若为 propertyProject）及其全部后代 propertyProject 组织。
     * 后代判定：organizationPath 包含 "/{orgId}/" 或以 "/{orgId}" 结尾。
     */
    @Select("""
            select source_id
            from erp_staging.dw_datacenter_system_organization
            where organization_nature = 'propertyProject'
              and (
                cast(source_id as text) = #{organizationId}
                or organization_path like #{pathPrefix1}
                or organization_path like #{pathPrefix2}
              )
            """)
    List<Long> findPropertyProjectOrgIds(@Param("organizationId") String organizationId,
                                         @Param("pathPrefix1") String pathPrefix1,
                                         @Param("pathPrefix2") String pathPrefix2);

    @Select("""
            <script>
            select precinct_id
            from erp_staging.dw_datacenter_precinct
            where coalesce(is_delete, 0) &lt;&gt; 1
              and coalesce(delete_flag, 0) &lt;&gt; 1
              and org_id in
              <foreach collection="orgIds" item="orgId" open="(" separator="," close=")">
                #{orgId}
              </foreach>
            </script>
            """)
    List<String> findProjectIdsByOrgIds(@Param("orgIds") List<String> orgIds);
}
