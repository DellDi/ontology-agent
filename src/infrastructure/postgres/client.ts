import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from './schema';

export type PostgresDb = NodePgDatabase<typeof schema>;

export type PostgresDatabaseClient = {
  db: PostgresDb;
  pool: Pool;
};

function getDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to create the Postgres client.');
  }

  return databaseUrl;
}

export function createPostgresDb(
  connectionString = getDatabaseUrl(),
): PostgresDatabaseClient {
  const pool = new Pool({
    connectionString,
  });

  const db = drizzle(pool, {
    schema,
  });

  return {
    db,
    pool,
  };
}
