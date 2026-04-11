import { index, jsonb, text, timestamp } from 'drizzle-orm/pg-core';

import { platformSchema } from './auth-sessions';

export const ontologyEvidenceTypeDefinitions = platformSchema.table(
  'ontology_evidence_type_definitions',
  {
    id: text('id').primaryKey(),
    ontologyVersionId: text('ontology_version_id').notNull(),
    businessKey: text('business_key').notNull(),
    displayName: text('display_name').notNull(),
    description: text('description'),
    status: text('status').notNull(),
    // 证据类型：table / graph / erp-fact / model-summary / text / custom
    evidenceCategory: text('evidence_category').notNull(),
    // 渲染配置（与 conclusion renderer 的对接参数）
    rendererConfig: jsonb('renderer_config').notNull().default({}),
    // 数据获取配置（adapter 参数）
    dataSourceConfig: jsonb('data_source_config').notNull().default({}),
    // 默认排序权重（在结论展示中的优先级）
    defaultPriority: text('default_priority').default('normal'),
    // 是否支持交互式探索
    isInteractive: jsonb('is_interactive').notNull().default(false),
    // 证据模板（用于生成标准化证据块）
    templateSchema: jsonb('template_schema'),
    // 验证规则（证据数据的完整性检查）
    validationRules: jsonb('validation_rules').notNull().default([]),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('ontology_evidence_type_defs_version_idx').on(table.ontologyVersionId),
    index('ontology_evidence_type_defs_business_key_idx').on(table.businessKey),
    index('ontology_evidence_type_defs_version_key_idx').on(table.ontologyVersionId, table.businessKey),
    index('ontology_evidence_type_defs_category_idx').on(table.evidenceCategory),
    index('ontology_evidence_type_defs_status_idx').on(table.status),
  ],
);
