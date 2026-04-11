import { index, jsonb, text, timestamp, boolean } from 'drizzle-orm/pg-core';

import { platformSchema } from './auth-sessions';

export const ontologyCausalityEdges = platformSchema.table(
  'ontology_causality_edges',
  {
    id: text('id').primaryKey(),
    ontologyVersionId: text('ontology_version_id').notNull(),
    businessKey: text('business_key').notNull(),
    displayName: text('display_name').notNull(),
    description: text('description'),
    status: text('status').notNull(),
    // 源节点和目标节点的 entity definition keys
    sourceEntityKey: text('source_entity_key').notNull(),
    targetEntityKey: text('target_entity_key').notNull(),
    // 因果关系类型：direct-cause / contributing-factor / correlation / inverse
    causalityType: text('causality_type').notNull(),
    // 是否允许在归因路径中使用（与 Neo4j 存在的关系区分）
    isAttributionPathEnabled: boolean('is_attribution_path_enabled').notNull().default(false),
    // 权重因子（用于归因计算）
    defaultWeight: jsonb('default_weight').notNull().default({ type: 'fixed', value: 1.0 }),
    // 与 Neo4j 图谱关系的映射（允许一个治理边对应多个图谱边类型）
    neo4jRelationshipTypes: text('neo4j_relationship_types').array().notNull().default([]),
    // 时间语义约束（归因查询时的时间窗口规则）
    temporalConstraints: jsonb('temporal_constraints'),
    // 业务规则过滤条件
    filterConditions: jsonb('filter_conditions'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('ontology_causality_edges_version_idx').on(table.ontologyVersionId),
    index('ontology_causality_edges_business_key_idx').on(table.businessKey),
    index('ontology_causality_edges_version_key_idx').on(table.ontologyVersionId, table.businessKey),
    index('ontology_causality_edges_status_idx').on(table.status),
    index('ontology_causality_edges_source_idx').on(table.sourceEntityKey),
    index('ontology_causality_edges_target_idx').on(table.targetEntityKey),
    index('ontology_causality_edges_attribution_idx').on(table.isAttributionPathEnabled),
  ],
);
