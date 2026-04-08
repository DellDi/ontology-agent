cube(`FinancePayments`, {
  sql: `
    select
      b.record_id,
      c.enterprise_id,
      b.organization_id,
      coalesce(b.precinct_id, c.precinct_id) as precinct_id,
      coalesce(b.precinct_name, c.precinct_name) as precinct_name,
      coalesce(b.charge_item_id, c.charge_item_id) as charge_item_id,
      coalesce(b.charge_item_name, c.charge_item_name) as charge_item_name,
      b.owner_id,
      b.charge_detail_id,
      coalesce(b.charge_paid, 0) as paid_amount,
      coalesce(
        b.operator_date,
        to_date(
          lpad(cast(b.paid_year as text), 4, '0') ||
          lpad(cast(b.paid_month as text), 2, '0') ||
          lpad(cast(b.paid_day as text), 2, '0'),
          'YYYYMMDD'
        )::timestamp
      ) as payment_date,
      to_date(cast(c.should_account_book as text), 'YYYYMM') as receivable_accounting_period,
      c.calc_end_date as billing_cycle_end_date
    from erp_staging.dw_datacenter_bill b
    inner join erp_staging.dw_datacenter_charge c
      on b.charge_detail_id = c.charge_detail_id
    inner join erp_staging.dw_datacenter_chargeitem ci
      on c.charge_item_id = ci.charge_item_id
     and ci.charge_item_type = '1'
    where b.is_delete = 0
      and b.is_enter_account = '1'
      and (b.refund_status is null or b.refund_status != '待退款')
      and coalesce(b.precinct_collection_type, 0) != 1
      and b.subject_code in (
        '已缴款',
        '红冲',
        '退款',
        '押金类转',
        '押金类转红冲',
        '临时缴款',
        '预收款结转',
        '预收款结转红冲',
        '退款转预收'
      )
      and c.is_delete = 0
      and c.is_check = '审核通过'
  `,

  measures: {
    paidAmount: {
      sql: `paid_amount`,
      type: `sum`,
      title: `实收金额`,
    },
  },

  dimensions: {
    recordId: {
      sql: `record_id`,
      type: `string`,
      primary_key: true,
      shown: false,
    },

    chargeDetailId: {
      sql: `charge_detail_id`,
      type: `string`,
      shown: false,
    },

    enterpriseId: {
      sql: `enterprise_id`,
      type: `string`,
      title: `企业 ID`,
    },

    organizationId: {
      sql: `organization_id`,
      type: `string`,
      title: `组织 ID`,
    },

    projectId: {
      sql: `precinct_id`,
      type: `string`,
      title: `项目 ID`,
    },

    projectName: {
      sql: `precinct_name`,
      type: `string`,
      title: `项目名称`,
    },

    chargeItemId: {
      sql: `charge_item_id`,
      type: `string`,
      title: `收费项目 ID`,
    },

    chargeItemName: {
      sql: `charge_item_name`,
      type: `string`,
      title: `收费项目名称`,
    },

    ownerId: {
      sql: `owner_id`,
      type: `string`,
      title: `业主 ID`,
    },

    receivableAccountingPeriod: {
      sql: `receivable_accounting_period`,
      type: `time`,
      title: `应收账期`,
    },

    billingCycleEndDate: {
      sql: `billing_cycle_end_date`,
      type: `time`,
      title: `计费结束日期`,
    },

    paymentDate: {
      sql: `payment_date`,
      type: `time`,
      title: `实收日期`,
    },
  },
});
