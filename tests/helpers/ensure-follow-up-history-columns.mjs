import { readFile } from 'node:fs/promises';

import pg from 'pg';

async function applyMigrationSql(pool, migrationFile) {
  const migrationSql = await readFile(
    new URL(`../../drizzle/${migrationFile}`, import.meta.url),
    'utf8',
  );
  const statements = migrationSql
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await pool.query(statement);
  }
}

export async function ensureFollowUpHistoryColumns(databaseUrl) {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
  });

  try {
    const followUpTable = await pool.query(
      "select to_regclass('platform.analysis_session_follow_ups') as name",
    );

    if (!followUpTable.rows[0]?.name) {
      await applyMigrationSql(pool, '0008_analysis_session_follow_ups.sql');
      await applyMigrationSql(pool, '0009_follow_up_plan_versions.sql');
      await applyMigrationSql(pool, '0010_follow_up_plan_invalidation_and_ordering.sql');
      await applyMigrationSql(pool, '0011_follow_up_history_links.sql');
      return;
    }

    const columnCheck = await pool.query(
      `
        select table_name, column_name
        from information_schema.columns
        where table_schema = 'platform'
          and (
            (table_name = 'analysis_session_follow_ups' and column_name in ('parent_follow_up_id', 'result_execution_id'))
            or
            (table_name = 'analysis_execution_snapshots' and column_name in ('follow_up_id'))
          )
      `,
    );
    const availableColumns = new Set(
      columnCheck.rows.map((row) => `${row.table_name}.${row.column_name}`),
    );
    const requiredColumns = [
      'analysis_session_follow_ups.parent_follow_up_id',
      'analysis_session_follow_ups.result_execution_id',
      'analysis_execution_snapshots.follow_up_id',
    ];

    if (
      requiredColumns.every((columnKey) => availableColumns.has(columnKey))
    ) {
      return;
    }

    await applyMigrationSql(pool, '0011_follow_up_history_links.sql');
  } finally {
    await pool.end();
  }
}
