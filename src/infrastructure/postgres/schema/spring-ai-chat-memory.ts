import { sql } from 'drizzle-orm';
import { bigint, check, index, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';

// Spring AI JDBC ChatMemory 使用未限定表名；保持 public schema 与框架 SQL 一致。
export const springAiChatMemory = pgTable(
  'spring_ai_chat_memory',
  {
    conversationId: varchar('conversation_id', { length: 36 }).notNull(),
    content: text('content').notNull(),
    type: varchar('type', { length: 10 }).notNull(),
    timestamp: timestamp('timestamp').notNull(),
    sequenceId: bigint('sequence_id', { mode: 'number' }).notNull(),
  },
  (table) => [
    check(
      'spring_ai_chat_memory_type_check',
      sql`type in ('USER', 'ASSISTANT', 'SYSTEM', 'TOOL')`,
    ),
    index('spring_ai_chat_memory_conversation_id_timestamp_idx').on(
      table.conversationId,
      table.timestamp,
    ),
    index('spring_ai_chat_memory_conversation_id_sequence_id_idx').on(
      table.conversationId,
      table.sequenceId,
    ),
  ],
);
