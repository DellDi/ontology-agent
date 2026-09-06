cube(`FinanceReceivables`, {
  sql: `
    select
      r.record_id,
      r.product_version_id,
      r.enterprise_id,
      r.organization_id,
      r.project_id,
      r.project_name,
      r.charge_item_id,
      r.charge_item_name,
      r.owner_id,
      r.charge_detail_id,
      r.receivable_amount,
      r.receivable_accounting_period,
      r.billing_cycle_end_date
    from facts.property_receivable r
    where not r.is_deleted
      and r.is_checked
      and r.charge_item_type = '1'
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

    productVersionId: {
      sql: `product_version_id`,
      type: `string`,
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
      sql: `project_id`,
      type: `string`,
      title: `项目 ID`,
    },

    projectName: {
      sql: `project_name`,
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
