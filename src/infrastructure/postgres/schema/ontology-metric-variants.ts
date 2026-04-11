import { index, jsonb, text, timestamp } from 'drizzle-orm/pg-core';

import { platformSchema } from './auth-sessions';

export const ontologyMetricVariants = platformSchema.table(
  'ontology_metric_variants',
  {
    id: text('id').primaryKey(),
    ontologyVersionId: text('ontology_version_id').notNull(),
    parentMetricDefinitionId: text('parent_metric_definition_id').notNull(),
    businessKey: text('business_key').notNull(),
    displayName: text('display_name').notNull(),
    description: text('description'),
    status: text('status').notNull(),
    // 口径变体的核心语义：如计费口径 vs 尾欠口径的差异逻辑
    semanticDiscriminator: text('semantic_discriminator').notNull(),
    // 与 Cube 语义查询层的映射配置
    cubeViewMapping: jsonb('cube_view_mapping').notNull().default({}),
    // 适用的过滤条件模板
    filterTemplate: jsonb('filter_template'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('ontology_metric_variants_version_idx').on(table.ontologyVersionId),
    index('ontology_metric_variants_parent_metric_idx').on(table.parentMetricDefinitionId),
    index('ontology_metric_variants_business_key_idx').on(table.businessKey),
    index('ontology_metric_variants_version_key_idx').on(table.ontologyVersionId, table.businessKey),
    index('ontology_metric_variants_status_idx').on(table.status),
  ],
);
