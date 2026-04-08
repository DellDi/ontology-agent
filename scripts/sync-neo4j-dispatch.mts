import runGraphSyncJobModule from './lib/run-graph-sync-job';

const { runGraphSyncJobCli } = runGraphSyncJobModule;

runGraphSyncJobCli({
  job: 'dispatch',
  defaultTriggerType: 'scheduler',
  defaultTriggeredBy: 'scripts/sync-neo4j-dispatch.mts',
});
