/**
 * Ontology Grounded Context 的数据库表定义
 *
 * 存储 grounding 结果到 platform schema
 */

import { text, integer, jsonb, serial } from 'drizzle-orm/pg-core';

import type { GroundingStatus, GroundedEntity, GroundedMetric, GroundedFactor, GroundedTimeSemantic } from '@/domain/ontology/grounding';
import { platformSchema } from './auth-sessions';

export const ontologyGroundedContexts = platformSchema.table('ontology_grounded_contexts', {
  id: serial('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  ownerUserId: text('owner_user_id').notNull(),
  version: integer('version').notNull(),

  // Grounding 核心字段
  ontologyVersionId: text('ontology_version_id').notNull(),
  groundingStatus: text('grounding_status').$type<GroundingStatus>().notNull(),

  // Grounding 结果（JSONB 存储）
  entities: jsonb('entities').$type<GroundedEntity[]>().notNull().default([]),
  metrics: jsonb('metrics').$type<GroundedMetric[]>().notNull().default([]),
  factors: jsonb('factors').$type<GroundedFactor[]>().notNull().default([]),
  timeSemantics: jsonb('time_semantics').$type<GroundedTimeSemantic[]>().notNull().default([]),

  // 原始上下文
  originalMergedContext: text('original_merged_context').notNull(),

  // Grounding 元数据
  groundedAt: text('grounded_at').notNull(),
  groundingStrategy: text('grounding_strategy').notNull(),
  diagnostics: jsonb('diagnostics'),

  createdAt: text('created_at').notNull(),
});

export type DbOntologyGroundedContext = typeof ontologyGroundedContexts.$inferSelect;
export type DbOntologyGroundedContextInsert = typeof ontologyGroundedContexts.$inferInsert;
