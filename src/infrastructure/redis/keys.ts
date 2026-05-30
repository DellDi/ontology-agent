function getAppPrefix() {
  return process.env.REDIS_KEY_PREFIX ?? 'dip3';
}

function prefixed(namespace: string, ...parts: string[]) {
  return `${getAppPrefix()}:${namespace}:${parts.join(':')}`;
}

export const redisKeys = {
  jobQueue() {
    return prefixed('job', 'queue');
  },

  jobDeadLetterQueue() {
    return prefixed('job', 'queue', 'dlq');
  },

  rate(userId: string, resource: string) {
    return prefixed('rate', userId, resource);
  },

  worker(jobId: string, field: string) {
    return prefixed('worker', jobId, field);
  },

  stream(sessionId: string) {
    return prefixed('stream', sessionId);
  },

  streamSequence(sessionId: string) {
    return prefixed('stream-sequence', sessionId);
  },

  cache(scope: string, key: string) {
    return prefixed('cache', scope, key);
  },
} as const;
