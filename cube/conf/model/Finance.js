cube(`Finance`, {
  sql_table: `erp_staging.dw_datacenter_charge`,

  measures: {
    receivableAmount: {
      sql: `charge_sum`,
      type: `sum`,
      title: `应收金额`,
    },

    paidAmount: {
      sql: `actual_charge_sum`,
      type: `sum`,
      title: `实收金额`,
    },

    collectionRate: {
      sql: `CASE
        WHEN ${receivableAmount} IS NULL OR ${receivableAmount} = 0 THEN NULL
        ELSE ${paidAmount}::numeric / NULLIF(${receivableAmount}, 0)
      END`,
      type: `number`,
      format: `percent`,
      title: `收缴率`,
    },
  },

  dimensions: {
    recordId: {
      sql: `record_id`,
      type: `string`,
      primary_key: true,
      shown: false,
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

    createdAt: {
      sql: `COALESCE(update_date, create_date, should_charge_date)`,
      type: `time`,
      title: `账务时间`,
    },
  },
});
