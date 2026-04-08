import runGraphSyncJobModule from './lib/run-graph-sync-job';

const { runGraphSyncJobCli } = runGraphSyncJobModule;

runGraphSyncJobCli({
  job: 'org',
  defaultTriggerType: 'manual',
  defaultTriggeredBy: 'scripts/sync-neo4j-org.mts',
});
