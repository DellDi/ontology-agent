import { readFile } from 'node:fs/promises';

import pg from 'pg';

export async function ensureAnalysisExecutionSnapshotsTable(databaseUrl) {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
  });

  try {
    const existing = await pool.query(
      "select to_regclass('platform.analysis_execution_snapshots') as name",
    );

    if (existing.rows[0]?.name) {
      return;
    }

    const migrationSql = await readFile(
      new URL('../../drizzle/0005_analysis_execution_snapshots.sql', import.meta.url),
      'utf8',
    );
    const statements = migrationSql
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter(Boolean);

    for (const statement of statements) {
      await pool.query(statement);
    }
  } finally {
    await pool.end();
  }
}
