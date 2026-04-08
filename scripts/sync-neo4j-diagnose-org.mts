import runGraphSyncJobModule from './lib/run-graph-sync-job';

const { runGraphSyncJobCli } = runGraphSyncJobModule;

runGraphSyncJobCli({
  job: 'diagnose-org',
  defaultTriggerType: 'manual',
  defaultTriggeredBy: 'scripts/sync-neo4j-diagnose-org.mts',
});
