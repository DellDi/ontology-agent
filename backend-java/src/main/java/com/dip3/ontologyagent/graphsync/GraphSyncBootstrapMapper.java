package com.dip3.ontologyagent.graphsync;

import org.apache.ibatis.annotations.Arg;
import org.apache.ibatis.annotations.ConstructorArgs;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;

import java.time.Instant;
import java.util.List;

@Mapper
public interface GraphSyncBootstrapMapper {
    @Select("""
            with changes(source_name,source_pk,organization_id,cursor_time) as (
              select 'erp.organizations',source_id::text,source_id::text,coalesce(update_time,create_time)
              from erp_staging.dw_datacenter_system_organization
              union all
              select 'erp.projects',precinct_id::text,coalesce(nullif(org_id,''),organization_id::text),
                     coalesce(update_date,sync_date,create_date)
              from erp_staging.dw_datacenter_precinct
              union all
              select 'erp.owners',record_id::text,nullif(org_id,''),coalesce(update_date,sync_date,create_date)
              from erp_staging.dw_datacenter_owner
              union all
              select 'erp.charge_items',charge_item_id::text,nullif(organization_id,''),
                     coalesce(update_date,sync_date,create_date)
              from erp_staging.dw_datacenter_chargeitem
              union all
              select 'erp.receivables',record_id::text,nullif(organization_id,''),
                     coalesce(update_date,sync_date,should_charge_date,create_date)
              from erp_staging.dw_datacenter_charge
              union all
              select 'erp.payments',record_id::text,nullif(organization_id,''),
                     coalesce(operator_date,update_date,sync_date)
              from erp_staging.dw_datacenter_bill
              union all
              select 'erp.service_orders',services_no::text,nullif(organization_id,''),
                     coalesce(update_date_time,sync_date,create_date_time)
              from erp_staging.dw_datacenter_services
            ), sources(source_name) as (values
              ('erp.organizations'),('erp.projects'),('erp.owners'),('erp.charge_items'),
              ('erp.receivables'),('erp.payments'),('erp.service_orders')
            )
            select source.source_name,watermark.cursor_time,watermark.cursor_pk,
                   coalesce(invalid.invalid_rows,0)::int invalid_rows
            from sources source
            left join lateral (
              select change.cursor_time,change.source_pk as cursor_pk
              from changes change
              where change.source_name=source.source_name and change.cursor_time is not null
                and change.organization_id is not null and change.organization_id<>''
                and change.source_pk is not null and change.source_pk<>''
              order by change.cursor_time desc,change.source_pk desc limit 1
            ) watermark on true
            left join lateral (
              select count(*)::int invalid_rows from changes change
              where change.source_name=source.source_name and
                    (change.cursor_time is null or change.organization_id is null or
                     change.organization_id='' or change.source_pk is null or change.source_pk='')
            ) invalid on true
            order by source.source_name
            """)
    @ConstructorArgs({
            @Arg(column = "source_name", javaType = String.class),
            @Arg(column = "cursor_time", javaType = Instant.class),
            @Arg(column = "cursor_pk", javaType = String.class),
            @Arg(column = "invalid_rows", javaType = int.class)
    })
    List<GraphSyncWatermark> watermarks();

    @Select("""
            select source_id::text from erp_staging.dw_datacenter_system_organization
            where coalesce(is_deleted,0)<>1 order by source_id
            """)
    List<String> activeOrganizationIds();

    @Select("""
            select source_id::text from erp_staging.dw_datacenter_system_organization
            where coalesce(is_deleted,0)=1 order by source_id
            """)
    List<String> deletedOrganizationIds();
}
