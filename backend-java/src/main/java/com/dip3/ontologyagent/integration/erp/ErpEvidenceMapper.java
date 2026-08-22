package com.dip3.ontologyagent.integration.erp;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.dip3.ontologyagent.support.PostgresTextArrayTypeHandler;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Result;
import org.apache.ibatis.annotations.Results;
import org.apache.ibatis.annotations.Select;

import java.time.LocalDate;
import java.util.List;

@Mapper
public interface ErpEvidenceMapper extends BaseMapper<ErpChargeEntity> {
    @Select("""
            with receivables as (
              select c.precinct_id as project_id,max(c.precinct_name) as project_name,
                     coalesce(sum(c.actual_charge_sum),0) as receivable_amount,
                     coalesce(sum(c.arrears),0) as arrears_amount
              from erp_staging.dw_datacenter_charge c
              join erp_staging.dw_datacenter_chargeitem ci on ci.charge_item_id=c.charge_item_id
                                                        and ci.charge_item_type='1'
              where c.precinct_id=any(
                      #{projectIds,typeHandler=com.dip3.ontologyagent.support.PostgresTextArrayTypeHandler})
                and c.is_delete=0 and c.is_check='审核通过'
                and c.should_account_book >=
                    extract(year from #{from}::date)::int * 100 + extract(month from #{from}::date)::int
                and c.should_account_book <=
                    extract(year from #{to}::date)::int * 100 + extract(month from #{to}::date)::int
              group by c.precinct_id
            ), payment_facts as (
              select coalesce(b.precinct_id,c.precinct_id) as project_id,coalesce(b.charge_paid,0) as paid_amount,
                     coalesce((b.operator_date at time zone 'Asia/Taipei')::date,to_date(
                       lpad(cast(b.paid_year as text),4,'0') || lpad(cast(b.paid_month as text),2,'0') ||
                       lpad(cast(b.paid_day as text),2,'0'),'YYYYMMDD')) as payment_business_date
              from erp_staging.dw_datacenter_bill b
              join erp_staging.dw_datacenter_charge c on c.charge_detail_id=b.charge_detail_id
              join erp_staging.dw_datacenter_chargeitem ci on ci.charge_item_id=c.charge_item_id
                                                        and ci.charge_item_type='1'
              where coalesce(b.precinct_id,c.precinct_id)=any(
                      #{projectIds,typeHandler=com.dip3.ontologyagent.support.PostgresTextArrayTypeHandler})
                and b.is_delete=0 and b.is_enter_account='1'
                and (b.refund_status is null or b.refund_status!='待退款')
                and coalesce(b.precinct_collection_type,0)!=1
                and b.subject_code in ('已缴款','红冲','退款','押金类转','押金类转红冲','临时缴款',
                                       '预收款结转','预收款结转红冲','退款转预收')
                and c.is_delete=0 and c.is_check='审核通过'
                and c.should_account_book >=
                    extract(year from #{from}::date)::int * 100 + extract(month from #{from}::date)::int
                and c.should_account_book <=
                    extract(year from #{to}::date)::int * 100 + extract(month from #{to}::date)::int
            ), payments as (
              select project_id,coalesce(sum(paid_amount),0) as paid_amount
              from payment_facts
              where payment_business_date between #{from}::date and #{to}::date
              group by project_id
            )
            select r.project_id,r.project_name,r.receivable_amount,coalesce(p.paid_amount,0) as paid_amount,
                   r.arrears_amount
            from receivables r left join payments p on p.project_id=r.project_id
            order by r.project_id
            """)
    @Results(id = "erpEvidence", value = {
            @Result(property = "projectId", column = "project_id"),
            @Result(property = "projectName", column = "project_name"),
            @Result(property = "receivableAmount", column = "receivable_amount"),
            @Result(property = "paidAmount", column = "paid_amount"),
            @Result(property = "arrearsAmount", column = "arrears_amount")
    })
    List<ErpEvidenceRow> byProjects(@Param("projectIds") String[] projectIds,
                                    @Param("from") LocalDate from,
                                    @Param("to") LocalDate to);

    @Select("""
            select p.precinct_id
            from erp_staging.dw_datacenter_precinct p
            where p.area_id=any(
                    #{areaIds,typeHandler=com.dip3.ontologyagent.support.PostgresTextArrayTypeHandler})
              and coalesce(p.is_delete,0) != 1 and coalesce(p.delete_flag,0) != 1
              and (
                p.org_id=#{organizationId} or p.organization_id::text=#{organizationId}
                or exists (
                  select 1 from erp_staging.dw_datacenter_system_organization o
                  where (o.source_id::text=p.org_id or o.source_id=p.organization_id)
                    and (o.source_id::text=#{organizationId}
                         or strpos(coalesce(o.organization_path,''),'/' || #{organizationId} || '/') > 0)
                )
              )
            order by p.precinct_id
            """)
    List<String> projectIdsByAreas(@Param("organizationId") String organizationId,
                                   @Param("areaIds") String[] areaIds);

    @Select("""
            select p.precinct_id as id,p.precinct_name as name
            from erp_staging.dw_datacenter_precinct p
            where p.precinct_id=any(
                    #{projectIds,typeHandler=com.dip3.ontologyagent.support.PostgresTextArrayTypeHandler})
              and coalesce(p.is_delete,0)!=1 and coalesce(p.delete_flag,0)!=1
            order by p.precinct_id
            """)
    @Results({
            @Result(property = "id", column = "id"),
            @Result(property = "name", column = "name")
    })
    List<ScopedProjectTarget> projectTargets(@Param("projectIds") String[] projectIds);
}
