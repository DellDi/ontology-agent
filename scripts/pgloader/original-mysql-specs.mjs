export const originalMysqlTableSpecs = [
  { sourceTable: 'dw_datacenter_system_organization' },
  { sourceTable: 'dw_datacenter_precinct' },
  { sourceTable: 'dw_datacenter_owner' },
  { sourceTable: 'dw_datacenter_chargeitem' },
  { sourceTable: 'dw_datacenter_charge' },
  { sourceTable: 'dw_datacenter_bill' },
  { sourceTable: 'dw_datacenter_services' },
  { sourceTable: 'dw_datacenter_house' },
  { sourceTable: 'dw_datacenter_system_user' },
];

export function buildProjectedMysqlSelectSql(spec, sourceSchema) {
  return `
SELECT *
FROM (
  SELECT
    t.*,
    ROW_NUMBER() OVER (PARTITION BY \`id\` ORDER BY \`id\`) AS __row_number
  FROM \`${sourceSchema}\`.\`${spec.sourceTable}\` t
) deduped
WHERE deduped.__row_number = 1
`.trim();
}

export function buildMaterializedMysqlViewDefinition(spec, sourceSchema) {
  return `
${spec.sourceTable} AS $$
${buildProjectedMysqlSelectSql(spec, sourceSchema)}
$$
`.trim();
}

export function buildProjectedMysqlCreateTableSql(
  spec,
  sourceSchema,
  debugSchema,
) {
  return `
CREATE TABLE \`${debugSchema}\`.\`${spec.sourceTable}\` AS
${buildProjectedMysqlSelectSql(spec, sourceSchema)}
`.trim();
}

const originalMysqlSpecsModule = {
  originalMysqlTableSpecs,
  buildProjectedMysqlSelectSql,
  buildMaterializedMysqlViewDefinition,
  buildProjectedMysqlCreateTableSql,
};

export default originalMysqlSpecsModule;
