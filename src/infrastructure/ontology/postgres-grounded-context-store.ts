/**
 * Ontology Grounded Context 的 Postgres 存储实现
 *
 * 存储 grounding 结果到 platform schema
 */

import { eq, and, desc } from 'drizzle-orm';

import type { OntologyGroundedContext } from '@/domain/ontology/grounding';
import type { OntologyGroundedContextStore } from '@/application/ontology/grounding';
import { createPostgresDb, type PostgresDb } from '@/infrastructure/postgres/client';
import {
  ontologyGroundedContexts,
  type DbOntologyGroundedContext,
} from '@/infrastructure/postgres/schema';

function toDomain(dbRecord: DbOntologyGroundedContext): OntologyGroundedContext & { sessionId: string; ownerUserId: string } {
  return {
    sessionId: dbRecord.sessionId,
    ownerUserId: dbRecord.ownerUserId,
    ontologyVersionId: dbRecord.ontologyVersionId,
    groundingStatus: dbRecord.groundingStatus,
    entities: dbRecord.entities,
    metrics: dbRecord.metrics,
    factors: dbRecord.factors,
    timeSemantics: dbRecord.timeSemantics,
    originalMergedContext: dbRecord.originalMergedContext,
    groundedAt: dbRecord.groundedAt,
    groundingStrategy: dbRecord.groundingStrategy as OntologyGroundedContext['groundingStrategy'],
    diagnostics: (dbRecord.diagnostics as OntologyGroundedContext['diagnostics']) ?? undefined,
  };
}

function toDbRecord(
  domain: OntologyGroundedContext & { sessionId: string; ownerUserId: string },
  version: number,
): Omit<DbOntologyGroundedContext, 'id' | 'createdAt'> {
  return {
    sessionId: domain.sessionId,
    ownerUserId: domain.ownerUserId,
    version,
    ontologyVersionId: domain.ontologyVersionId,
    groundingStatus: domain.groundingStatus,
    entities: domain.entities,
    metrics: domain.metrics,
    factors: domain.factors,
    timeSemantics: domain.timeSemantics,
    originalMergedContext: domain.originalMergedContext,
    groundedAt: domain.groundedAt,
    groundingStrategy: domain.groundingStrategy,
    diagnostics: domain.diagnostics ?? null,
  };
}

export function createPostgresGroundedContextStore(externalDb?: PostgresDb): OntologyGroundedContextStore {
  const getDb = (): PostgresDb => externalDb ?? createPostgresDb().db;

  return {
    async save(context) {
      const db = getDb();

      // 获取当前最大版本号
      const existing = await db
        .select()
        .from(ontologyGroundedContexts)
        .where(eq(ontologyGroundedContexts.sessionId, context.sessionId))
        .orderBy(desc(ontologyGroundedContexts.version))
        .limit(1);

      const nextVersion = existing.length > 0 ? existing[0].version + 1 : 1;

      await db.insert(ontologyGroundedContexts).values({
        ...toDbRecord(context, nextVersion),
        createdAt: new Date().toISOString(),
      });
    },

    async getLatest(sessionId) {
      const db = getDb();

      const result = await db
        .select()
        .from(ontologyGroundedContexts)
        .where(eq(ontologyGroundedContexts.sessionId, sessionId))
        .orderBy(desc(ontologyGroundedContexts.version))
        .limit(1);

      if (result.length === 0) {
        return null;
      }

      return toDomain(result[0]);
    },

    async getByVersion(sessionId, version) {
      const db = getDb();

      const result = await db
        .select()
        .from(ontologyGroundedContexts)
        .where(
          and(
            eq(ontologyGroundedContexts.sessionId, sessionId),
            eq(ontologyGroundedContexts.version, version),
          ),
        )
        .limit(1);

      if (result.length === 0) {
        return null;
      }

      return toDomain(result[0]);
    },
  };
}
