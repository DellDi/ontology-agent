cube(`FinanceReceivables`, {
  sql: `
    select
      c.record_id,
      c.enterprise_id,
      c.organization_id,
      c.precinct_id,
      c.precinct_name,
      c.charge_item_id,
      c.charge_item_name,
      c.owner_id,
      c.charge_detail_id,
      coalesce(c.actual_charge_sum, 0) as receivable_amount,
      to_date(cast(c.should_account_book as text), 'YYYYMM') as receivable_accounting_period,
      c.calc_end_date as billing_cycle_end_date
    from erp_staging.dw_datacenter_charge c
    inner join erp_staging.dw_datacenter_chargeitem ci
      on c.charge_item_id = ci.charge_item_id
     and ci.charge_item_type = '1'
    where c.is_delete = 0
      and c.is_check = '审核通过'
  `,

  measures: {
    receivableAmount: {
      sql: `receivable_amount`,
      type: `sum`,
      title: `应收金额`,
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
  },
});
