#!/usr/bin/env bash
set -euo pipefail

# 纯 Node.js 迁移方案 - 绕过 pgloader 的 macOS ARM Bug

MYSQL_URL="${MYSQL_URL:-mysql://77196957-6017-4cf7-9f43-a6de003be095:MQ8bVLK6y8IuLBec@jms.new-see.com:33061/newsee-datacenter}"
DATABASE_URL="${DATABASE_URL:-postgresql://ontology_agent:ontology_agent_dev_password@127.0.0.1:55432/ontology_agent}"

PROJECTION_DB="${PROJECTION_DB:-newsee_datacenter_pgloader_debug_check}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export MYSQL_URL DATABASE_URL PROJECTION_DB

# 所有要迁移的表
TABLE_NAMES=(
  'dw_datacenter_system_user'
  'dw_datacenter_system_organization'
  'dw_datacenter_precinct'
  'dw_datacenter_owner'
  'dw_datacenter_chargeitem'
  'dw_datacenter_charge'
  'dw_datacenter_bill'
  'dw_datacenter_services'
  'dw_datacenter_house'
)

echo "=== Node.js 直接迁移方案 ==="
echo "源: MySQL ($MYSQL_URL)"
echo "目标: PostgreSQL ($DATABASE_URL)"
echo "表数: ${#TABLE_NAMES[@]}"
echo ""

node -e "
const mysql = require('mysql2/promise');
const { Client } = require('pg');
const { performance } = require('perf_hooks');

const mysqlUrl = new URL('$MYSQL_URL');
const pgUrl = new URL('$DATABASE_URL');
const projectionDb = '$PROJECTION_DB';
const tableNames = $(printf '%s' "${TABLE_NAMES[*]}" | jq -R 'split(" ")' 2>/dev/null || echo '["dw_datacenter_system_user"]');

// 字段名映射：驼峰 -> 下划线
function toSnakeCase(str) {
  return str.replace(/[A-Z]/g, letter => '_' + letter.toLowerCase());
}

// 清理值
function cleanValue(val) {
  if (val === null || val === undefined) return null;
  if (val instanceof Date) return val.toISOString();
  if (Buffer.isBuffer(val)) return val.toString('base64');
  return val;
}

async function migrateTable(tableName, mysqlConn, pgClient) {
  const startTime = performance.now();

  // 1. 获取 MySQL 表结构
  const [columns] = await mysqlConn.query(
    'SHOW COLUMNS FROM ??', [tableName]
  );

  const columnNames = columns.map(c => c.Field);
  const pgColumnNames = columnNames.map(toSnakeCase);

  console.log(\`\\n[\${tableName}] 列数: \${columnNames.length}\`);

  // 2. 统计行数
  const [[{ count }]] = await mysqlConn.query(
    'SELECT COUNT(*) as count FROM ??', [tableName]
  );
  console.log(\`[\${tableName}] 行数: \${count}\`);

  if (count === 0) {
    console.log(\`[\${tableName}] 跳过空表\`);
    return { tableName, count: 0, duration: 0 };
  }

  // 3. 创建 PostgreSQL 目标表（如果不存在）
  const columnDefs = columns.map(c => {
    const pgName = toSnakeCase(c.Field);
    // 简化类型映射
    let pgType = 'TEXT';
    const type = c.Type.toLowerCase();
    if (type.includes('int')) pgType = 'BIGINT';
    else if (type.includes('decimal') || type.includes('numeric') || type.includes('float') || type.includes('double')) pgType = 'NUMERIC';
    else if (type.includes('datetime') || type.includes('timestamp')) pgType = 'TIMESTAMPTZ';
    else if (type.includes('date')) pgType = 'DATE';
    else if (type.includes('time')) pgType = 'TIME';
    else if (type.includes('bool')) pgType = 'BOOLEAN';
    else if (type.includes('json')) pgType = 'JSONB';
    else if (type.includes('blob') || type.includes('binary')) pgType = 'BYTEA';

    return \`\${pgName} \${pgType}\`;
  }).join(', ');

  await pgClient.query(\`
    CREATE TABLE IF NOT EXISTS erp_staging.\${tableName} (
      \${columnDefs}
    )
  \`);

  // 4. 清空目标表
  await pgClient.query(\`TRUNCATE TABLE erp_staging.\${tableName}\`);

  // 5. 分批读取并插入
  const batchSize = 1000;
  let processed = 0;
  const insertColumns = pgColumnNames.join(', ');
  const placeholders = pgColumnNames.map((_, i) => '\$' + (i + 1)).join(', ');

  for (let offset = 0; offset < count; offset += batchSize) {
    const [rows] = await mysqlConn.query(
      'SELECT * FROM ?? LIMIT ? OFFSET ?', [tableName, batchSize, offset]
    );

    if (rows.length === 0) break;

    // 批量插入
    for (const row of rows) {
      const values = columnNames.map(col => cleanValue(row[col]));
      await pgClient.query(
        \`INSERT INTO erp_staging.\${tableName} (\${insertColumns}) VALUES (\${placeholders})\`,
        values
      );
    }

    processed += rows.length;
    if (processed % 5000 === 0 || processed === count) {
      const percent = ((processed / count) * 100).toFixed(1);
      process.stdout.write(\`\\r[\${tableName}] \${percent}% (\${processed}/\${count})\`);
    }
  }

  const duration = ((performance.now() - startTime) / 1000).toFixed(2);
  console.log(\`\\n[\${tableName}] 完成: \${processed} 行, \${duration}s\`);

  return { tableName, count: processed, duration: parseFloat(duration) };
}

async function main() {
  const startTime = performance.now();

  // 连接 MySQL
  const mysqlConn = await mysql.createConnection({
    host: mysqlUrl.hostname,
    port: mysqlUrl.port ? Number(mysqlUrl.port) : 3306,
    user: decodeURIComponent(mysqlUrl.username),
    password: decodeURIComponent(mysqlUrl.password),
    database: projectionDb,
  });

  // 连接 PostgreSQL
  const pgClient = new Client({
    host: pgUrl.hostname,
    port: pgUrl.port ? Number(pgUrl.port) : 5432,
    user: decodeURIComponent(pgUrl.username),
    password: decodeURIComponent(pgUrl.password),
    database: pgUrl.pathname.replace(/^\/+/, ''),
  });
  await pgClient.connect();

  // 创建 schema
  await pgClient.query('CREATE SCHEMA IF NOT EXISTS erp_staging');

  console.log('连接成功，开始迁移...');

  // 迁移所有表
  const results = [];
  for (const tableName of tableNames) {
    try {
      const result = await migrateTable(tableName, mysqlConn, pgClient);
      results.push(result);
    } catch (err) {
      console.error(\`[\${tableName}] 错误: \${err.message}\`);
      results.push({ tableName, count: 0, duration: 0, error: err.message });
    }
  }

  // 关闭连接
  await mysqlConn.end();
  await pgClient.end();

  // 汇总
  const totalDuration = ((performance.now() - startTime) / 1000).toFixed(2);
  const totalRows = results.reduce((sum, r) => sum + (r.count || 0), 0);

  console.log('\\n=== 迁移汇总 ===');
  console.log(\`总表数: \${results.length}\`);
  console.log(\`总行数: \${totalRows}\`);
  console.log(\`总耗时: \${totalDuration}s\`);
  console.log('\\n各表详情:');
  results.forEach(r => {
    const status = r.error ? '❌' : '✅';
    console.log(\`  \${status} \${r.tableName}: \${r.count} 行 (\${r.duration}s)\${r.error ? ' - ' + r.error : ''}\`);
  });
}

main().catch(err => {
  console.error('迁移失败:', err);
  process.exit(1);
});
"
