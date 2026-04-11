import { index, jsonb, text, timestamp } from 'drizzle-orm/pg-core';

import { platformSchema } from './auth-sessions';

export const ontologyTimeSemantics = platformSchema.table(
  'ontology_time_semantics',
  {
    id: text('id').primaryKey(),
    ontologyVersionId: text('ontology_version_id').notNull(),
    businessKey: text('business_key').notNull(),
    displayName: text('display_name').notNull(),
    description: text('description'),
    status: text('status').notNull(),
    // 时间语义类型：accounting-period / billing-cycle / payment-date / custom
    semanticType: text('semantic_type').notNull(),
    // 与业务实体关联的日期字段映射（如 receivable.accounting_period）
    entityDateFieldMapping: jsonb('entity_date_field_mapping').notNull().default({}),
    // 与 Cube 时间维度的映射配置
    cubeTimeDimensionMapping: jsonb('cube_time_dimension_mapping'),
    // 时间语义计算公式或规则（如 billing_cycle_end = accounting_period_end + grace_days）
    calculationRule: jsonb('calculation_rule'),
    // 默认时间粒度：day / week / month / quarter / year
    defaultGranularity: text('default_granularity').default('month'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('ontology_time_semantics_version_idx').on(table.ontologyVersionId),
    index('ontology_time_semantics_business_key_idx').on(table.businessKey),
    index('ontology_time_semantics_version_key_idx').on(table.ontologyVersionId, table.businessKey),
    index('ontology_time_semantics_type_idx').on(table.semanticType),
    index('ontology_time_semantics_status_idx').on(table.status),
  ],
);
