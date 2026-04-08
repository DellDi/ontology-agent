import runGraphSyncJobModule from './lib/run-graph-sync-job';

const { runGraphSyncJobCli } = runGraphSyncJobModule;

runGraphSyncJobCli({
  job: 'consistency-sweep',
  defaultTriggerType: 'recovery',
  defaultTriggeredBy: 'scripts/sync-neo4j-consistency-sweep.mts',
});
