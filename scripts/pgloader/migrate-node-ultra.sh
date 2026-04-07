#!/usr/bin/env bash
set -euo pipefail

# 极速版 Node.js 迁移 - 使用 PostgreSQL COPY 协议

MYSQL_URL="${MYSQL_URL:-mysql://8f749668-9269-4471-9f8a-d0a78dc96977:J3PTyY5m6wCoJzn7@jms.new-see.com:33061/newsee-datacenter}"
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

echo "=== 极速版 Node.js 迁移（PostgreSQL COPY 协议） ==="
echo "源: MySQL ($MYSQL_URL)"
echo "目标: PostgreSQL ($DATABASE_URL)"
echo "表数: ${#TABLE_NAMES[@]}"
echo ""

node -e "
const mysql = require('mysql2/promise');
const { Client } = require('pg');
const { performance } = require('perf_hooks');
const { Readable } = require('stream');

const mysqlUrl = new URL('$MYSQL_URL');
const pgUrl = new URL('$DATABASE_URL');
const projectionDb = '$PROJECTION_DB';
const tableNames = $(printf '%s' "${TABLE_NAMES[*]}" | jq -R 'split(" ")' 2>/dev/null || echo '["dw_datacenter_system_user"]');

// 性能配置
const BATCH_SIZE = 10000;  // 每批读取行数

function toSnakeCase(str) {
  return str.replace(/[A-Z]/g, letter => '_' + letter.toLowerCase());
}

function escapeCsv(value) {
  if (value === null || value === undefined) return '\\\\N';
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString('base64');
  const str = String(value);
  // CSV 转义：双引号 -> \"\"，包含特殊字符时用引号包裹
  if (str.includes('\\t') || str.includes('\\n') || str.includes('\\r') || str.includes('\\\\')) {
    return '\"' + str.replace(/\\\\/g, '\\\\\\\\').replace(/\\t/g, '\\\\t').replace(/\\n/g, '\\\\n').replace(/\\r/g, '\\\\r').replace(/'/g, \"'\"'\") + '\"';
  }
  return str;
}

async function migrateTableWithCopy(tableName, mysqlConn, pgClient) {
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

  // 4. 使用 COPY 协议批量导入
  let processed = 0;
  const copySql = \`COPY erp_staging.\${tableName} (\${pgColumnNames.join(', ')}) FROM STDIN WITH (FORMAT csv, DELIMITER E'\\t', QUOTE E'\"', ESCAPE E'\\\\', NULL '\\\\N')\`;

  for (let offset = 0; offset < count; offset += BATCH_SIZE) {
    const [rows] = await mysqlConn.query(
      'SELECT * FROM ?? LIMIT ? OFFSET ?', [tableName, BATCH_SIZE, offset]
    );

    if (rows.length === 0) break;

    // 构建 TSV 数据流
    const tsvLines = rows.map(row => {
      return columnNames.map(col => escapeCsv(row[col])).join('\\t');
    }).join('\\n');

    // 使用 COPY FROM STDIN
    const copyStream = pgClient.query(copySql);
    const readable = Readable.from([tsvLines + '\\n']);

    await new Promise((resolve, reject) => {
      readable.pipe(copyStream)
        .on('finish', resolve)
        .on('error', reject);
    });

    processed += rows.length;
    if (processed % 20000 === 0 || processed === count) {
      const percent = ((processed / count) * 100).toFixed(1);
      process.stdout.write(\`\\r[\${tableName}] \${percent}% (\${processed}/\${count})\`);
    }
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
  console.log(\`配置: COPY 协议, 读取批次=\${BATCH_SIZE}\`);

  const results = [];
  for (const tableName of tableNames) {
    try {
      const result = await migrateTableWithCopy(tableName, mysqlConn, pgClient);
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
