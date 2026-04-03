import 'server-only';

import neo4j from 'neo4j-driver';

import type { GraphReadPort, GraphWritePort } from '@/application/graph/ports';
import type {
  GraphCandidateFactor,
  GraphCandidateFactorQuery,
  GraphSyncBatch,
} from '@/domain/graph/models';

import { isNeo4jConfigured, getNeo4jGraphConfig } from './config';
import {
  Neo4jGraphResponseError,
  Neo4jGraphUnavailableError,
} from './errors';
import { buildNeo4jSyncCypher } from '@/infrastructure/sync/neo4j-graph-sync';

type DriverLike = ReturnType<typeof neo4j.driver>;
type QueryRecordLike = {
  get(key: string): unknown;
};

type QueryShape = {
  cypher: string;
  params: Record<string, string>;
};

function createDriver() {
  const config = getNeo4jGraphConfig();

  return neo4j.driver(
    config.uri,
    neo4j.auth.basic(config.username, config.password),
  );
}

function mapFallbackFactors(
  query: GraphCandidateFactorQuery,
): GraphCandidateFactor[] {
  if (!/为什么|原因|影响|导致|归因|异常|波动|下降|上升|变动/.test(query.questionText)) {
    return [];
  }

  switch (query.intentType) {
    case 'fee-analysis':
      return [
        {
          factorKey: 'service-response-latency',
          factorLabel: '服务响应时长',
          relationType: 'causal',
          direction: 'outbound',
          source: 'governed-rule',
          explanation: `${query.entity}在${query.timeRange}的${query.metric}可能与服务响应时长变化存在因果边。`,
        },
      ];
    case 'complaint-analysis':
      return [
        {
          factorKey: 'satisfaction-spillover',
          factorLabel: '满意度外溢',
          relationType: 'causal',
          direction: 'outbound',
          source: 'governed-rule',
          explanation: `${query.entity}在${query.timeRange}的${query.metric}可通过投诉 -> 满意度关系链进一步解释。`,
        },
      ];
    default:
      return [];
  }
}

function mapRecordValue(value: unknown) {
  if (neo4j.isInt(value)) {
    return value.toNumber();
  }

  return value;
}

function mapQueryRecords(records: QueryRecordLike[]) {
  return records
    .map((record) => ({
      factorKey: String(mapRecordValue(record.get('factorKey')) ?? ''),
      factorLabel: String(mapRecordValue(record.get('factorLabel')) ?? ''),
      explanation: String(mapRecordValue(record.get('explanation')) ?? ''),
      relationType: String(
        mapRecordValue(record.get('relationType')) ?? 'causal',
      ),
      direction: String(mapRecordValue(record.get('direction')) ?? 'outbound'),
      source: String(mapRecordValue(record.get('source')) ?? 'governed-rule'),
    }))
    .filter((factor) => factor.factorKey && factor.factorLabel) as GraphCandidateFactor[];
}

function buildCandidateFactorQuery(
  query: GraphCandidateFactorQuery,
): QueryShape {
  switch (query.intentType) {
    case 'fee-analysis':
      return {
        cypher: `
MATCH (project:GraphNode {kind: 'project'})
WHERE project.label CONTAINS $entity
MATCH (project)-[projectEdge:GRAPH_EDGE]->(fact:GraphNode)
WHERE projectEdge.kind IN ['has-receivable', 'has-payment']
MATCH (chargeItem:GraphNode {kind: 'charge-item'})-[chargeEdge:GRAPH_EDGE]->(fact)
WHERE chargeEdge.kind = 'belongs-to'
RETURN DISTINCT
  coalesce(chargeItem.id, chargeItem.label) AS factorKey,
  chargeItem.label AS factorLabel,
  projectEdge.explanation + '；' + chargeEdge.explanation AS explanation,
  chargeEdge.kind AS relationType,
  chargeEdge.direction AS direction,
  chargeEdge.source AS source
LIMIT 5
`,
        params: {
          entity: query.entity,
        },
      };
    case 'complaint-analysis':
    case 'satisfaction-analysis':
    case 'work-order-analysis':
      return {
        cypher: `
MATCH (project:GraphNode {kind: 'project'})
WHERE project.label CONTAINS $entity
MATCH (project)-[projectEdge:GRAPH_EDGE {kind: 'has-service-order'}]->(serviceOrder:GraphNode {kind: 'service-order'})
OPTIONAL MATCH (serviceOrder)-[detailEdge:GRAPH_EDGE]->(detail:GraphNode)
WHERE detailEdge.kind IN ['has-complaint', 'has-satisfaction']
RETURN DISTINCT
  CASE
    WHEN detail.kind = 'complaint' THEN 'complaint-signal'
    WHEN detail.kind = 'satisfaction' THEN 'satisfaction-signal'
    ELSE coalesce(serviceOrder.id, serviceOrder.label)
  END AS factorKey,
  CASE
    WHEN detail.kind = 'complaint' THEN '投诉工单信号'
    WHEN detail.kind = 'satisfaction' THEN '满意度评价信号'
    ELSE '工单履约记录'
  END AS factorLabel,
  CASE
    WHEN detail IS NULL THEN projectEdge.explanation
    ELSE projectEdge.explanation + '；' + detailEdge.explanation
  END AS explanation,
  coalesce(detailEdge.kind, projectEdge.kind) AS relationType,
  coalesce(detailEdge.direction, projectEdge.direction) AS direction,
  coalesce(detailEdge.source, projectEdge.source) AS source
LIMIT 5
`,
        params: {
          entity: query.entity,
        },
      };
    default:
      return {
        cypher: `
MATCH (project:GraphNode {kind: 'project'})
WHERE project.label CONTAINS $entity
MATCH (project)-[edge:GRAPH_EDGE]->(neighbor:GraphNode)
RETURN DISTINCT
  coalesce(neighbor.id, neighbor.label) AS factorKey,
  neighbor.label AS factorLabel,
  edge.explanation AS explanation,
  edge.kind AS relationType,
  edge.direction AS direction,
  edge.source AS source
LIMIT 5
`,
        params: {
          entity: query.entity,
        },
      };
  }
}

export function createNeo4jGraphAdapter(
  driverFactory: () => DriverLike = createDriver,
): GraphReadPort & GraphWritePort {
  return {
    async findCandidateFactors(query) {
      if (!isNeo4jConfigured()) {
        return mapFallbackFactors(query);
      }

      const driver = driverFactory();

      try {
        const config = getNeo4jGraphConfig();
        const queryShape = buildCandidateFactorQuery(query);
        const result = await driver.executeQuery(
          queryShape.cypher,
          queryShape.params,
          { database: config.database },
        );

        const factors = mapQueryRecords(result.records);
        return factors.length > 0 ? factors : [];
      } catch (error) {
        throw new Neo4jGraphResponseError(
          error instanceof Error ? error.message : 'Neo4j query failed.',
        );
      } finally {
        await driver.close();
      }
    },

    async checkHealth() {
      if (!isNeo4jConfigured()) {
        return {
          ok: false,
          status: 'disabled' as const,
        };
      }

      const driver = driverFactory();

      try {
        const config = getNeo4jGraphConfig();
        await driver.executeQuery('RETURN 1 AS ok', {}, { database: config.database });
        return {
          ok: true,
          status: 'ready' as const,
        };
      } catch {
        return {
          ok: false,
          status: 'error' as const,
        };
      } finally {
        await driver.close();
      }
    },

    async syncBaseline(batch: GraphSyncBatch) {
      if (!isNeo4jConfigured()) {
        throw new Neo4jGraphUnavailableError();
      }

      const driver = driverFactory();

      try {
        const config = getNeo4jGraphConfig();
        // buildNeo4jSyncCypher() emits the guarded MERGE-based write path for all graph syncs.
        await driver.executeQuery(
          buildNeo4jSyncCypher(),
          {
            nodes: batch.nodes,
            edges: batch.edges,
          },
          { database: config.database },
        );

        return {
          nodesWritten: batch.nodes.length,
          edgesWritten: batch.edges.length,
        };
      } catch (error) {
        throw new Neo4jGraphResponseError(
          error instanceof Error ? error.message : 'Neo4j sync failed.',
        );
      } finally {
        await driver.close();
      }
    },
  };
}
