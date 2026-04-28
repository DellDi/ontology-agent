import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from './schema';

export type PostgresDb = NodePgDatabase<typeof schema>;

export type PostgresDatabaseClient = {
  db: PostgresDb;
  pool: Pool;
};

type GlobalPostgresCache = typeof globalThis & {
  __ontologyAgentPostgresClient?: PostgresDatabaseClient;
};

const DEFAULT_POOL_MAX = 20;
const DEFAULT_IDLE_TIMEOUT_MS = 30_000;
const DEFAULT_CONNECTION_TIMEOUT_MS = 5_000;

function getDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to create the Postgres client.');
  }

  return databaseUrl;
}

function readPositiveIntegerEnv(name: string, fallback: number) {
  const raw = process.env[name];

  if (!raw) {
    return fallback;
  }

  const value = Number.parseInt(raw, 10);

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return value;
}

function getPoolConfig() {
  return {
    max: readPositiveIntegerEnv('POSTGRES_POOL_MAX', DEFAULT_POOL_MAX),
    idleTimeoutMillis: readPositiveIntegerEnv(
      'POSTGRES_IDLE_TIMEOUT_MS',
      DEFAULT_IDLE_TIMEOUT_MS,
    ),
    connectionTimeoutMillis: readPositiveIntegerEnv(
      'POSTGRES_CONNECTION_TIMEOUT_MS',
      DEFAULT_CONNECTION_TIMEOUT_MS,
    ),
  };
}

export function createPostgresDb(
  connectionString = getDatabaseUrl(),
): PostgresDatabaseClient {
  const globalCache = globalThis as GlobalPostgresCache;

  if (
    connectionString === getDatabaseUrl() &&
    globalCache.__ontologyAgentPostgresClient
  ) {
    return globalCache.__ontologyAgentPostgresClient;
  }

  const pool = new Pool({
    connectionString,
    ...getPoolConfig(),
  });

  const db = drizzle(pool, {
    schema,
  });

  const client = {
    db,
    pool,
  };

  if (connectionString === getDatabaseUrl()) {
    globalCache.__ontologyAgentPostgresClient = client;
  }

  return client;
}
