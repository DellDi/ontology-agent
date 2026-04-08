#!/usr/bin/env bash
set -euo pipefail

# 优化版 Node.js 迁移 - 使用批量插入

MYSQL_URL="${MYSQL_URL:-mysql://77196957-6017-4cf7-9f43-a6de003be095:MQ8bVLK6y8IuLBec@jms.new-see.com:33061/newsee-datacenter}"
DATABASE_URL="${DATABASE_URL:-postgresql://ontology_agent:ontology_agent_dev_password@127.0.0.1:55432/ontology_agent}"

PROJECTION_DB="${PROJECTION_DB:-newsee_datacenter_pgloader_debug_check}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export MYSQL_URL DATABASE_URL PROJECTION_DB

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

echo "=== 优化版 Node.js 迁移（批量插入） ==="
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

// 性能配置
const BATCH_SIZE = 5000;        // 增大读取批次
const INSERT_BATCH_SIZE = 500;  // 每批插入行数（避免 SQL 过长）
const MAX_WORKERS = 4;          // 并发迁移表数

function toSnakeCase(str) {
  return str.replace(/[A-Z]/g, letter => '_' + letter.toLowerCase());
}

function cleanValue(val) {
  if (val === null || val === undefined) return null;
  if (val instanceof Date) return val.toISOString();
  if (Buffer.isBuffer(val)) return val.toString('base64');
  return val;
}

// 批量插入 - 使用多值 INSERT
async function batchInsert(pgClient, tableName, columnNames, pgColumnNames, rows) {
  if (rows.length === 0) return;

  const insertColumns = pgColumnNames.join(', ');
  const valuesPlaceholders = [];
  const values = [];
  let paramIndex = 1;

  for (const row of rows) {
    const rowPlaceholders = [];
    for (const col of columnNames) {
      values.push(cleanValue(row[col]));
      rowPlaceholders.push('\$' + paramIndex++);
    }
    valuesPlaceholders.push('(' + rowPlaceholders.join(', ') + ')');
  }

  const sql = \`INSERT INTO erp_staging.\${tableName} (\${insertColumns}) VALUES \${valuesPlaceholders.join(', ')}\`;
  await pgClient.query(sql, values);
}

async function migrateTable(tableName, mysqlConn, pgClient) {
  const startTime = performance.now();

  // 1. 获取表结构
  const [columns] = await mysqlConn.query('SHOW COLUMNS FROM ??', [tableName]);
  const columnNames = columns.map(c => c.Field);
  const pgColumnNames = columnNames.map(toSnakeCase);

  // 2. 统计行数
  const [[{ count }]] = await mysqlConn.query('SELECT COUNT(*) as count FROM ??', [tableName]);
  console.log(\`\\n[\${tableName}] 列数: \${columnNames.length}, 行数: \${count}\`);

  if (count === 0) {
    return { tableName, count: 0, duration: 0 };
  }

  // 3. 创建表
  const columnDefs = columns.map(c => {
    const pgName = toSnakeCase(c.Field);
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

  await pgClient.query(\`CREATE TABLE IF NOT EXISTS erp_staging.\${tableName} (\${columnDefs})\`);
  await pgClient.query(\`TRUNCATE TABLE erp_staging.\${tableName}\`);

  // 4. 分批读取 + 批量插入
  let processed = 0;
  let batchBuffer = [];

  for (let offset = 0; offset < count; offset += BATCH_SIZE) {
    const [rows] = await mysqlConn.query(
      'SELECT * FROM ?? LIMIT ? OFFSET ?', [tableName, BATCH_SIZE, offset]
    );

    if (rows.length === 0) break;

    // 累积到批处理缓冲区
    batchBuffer.push(...rows);

    // 当缓冲区达到 INSERT_BATCH_SIZE 时执行批量插入
    while (batchBuffer.length >= INSERT_BATCH_SIZE) {
      const insertBatch = batchBuffer.splice(0, INSERT_BATCH_SIZE);
      await batchInsert(pgClient, tableName, columnNames, pgColumnNames, insertBatch);
    }

    processed += rows.length;
    if (processed % 10000 === 0 || processed === count) {
      const percent = ((processed / count) * 100).toFixed(1);
      process.stdout.write(\`\\r[\${tableName}] \${percent}% (\${processed}/\${count})\`);
    }
  }

  // 插入剩余数据
  if (batchBuffer.length > 0) {
    await batchInsert(pgClient, tableName, columnNames, pgColumnNames, batchBuffer);
    batchBuffer = [];
  }

  const duration = ((performance.now() - startTime) / 1000).toFixed(2);
  const rps = (count / parseFloat(duration)).toFixed(0);
  console.log(\`\\n[\${tableName}] 完成: \${count} 行, \${duration}s (\${rps} 行/秒)\`);

  return { tableName, count, duration: parseFloat(duration), rps: parseInt(rps) };
}

async function main() {
  const startTime = performance.now();

  // 连接
  const mysqlConn = await mysql.createConnection({
    host: mysqlUrl.hostname,
    port: mysqlUrl.port ? Number(mysqlUrl.port) : 3306,
    user: decodeURIComponent(mysqlUrl.username),
    password: decodeURIComponent(mysqlUrl.password),
    database: projectionDb,
  });

  const pgClient = new Client({
    host: pgUrl.hostname,
    port: pgUrl.port ? Number(pgUrl.port) : 5432,
    user: decodeURIComponent(pgUrl.username),
    password: decodeURIComponent(pgUrl.password),
    database: pgUrl.pathname.replace(/^\/+/, ''),
  });
  await pgClient.connect();

  await pgClient.query('CREATE SCHEMA IF NOT EXISTS erp_staging');

  console.log('连接成功，开始迁移...');
  console.log(\`配置: 读取批次=\${BATCH_SIZE}, 插入批次=\${INSERT_BATCH_SIZE}\`);

  // 串行迁移（PostgreSQL 单连接并发写入效率不高）
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

  await mysqlConn.end();
  await pgClient.end();

  const totalDuration = ((performance.now() - startTime) / 1000).toFixed(2);
  const totalRows = results.reduce((sum, r) => sum + (r.count || 0), 0);
  const avgRps = (totalRows / parseFloat(totalDuration)).toFixed(0);

  console.log('\\n=== 迁移汇总 ===');
  console.log(\`总表数: \${results.length}\`);
  console.log(\`总行数: \${totalRows}\`);
  console.log(\`总耗时: \${totalDuration}s\`);
  console.log(\`平均速度: \${avgRps} 行/秒\`);
  console.log('\\n各表详情:');
  results.forEach(r => {
    const status = r.error ? '❌' : '✅';
    const speed = r.rps ? \` (\${r.rps} 行/秒)\` : '';
    console.log(\`  \${status} \${r.tableName}: \${r.count} 行 (\${r.duration}s)\${speed}\`);
  });
}

main().catch(err => {
  console.error('迁移失败:', err);
  process.exit(1);
});
"
