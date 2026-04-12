/**
 * Tool Capability Binding 的数据库表定义
 */

import { text, integer, jsonb } from 'drizzle-orm/pg-core';

import type { DefinitionLifecycleState } from '@/domain/ontology/models';
import type { BindingActivationCondition } from '@/domain/ontology/tool-binding';
import { platformSchema } from './auth-sessions';

export const ontologyToolCapabilityBindings = platformSchema.table('ontology_tool_capability_bindings', {
  id: text('id').primaryKey(),
  ontologyVersionId: text('ontology_version_id').notNull(),

  // 绑定目标
  boundStepTemplateKey: text('bound_step_template_key'),
  boundCapabilityTag: text('bound_capability_tag'),

  // 绑定的工具
  toolName: text('tool_name').notNull(),

  // 激活条件
  activationConditions: jsonb('activation_conditions').$type<BindingActivationCondition[]>().notNull().default([]),

  // 元数据
  description: text('description'),
  status: text('status').$type<DefinitionLifecycleState>().notNull().default('draft'),
  priority: integer('priority').notNull().default(50),

  // 版本控制
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  createdBy: text('created_by').notNull(),
});

export type DbOntologyToolCapabilityBinding = typeof ontologyToolCapabilityBindings.$inferSelect;
export type DbOntologyToolCapabilityBindingInsert = typeof ontologyToolCapabilityBindings.$inferInsert;
