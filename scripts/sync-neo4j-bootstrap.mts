import runGraphSyncJobModule from './lib/run-graph-sync-job';

const { runGraphSyncJobCli } = runGraphSyncJobModule;

runGraphSyncJobCli({
  job: 'bootstrap',
  defaultTriggerType: 'manual',
  defaultTriggeredBy: 'scripts/sync-neo4j-bootstrap.mts',
});
