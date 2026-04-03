import type { Driver } from 'neo4j-driver';

export type Neo4jGraphConfig = {
  uri: string;
  username: string;
  password: string;
  database: string;
};

export function isNeo4jConfigured() {
  return Boolean(
    process.env.NEO4J_URI?.trim() &&
      process.env.NEO4J_USERNAME?.trim() &&
      process.env.NEO4J_PASSWORD?.trim(),
  );
}

function getRequiredEnv(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required to configure Neo4j.`);
  }

  return value;
}

export function getNeo4jGraphConfig(): Neo4jGraphConfig {
  return {
    uri: getRequiredEnv('NEO4J_URI'),
    username: getRequiredEnv('NEO4J_USERNAME'),
    password: getRequiredEnv('NEO4J_PASSWORD'),
    database: process.env.NEO4J_DATABASE?.trim() || 'neo4j',
  };
}

export function ensureNeo4jDatabase(
  config: Neo4jGraphConfig,
  driverFactory: (config: Neo4jGraphConfig) => Driver,
) {
  return driverFactory(config);
}
