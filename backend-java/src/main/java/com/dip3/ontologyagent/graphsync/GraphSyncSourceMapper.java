package com.dip3.ontologyagent.graphsync;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;
import java.util.Map;

@Mapper
public interface GraphSyncSourceMapper {
    @Select("""
            with recursive scoped_orgs as (
              select source_id,organization_parent_id,organization_name,organization_path
              from erp_staging.dw_datacenter_system_organization
              where source_id::text=#{organizationId} and coalesce(is_deleted,0)<>1
              union all
              select child.source_id,child.organization_parent_id,child.organization_name,child.organization_path
              from erp_staging.dw_datacenter_system_organization child
              join scoped_orgs parent on child.organization_parent_id=parent.source_id
              where coalesce(child.is_deleted,0)<>1
            )
            select source_id::text id,organization_name label,
                   organization_parent_id::text parent_id from scoped_orgs order by source_id
            """)
    List<Map<String, Object>> organizations(String organizationId);

    @Select("""
            with recursive scoped_orgs as (
              select source_id from erp_staging.dw_datacenter_system_organization
              where source_id::text=#{organizationId} and coalesce(is_deleted,0)<>1
              union all
              select child.source_id from erp_staging.dw_datacenter_system_organization child
              join scoped_orgs parent on child.organization_parent_id=parent.source_id
              where coalesce(child.is_deleted,0)<>1
            )
            select precinct_id id,precinct_name label,org_id organization_id
            from erp_staging.dw_datacenter_precinct
            where org_id in (select source_id::text from scoped_orgs)
              and coalesce(is_delete,0)<>1 and coalesce(delete_flag,0)<>1
            order by precinct_id
            """)
    List<Map<String, Object>> projects(String organizationId);

    @Select("""
            select distinct owner_id id,owner_name label,precinct_id project_id
            from erp_staging.dw_datacenter_owner
            where org_id in (
              with recursive scoped_orgs as (
                select source_id from erp_staging.dw_datacenter_system_organization
                where source_id::text=#{organizationId} and coalesce(is_deleted,0)<>1
                union all select child.source_id from erp_staging.dw_datacenter_system_organization child
                join scoped_orgs parent on child.organization_parent_id=parent.source_id
                where coalesce(child.is_deleted,0)<>1)
              select source_id::text from scoped_orgs)
              and coalesce(is_delete,0)<>1 and lower(coalesce(is_current,'')) in ('1','true','yes','y')
            order by owner_id
            """)
    List<Map<String, Object>> owners(String organizationId);

    @Select("""
            select charge_item_id id,charge_item_name label
            from erp_staging.dw_datacenter_chargeitem
            where organization_id in (
              with recursive scoped_orgs as (
                select source_id from erp_staging.dw_datacenter_system_organization
                where source_id::text=#{organizationId} and coalesce(is_deleted,0)<>1
                union all select child.source_id from erp_staging.dw_datacenter_system_organization child
                join scoped_orgs parent on child.organization_parent_id=parent.source_id
                where coalesce(child.is_deleted,0)<>1)
              select source_id::text from scoped_orgs)
              and coalesce(delete_flag,0)<>1 order by charge_item_id
            """)
    List<Map<String, Object>> chargeItems(String organizationId);

    @Select("""
            select record_id::text id,coalesce(precinct_id,'') project_id,
                   coalesce(charge_item_id,'') charge_item_id,coalesce(charge_item_name,'') charge_item_label
            from erp_staging.dw_datacenter_charge
            where organization_id in (
              with recursive scoped_orgs as (
                select source_id from erp_staging.dw_datacenter_system_organization
                where source_id::text=#{organizationId} and coalesce(is_deleted,0)<>1
                union all select child.source_id from erp_staging.dw_datacenter_system_organization child
                join scoped_orgs parent on child.organization_parent_id=parent.source_id
                where coalesce(child.is_deleted,0)<>1)
              select source_id::text from scoped_orgs)
              and coalesce(is_delete,0)<>1 order by record_id
            """)
    List<Map<String, Object>> receivables(String organizationId);

    @Select("""
            select record_id::text id,coalesce(precinct_id,'') project_id,
                   coalesce(charge_item_id,'') charge_item_id,coalesce(charge_item_name,'') charge_item_label
            from erp_staging.dw_datacenter_bill
            where organization_id in (
              with recursive scoped_orgs as (
                select source_id from erp_staging.dw_datacenter_system_organization
                where source_id::text=#{organizationId} and coalesce(is_deleted,0)<>1
                union all select child.source_id from erp_staging.dw_datacenter_system_organization child
                join scoped_orgs parent on child.organization_parent_id=parent.source_id
                where coalesce(child.is_deleted,0)<>1)
              select source_id::text from scoped_orgs)
              and coalesce(is_delete,0)<>1 order by record_id
            """)
    List<Map<String, Object>> payments(String organizationId);

    @Select("""
            select services_no id,coalesce(precinct_id,'') project_id,
                   case when coalesce(service_style_name,'') like '%投诉%' then true else false end complaint,
                   case when satisfaction_eval is not null then true else false end satisfaction
            from erp_staging.dw_datacenter_services
            where organization_id in (
              with recursive scoped_orgs as (
                select source_id from erp_staging.dw_datacenter_system_organization
                where source_id::text=#{organizationId} and coalesce(is_deleted,0)<>1
                union all select child.source_id from erp_staging.dw_datacenter_system_organization child
                join scoped_orgs parent on child.organization_parent_id=parent.source_id
                where coalesce(child.is_deleted,0)<>1)
              select source_id::text from scoped_orgs)
              and coalesce(is_delete,0)<>1 order by services_no
            """)
    List<Map<String, Object>> serviceOrders(String organizationId);

    @Select("""
            <script>
            select source_id::text source_pk,source_id::text organization_id,
                   coalesce(update_time,create_time) cursor_time
            from erp_staging.dw_datacenter_system_organization
            where coalesce(update_time,create_time) is null or cast(#{cursorTime} as timestamptz) is null
              or coalesce(update_time,create_time)>#{cursorTime}
              or (coalesce(update_time,create_time)=#{cursorTime} and source_id::text>coalesce(#{cursorPk},''))
            order by cursor_time nulls first,source_pk limit #{limit}
            </script>
            """)
    List<GraphSyncChange> scanOrganizations(@Param("cursorTime") java.time.Instant cursorTime,
                                            @Param("cursorPk") String cursorPk, @Param("limit") int limit);

    @Select("""
            <script>
            select precinct_id::text source_pk,coalesce(nullif(org_id,''),organization_id::text) organization_id,
                   coalesce(update_date,sync_date,create_date) cursor_time
            from erp_staging.dw_datacenter_precinct
            where coalesce(update_date,sync_date,create_date) is null or cast(#{cursorTime} as timestamptz) is null
              or coalesce(update_date,sync_date,create_date)>#{cursorTime}
              or (coalesce(update_date,sync_date,create_date)=#{cursorTime}
                  and precinct_id::text>coalesce(#{cursorPk},''))
            order by cursor_time nulls first,source_pk limit #{limit}
            </script>
            """)
    List<GraphSyncChange> scanProjects(@Param("cursorTime") java.time.Instant cursorTime,
                                       @Param("cursorPk") String cursorPk, @Param("limit") int limit);

    @Select("""
            <script>
            select record_id::text source_pk,nullif(org_id,'') organization_id,
                   coalesce(update_date,sync_date,create_date) cursor_time
            from erp_staging.dw_datacenter_owner
            where coalesce(update_date,sync_date,create_date) is null or cast(#{cursorTime} as timestamptz) is null
              or coalesce(update_date,sync_date,create_date)>#{cursorTime}
              or (coalesce(update_date,sync_date,create_date)=#{cursorTime}
                  and record_id::text>coalesce(#{cursorPk},''))
            order by cursor_time nulls first,source_pk limit #{limit}
            </script>
            """)
    List<GraphSyncChange> scanOwners(@Param("cursorTime") java.time.Instant cursorTime,
                                     @Param("cursorPk") String cursorPk, @Param("limit") int limit);

    @Select("""
            <script>
            select charge_item_id::text source_pk,nullif(organization_id,'') organization_id,
                   coalesce(update_date,sync_date,create_date) cursor_time
            from erp_staging.dw_datacenter_chargeitem
            where coalesce(update_date,sync_date,create_date) is null or cast(#{cursorTime} as timestamptz) is null
              or coalesce(update_date,sync_date,create_date)>#{cursorTime}
              or (coalesce(update_date,sync_date,create_date)=#{cursorTime}
                  and charge_item_id::text>coalesce(#{cursorPk},''))
            order by cursor_time nulls first,source_pk limit #{limit}
            </script>
            """)
    List<GraphSyncChange> scanChargeItems(@Param("cursorTime") java.time.Instant cursorTime,
                                          @Param("cursorPk") String cursorPk, @Param("limit") int limit);

    @Select("""
            <script>
            select record_id::text source_pk,nullif(organization_id,'') organization_id,
                   coalesce(update_date,sync_date,should_charge_date,create_date) cursor_time
            from erp_staging.dw_datacenter_charge
            where coalesce(update_date,sync_date,should_charge_date,create_date) is null or cast(#{cursorTime} as timestamptz) is null
              or coalesce(update_date,sync_date,should_charge_date,create_date)>#{cursorTime}
              or (coalesce(update_date,sync_date,should_charge_date,create_date)=#{cursorTime}
                  and record_id::text>coalesce(#{cursorPk},''))
            order by cursor_time nulls first,source_pk limit #{limit}
            </script>
            """)
    List<GraphSyncChange> scanReceivables(@Param("cursorTime") java.time.Instant cursorTime,
                                          @Param("cursorPk") String cursorPk, @Param("limit") int limit);

    @Select("""
            <script>
            select record_id::text source_pk,nullif(organization_id,'') organization_id,
                   coalesce(operator_date,update_date,sync_date) cursor_time
            from erp_staging.dw_datacenter_bill
            where coalesce(operator_date,update_date,sync_date) is null or cast(#{cursorTime} as timestamptz) is null
              or coalesce(operator_date,update_date,sync_date)>#{cursorTime}
              or (coalesce(operator_date,update_date,sync_date)=#{cursorTime}
                  and record_id::text>coalesce(#{cursorPk},''))
            order by cursor_time nulls first,source_pk limit #{limit}
            </script>
            """)
    List<GraphSyncChange> scanPayments(@Param("cursorTime") java.time.Instant cursorTime,
                                       @Param("cursorPk") String cursorPk, @Param("limit") int limit);

    @Select("""
            <script>
            select services_no::text source_pk,nullif(organization_id,'') organization_id,
                   coalesce(update_date_time,sync_date,create_date_time) cursor_time
            from erp_staging.dw_datacenter_services
            where coalesce(update_date_time,sync_date,create_date_time) is null or cast(#{cursorTime} as timestamptz) is null
              or coalesce(update_date_time,sync_date,create_date_time)>#{cursorTime}
              or (coalesce(update_date_time,sync_date,create_date_time)=#{cursorTime}
                  and services_no::text>coalesce(#{cursorPk},''))
            order by cursor_time nulls first,source_pk limit #{limit}
            </script>
            """)
    List<GraphSyncChange> scanServiceOrders(@Param("cursorTime") java.time.Instant cursorTime,
                                            @Param("cursorPk") String cursorPk, @Param("limit") int limit);
}
