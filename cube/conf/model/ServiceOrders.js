cube(`ServiceOrders`, {
  sql: `
    select
      s.service_order_id,
      s.product_version_id,
      s.organization_id,
      s.project_id,
      s.project_name,
      s.service_type_name,
      s.service_style_name,
      s.created_at,
      s.accepted_at,
      s.completed_at,
      s.satisfaction
    from facts.property_service_order s
    where not s.is_deleted
  `,

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
      sql: `NULLIF(satisfaction, 0)`,
      type: `avg`,
      title: `平均满意度`,
    },

    averageResponseDurationHours: {
      sql: `CASE
        WHEN ${CUBE}.accepted_at IS NULL OR ${CUBE}.created_at IS NULL THEN NULL
        ELSE EXTRACT(EPOCH FROM (${CUBE}.accepted_at - ${CUBE}.created_at)) / 3600.0
      END`,
      type: `avg`,
      title: `平均响应时长（小时）`,
    },

    averageCloseDurationHours: {
      sql: `CASE
        WHEN ${CUBE}.completed_at IS NULL OR ${CUBE}.created_at IS NULL THEN NULL
        ELSE EXTRACT(EPOCH FROM (${CUBE}.completed_at - ${CUBE}.created_at)) / 3600.0
      END`,
      type: `avg`,
      title: `平均关闭时长（小时）`,
    },
  },

  dimensions: {
    servicesNo: {
      sql: `service_order_id`,
      type: `string`,
      primary_key: true,
      shown: false,
    },

    productVersionId: {
      sql: `product_version_id`,
      type: `string`,
      shown: false,
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
      sql: `created_at`,
      type: `time`,
      title: `创建时间`,
    },

    completedAt: {
      sql: `completed_at`,
      type: `time`,
      title: `完成时间`,
    },
  },
});
