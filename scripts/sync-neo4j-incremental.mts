import runGraphSyncJobModule from './lib/run-graph-sync-job';

const { runGraphSyncJobCli } = runGraphSyncJobModule;

runGraphSyncJobCli({
  job: 'incremental',
  defaultTriggerType: 'scheduler',
  defaultTriggeredBy: 'scripts/sync-neo4j-incremental.mts',
});
