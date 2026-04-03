export class Neo4jGraphUnavailableError extends Error {
  constructor(message = 'Neo4j graph adapter is unavailable.') {
    super(message);
    this.name = 'Neo4jGraphUnavailableError';
  }
}

export class Neo4jGraphResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Neo4jGraphResponseError';
  }
}
