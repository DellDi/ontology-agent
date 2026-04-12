CREATE TABLE "platform"."ontology_grounded_contexts" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"version" integer NOT NULL,
	"ontology_version_id" text NOT NULL,
	"grounding_status" text NOT NULL,
	"entities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metrics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"factors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"time_semantics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"original_merged_context" text NOT NULL,
	"grounded_at" text NOT NULL,
	"grounding_strategy" text NOT NULL,
	"diagnostics" jsonb,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."ontology_tool_capability_bindings" (
	"id" text PRIMARY KEY NOT NULL,
	"ontology_version_id" text NOT NULL,
	"bound_step_template_key" text,
	"bound_capability_tag" text,
	"tool_name" text NOT NULL,
	"activation_conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"description" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"priority" integer DEFAULT 50 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"created_by" text NOT NULL
);

COMMENT ON TABLE "platform"."ontology_grounded_contexts" IS '存储会话级别的本体 grounding 结果，用于跨步骤的状态保持和重放。';
COMMENT ON COLUMN "platform"."ontology_grounded_contexts"."id" IS '主键';
COMMENT ON COLUMN "platform"."ontology_grounded_contexts"."session_id" IS '会话 ID';
COMMENT ON COLUMN "platform"."ontology_grounded_contexts"."owner_user_id" IS '用户 ID';
COMMENT ON COLUMN "platform"."ontology_grounded_contexts"."version" IS '版本号';
COMMENT ON COLUMN "platform"."ontology_grounded_contexts"."ontology_version_id" IS '本体版本 ID';
COMMENT ON COLUMN "platform"."ontology_grounded_contexts"."grounding_status" IS 'Grounding 状态';
COMMENT ON COLUMN "platform"."ontology_grounded_contexts"."entities" IS '实体列表';
COMMENT ON COLUMN "platform"."ontology_grounded_contexts"."metrics" IS '指标列表';
COMMENT ON COLUMN "platform"."ontology_grounded_contexts"."factors" IS '影响因素列表';
COMMENT ON COLUMN "platform"."ontology_grounded_contexts"."time_semantics" IS '时间语义';
COMMENT ON COLUMN "platform"."ontology_grounded_contexts"."original_merged_context" IS '原始合并上下文';
COMMENT ON COLUMN "platform"."ontology_grounded_contexts"."grounded_at" IS 'Grounding 时间';
COMMENT ON COLUMN "platform"."ontology_grounded_contexts"."grounding_strategy" IS 'Grounding 策略';
COMMENT ON COLUMN "platform"."ontology_grounded_contexts"."diagnostics" IS '诊断信息';
COMMENT ON COLUMN "platform"."ontology_grounded_contexts"."created_at" IS '创建时间';

COMMENT ON TABLE "platform"."ontology_tool_capability_bindings" IS '定义工具与本体能力的绑定关系，支持按步骤/能力粒度的工具选择。';
COMMENT ON COLUMN "platform"."ontology_tool_capability_bindings"."id" IS '主键';
COMMENT ON COLUMN "platform"."ontology_tool_capability_bindings"."ontology_version_id" IS '本体版本 ID';
COMMENT ON COLUMN "platform"."ontology_tool_capability_bindings"."bound_step_template_key" IS '绑定的步骤模板键';
COMMENT ON COLUMN "platform"."ontology_tool_capability_bindings"."bound_capability_tag" IS '绑定的能力标签';
COMMENT ON COLUMN "platform"."ontology_tool_capability_bindings"."tool_name" IS '工具名称';
COMMENT ON COLUMN "platform"."ontology_tool_capability_bindings"."activation_conditions" IS '激活条件';
COMMENT ON COLUMN "platform"."ontology_tool_capability_bindings"."description" IS '描述';
COMMENT ON COLUMN "platform"."ontology_tool_capability_bindings"."status" IS '状态';
COMMENT ON COLUMN "platform"."ontology_tool_capability_bindings"."priority" IS '优先级';
COMMENT ON COLUMN "platform"."ontology_tool_capability_bindings"."created_at" IS '创建时间';
COMMENT ON COLUMN "platform"."ontology_tool_capability_bindings"."updated_at" IS '更新时间';
COMMENT ON COLUMN "platform"."ontology_tool_capability_bindings"."created_by" IS '创建人';
