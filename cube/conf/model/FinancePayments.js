cube(`FinancePayments`, {
  sql: `
    select
      p.record_id,
      p.product_version_id,
      p.enterprise_id,
      p.organization_id,
      p.project_id,
      p.project_name,
      p.charge_item_id,
      p.charge_item_name,
      p.owner_id,
      p.charge_detail_id,
      p.paid_amount,
      p.payment_date,
      p.receivable_accounting_period,
      p.billing_cycle_end_date
    from facts.property_payment p
    where not p.is_deleted
      and p.is_entered_account
      and (p.refund_status is null or p.refund_status != '待退款')
      and coalesce(p.collection_type, 0) != 1
      and p.subject_code in (
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
      and p.is_charge_deleted = false
      and p.is_charge_checked = true
      and p.charge_item_type = '1'
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

    paymentDate: {
      sql: `payment_date`,
      type: `time`,
      title: `实收日期`,
    },
  },
});
