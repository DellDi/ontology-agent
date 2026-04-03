cube(`ServiceOrders`, {
  sql_table: `erp_staging.dw_datacenter_services`,

  measures: {
    count: {
      type: `count`,
      title: `工单总量`,
    },

    complaintCount: {
      type: `count`,
      title: `投诉量`,
      filters: [
        {
          sql: `${CUBE}.service_style_name = '投诉' OR ${CUBE}.service_type_name = '投诉'`,
        },
      ],
    },

    averageSatisfaction: {
      sql: `satisfaction`,
      type: `avg`,
      title: `平均满意度`,
    },

    averageResponseDurationHours: {
      sql: `CASE
        WHEN ${CUBE}.update_date_time IS NULL OR ${CUBE}.create_date_time IS NULL THEN NULL
        ELSE EXTRACT(EPOCH FROM (${CUBE}.update_date_time - ${CUBE}.create_date_time)) / 3600.0
      END`,
      type: `avg`,
      title: `平均响应时长（小时）`,
    },

    averageCloseDurationHours: {
      sql: `CASE
        WHEN ${CUBE}.accomplish_date IS NULL OR ${CUBE}.create_date_time IS NULL THEN NULL
        ELSE EXTRACT(EPOCH FROM (${CUBE}.accomplish_date - ${CUBE}.create_date_time)) / 3600.0
      END`,
      type: `avg`,
      title: `平均关闭时长（小时）`,
    },
  },

  dimensions: {
    servicesNo: {
      sql: `services_no`,
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

    serviceTypeName: {
      sql: `service_type_name`,
      type: `string`,
      title: `服务类型`,
    },

    serviceStyleName: {
      sql: `service_style_name`,
      type: `string`,
      title: `服务样式`,
    },

    createdAt: {
      sql: `create_date_time`,
      type: `time`,
      title: `创建时间`,
    },
  },
});
