import runGraphSyncJobModule from './lib/run-graph-sync-job';

const { runGraphSyncJobCli } = runGraphSyncJobModule;

runGraphSyncJobCli({
  job: 'status',
  defaultTriggerType: 'manual',
  defaultTriggeredBy: 'scripts/sync-neo4j-status.mts',
});
