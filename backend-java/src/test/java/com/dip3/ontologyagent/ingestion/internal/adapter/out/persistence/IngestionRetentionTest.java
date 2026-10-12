package com.dip3.ontologyagent.ingestion.internal.adapter.out.persistence;

import com.dip3.ontologyagent.support.JsonCodec;
import com.dip3.ontologyagent.support.MigrationTestSupport;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.support.JdbcTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import static org.junit.jupiter.api.Assertions.*;

@Testcontainers
class IngestionRetentionTest {
    @Container static final PostgreSQLContainer POSTGRES=new PostgreSQLContainer("postgres:17.8-alpine");
    private JdbcTemplate jdbc;
    private JdbcTransactionManager manager;
    private IngestionRetentionPostgresAdapter retention;
    private final Instant now=Instant.now();
    @BeforeAll static void migrate(){ MigrationTestSupport.migrate(POSTGRES); }
    @BeforeEach void setup(){
        var ds=new DriverManagerDataSource(POSTGRES.getJdbcUrl(),POSTGRES.getUsername(),POSTGRES.getPassword());
        jdbc=new JdbcTemplate(ds);manager=new JdbcTransactionManager(ds);
        retention=new IngestionRetentionPostgresAdapter(jdbc,new JsonCodec(),manager);
        jdbc.execute("truncate ingestion.dataset_version_sets,ingestion.source_ingestion_runs,ingestion.product_materialization_runs,platform.graph_sync_runs,platform.audit_events cascade");
        for(int i=1;i<=9;i++) release(i,i==9?now.minusSeconds(10):now.minus(100-i,ChronoUnit.DAYS),i==9?"s3":null);
        pinFollowUp("set1");pinSnapshot("set4");pinJob("set2");pinGraph("set5");
    }
    @Test void previewIsReadOnlyAndApplyRetainsReferencesRecentDataAndIncrementalAncestors(){
        var plan=retention.retain(now.minus(30,ChronoUnit.DAYS),2,false);
        assertEquals(List.of("set3","set6","set7"),plan.versionSets());
        assertEquals(List.of("p3","p6","p7"),plan.products());
        assertEquals(List.of("s7","s6"),plan.sources());
        assertEquals(3L,plan.factRows().get("facts.easyv_ai_application"));
        assertEquals(2,plan.sourceBatches());assertEquals(8,plan.sourcePayloadBytes());
        assertEquals(9,count("facts.easyv_ai_application"));assertEquals(0,count("platform.audit_events"));
        var result=retention.retain(now.minus(30,ChronoUnit.DAYS),2,true);
        assertTrue(result.applied());assertEquals(plan.versionSets(),result.versionSets());
        assertEquals(6,count("facts.easyv_ai_application"));assertEquals(7,count("ingestion.source_dataset_batches"));
        assertEquals("revoked",value("select status from ingestion.data_product_versions where id='p3'"));
        assertEquals("published",value("select status from ingestion.source_dataset_versions where id='s3'"));
        assertEquals("revoked",value("select status from ingestion.source_dataset_versions where id='s7'"));
        assertEquals(9,count("ingestion.dataset_version_sets"));assertEquals(9,count("ingestion.data_product_version_lineage"));
        assertEquals(1,count("platform.audit_events"));
        assertTrue(retention.retain(now.minus(30,ChronoUnit.DAYS),2,true).products().isEmpty());
        assertEquals(6,count("facts.easyv_ai_application"));
    }
    @Test void currentCursorAndUnfinishedProductKeepTheirSourceArtifacts(){
        jdbc.update("insert into ingestion.dataset_cursors(dataset_key,last_successful_version_id) values ('easyv-ai-application','s7')");
        jdbc.update("insert into ingestion.product_materialization_runs(id,product_key,mode,trigger_type,input_summary) values ('pending','easyv-ai-application','full','manual','{\"application\":\"s6\"}')");
        var result=retention.retain(now.minus(30,ChronoUnit.DAYS),2,true);
        assertTrue(result.sources().isEmpty());assertEquals(9,count("ingestion.source_dataset_batches"));
    }
    @Test void newerCompleteSupersetsCountTowardRetentionForTheSameSources(){
        jdbc.update("insert into ingestion.source_ingestion_runs(id,source_key,mode,status,trigger_type,started_at,finished_at) values ('extra-run','easyv','full','completed','bootstrap',now(),now())");
        jdbc.update("""
                insert into ingestion.source_dataset_versions(id,source_key,dataset_key,source_ingestion_run_id,
                  version_number,schema_version,status,published_at,storage_ref,source_watermark,content_hash)
                select 'extra-source','easyv',dataset_key,'extra-run',1,schema_version,'published',now(),
                  'ingestion://source-dataset-version/extra-source/row-pack-v1','{"snapshot":true}',repeat('a',64)
                from ingestion.dataset_definitions where dataset_key='easyv-prototype-task'
                """);
        jdbc.update("insert into ingestion.product_materialization_runs(id,product_key,mode,status,trigger_type,started_at,finished_at) values ('extra-product-run','easyv-prototype-task','full','completed','bootstrap',now(),now())");
        jdbc.update("""
                insert into ingestion.data_product_versions(id,product_key,materialization_run_id,version_number,
                  schema_version,status,published_at,storage_ref,content_hash)
                select 'extra-product',product_key,'extra-product-run',1,schema_version,'published',now(),
                  'facts://easyv_prototype_task/extra-product',repeat('a',64)
                from ingestion.data_product_definitions where product_key='easyv-prototype-task'
                """);
        jdbc.update("""
                insert into ingestion.data_product_version_lineage(id,product_key,product_version_id,input_key,
                  source_dataset_key,source_dataset_version_id,transform_ref)
                select 'extra-lineage',i.product_key,'extra-product',i.input_key,i.dataset_key,'extra-source',d.transform_ref
                from ingestion.data_product_inputs i join ingestion.data_product_definitions d using(product_key)
                where i.product_key='easyv-prototype-task'
                """);
        for(String set:List.of("complete10","complete11")){
            jdbc.update("insert into ingestion.dataset_version_sets(set_id) values (?)",set);
            jdbc.update("insert into ingestion.dataset_version_set_items values (?,'easyv-ai-application','p9'),(?,'easyv-prototype-task','extra-product')",set,set);
            jdbc.update("update ingestion.dataset_version_sets set status='frozen',frozen_at=now() where set_id=?",set);
        }
        var plan=retention.retain(now.minus(30,ChronoUnit.DAYS),2,false);
        assertTrue(plan.versionSets().contains("set8"));
        assertFalse(plan.versionSets().contains("set9"));
        assertFalse(plan.products().contains("p9"));
        assertFalse(plan.products().contains("extra-product"));
    }
    @Test void obsoleteIncrementalChildrenRetireBeforeTheirParents(){
        jdbc.update("""
                insert into ingestion.source_ingestion_runs(id,source_key,mode,status,trigger_type,started_at,finished_at)
                values ('orphan-run','easyv','incremental','completed','bootstrap',now(),now())
                """);
        jdbc.update("""
                insert into ingestion.source_dataset_versions(id,source_key,dataset_key,source_ingestion_run_id,
                  version_number,parent_version_id,status,published_at,created_at,storage_ref,source_watermark,content_hash)
                values ('orphan-child','easyv','easyv-ai-application','orphan-run',10,'s6','published',
                  now()-interval '80 days',now()-interval '80 days',
                  'ingestion://source-dataset-version/orphan-child/row-pack-v1','{"snapshot":true}',repeat('a',64))
                """);
        var result=retention.retain(now.minus(30,ChronoUnit.DAYS),2,true);
        assertEquals(List.of("orphan-child","s7","s6"),result.sources());
        assertEquals("revoked",value("select status from ingestion.source_dataset_versions where id='s6'"));
    }
    @Test void retentionNeverChangesPublishedPayloadsAndRejectsNewPinsToRetiredSets(){
        retention.retain(now.minus(30,ChronoUnit.DAYS),2,true);
        assertThrows(DataAccessException.class,()->jdbc.update("delete from facts.easyv_ai_application where product_version_id='p9'"));
        assertThrows(DataAccessException.class,()->jdbc.update("delete from ingestion.source_dataset_batches where source_dataset_version_id='s9'"));
        assertThrows(DataAccessException.class,()->jdbc.update("update facts.easyv_ai_application set user_id=7 where product_version_id='p9'"));
        assertThrows(DataAccessException.class,()->pinFollowUp("set3"));
        assertThrows(DataAccessException.class,()->pinSnapshot("set3"));
        assertThrows(DataAccessException.class,()->pinJob("set3"));
        assertThrows(DataAccessException.class,()->pinGraph("set3"));
        assertEquals(1,jdbc.queryForObject("select count(*) from facts.easyv_ai_application where product_version_id='p9'",Integer.class));
    }
    @Test void failureRollsBackPayloadDeletionRevocationAndAuditTogether(){
        jdbc.execute("create or replace function public.reject_retention_audit() returns trigger language plpgsql as $$ begin raise exception 'audit unavailable'; end; $$");
        jdbc.execute("create trigger reject_retention_audit before insert on platform.audit_events for each row execute function public.reject_retention_audit()");
        try {
            assertThrows(DataAccessException.class,()->retention.retain(now.minus(30,ChronoUnit.DAYS),2,true));
            assertEquals(9,count("facts.easyv_ai_application"));assertEquals(9,count("ingestion.source_dataset_batches"));
            assertEquals(9,jdbc.queryForObject("select count(*) from ingestion.dataset_version_sets where status='frozen'",Integer.class));
            assertEquals(0,count("platform.audit_events"));
        } finally { jdbc.execute("drop trigger reject_retention_audit on platform.audit_events"); }
    }
    @Test void concurrentCommittedPinIsIncludedBeforeRetirement() throws Exception {
        var inserted=new CountDownLatch(1);var commit=new CountDownLatch(1);
        try(var pool=Executors.newFixedThreadPool(2)){
            var pin=pool.submit(()->new TransactionTemplate(manager).execute(status->{
                pinFollowUp("set3");inserted.countDown();
                try { if(!commit.await(3,TimeUnit.SECONDS))throw new IllegalStateException("pin commit not released"); }
                catch(InterruptedException error){Thread.currentThread().interrupt();throw new RuntimeException(error);}
                return true;
            }));
            assertTrue(inserted.await(3,TimeUnit.SECONDS));
            var clean=pool.submit(()->retention.retain(now.minus(30,ChronoUnit.DAYS),2,true));
            commit.countDown();assertTrue(pin.get(5,TimeUnit.SECONDS));
            assertFalse(clean.get(8,TimeUnit.SECONDS).versionSets().contains("set3"));
            assertEquals("published",value("select status from ingestion.data_product_versions where id='p3'"));
        } finally {commit.countDown();}
    }
    private void release(int n,Instant time,String parent){
        var at=Timestamp.from(time);String mode=parent==null?"full":"incremental";
        jdbc.update("insert into ingestion.source_ingestion_runs(id,source_key,mode,status,trigger_type,started_at,finished_at,created_at,updated_at) values (?,'easyv',?,'completed','bootstrap',?,?,?,?)","r"+n,mode,at,at,at,at);
        jdbc.update("insert into ingestion.source_dataset_versions(id,source_key,dataset_key,source_ingestion_run_id,version_number,parent_version_id,created_at) values (?,'easyv','easyv-ai-application',?,?,?,?)","s"+n,"r"+n,n,parent,at);
        jdbc.update("insert into ingestion.source_dataset_batches(id,source_key,dataset_key,source_dataset_version_id,batch_number,row_count,content_hash,payload,created_at) values (?,'easyv','easyv-ai-application',?,1,1,repeat('a',64),decode('01020304','hex'),?)","b"+n,"s"+n,at);
        jdbc.update("update ingestion.source_dataset_versions set status='published',published_at=?,storage_ref='ingestion://source-dataset-version/'||id||'/row-pack-v1',source_watermark='{\"snapshot\":true}',content_hash=repeat('a',64),row_count=1 where id=?",at,"s"+n);
        jdbc.update("insert into ingestion.product_materialization_runs(id,product_key,mode,status,trigger_type,input_summary,started_at,finished_at,created_at,updated_at) values (?,'easyv-ai-application','full','completed','bootstrap',jsonb_build_object('application',?::text),?,?,?,?)","m"+n,"s"+n,at,at,at,at);
        jdbc.update("insert into ingestion.data_product_versions(id,product_key,materialization_run_id,version_number,created_at) values (?,'easyv-ai-application',?,?,?)","p"+n,"m"+n,n,at);
        jdbc.update("insert into facts.easyv_ai_application(product_version_id,source_dataset_key,source_dataset_version_id,source_id,app_id,user_id,space_id,team_id,scope_type,created_at,updated_at,is_deleted) values (?,'easyv-ai-application',?,1,?,8,1,1,'personal',?,?,false)","p"+n,"s"+n,"app"+n,at,at);
        jdbc.update("update ingestion.data_product_versions set status='published',published_at=?,content_hash=repeat('a',64),storage_ref='facts://easyv_ai_application/'||id,row_count=1 where id=?",at,"p"+n);
        jdbc.update("insert into ingestion.data_product_version_lineage(id,product_key,product_version_id,input_key,source_dataset_key,source_dataset_version_id,transform_ref) select ?,'easyv-ai-application',?,input_key,dataset_key,?,(select transform_ref from ingestion.data_product_definitions where product_key='easyv-ai-application') from ingestion.data_product_inputs where product_key='easyv-ai-application'","l"+n,"p"+n,"s"+n);
        jdbc.update("update ingestion.product_materialization_runs set result_product_version_id=? where id=?","p"+n,"m"+n);
        jdbc.update("insert into ingestion.dataset_version_sets(set_id,status,captured_at,frozen_at,created_at) values (?,'frozen',?,?,?)","set"+n,at,at,at);
        jdbc.update("insert into ingestion.dataset_version_set_items(set_id,product_key,product_version_id) values (?,'easyv-ai-application',?)","set"+n,"p"+n);
    }
    private void pinFollowUp(String set){jdbc.update("insert into platform.analysis_session_follow_ups(id,session_id,owner_user_id,question_text,referenced_execution_id,inherited_context,merged_context,created_at,updated_at,capability_binding,dataset_version_set_id) values (?,'session','user','question','execution','{}','{}',now(),now(),'{}',?)","follow-"+set,set);}
    private void pinSnapshot(String set){jdbc.update("insert into platform.analysis_execution_snapshots(execution_id,session_id,owner_user_id,status,plan_snapshot,created_at,updated_at,capability_binding,dataset_version_set_id) values (?,'session','user','completed','{}',now(),now(),'{}',?)","execution-"+set,set);}
    private void pinJob(String set){jdbc.update("insert into platform.jobs(id,type,status,owner_user_id,organization_id,payload,available_at,created_at,updated_at,dataset_version_set_id) values (?,'analysis','pending','user','org','{}',now(),now(),now(),?)","job-"+set,set);}
    private void pinGraph(String set){jdbc.update("insert into platform.graph_sync_runs(id,mode,status,scope_type,scope_key,trigger_type,triggered_by,cursor_snapshot,created_at,updated_at) values (?,'incremental','completed','organization','org','manual','user',jsonb_build_object('datasetVersionSetId',?::text),now(),now())","graph-"+set,set);}
    private long count(String relation){return jdbc.queryForObject("select count(*) from "+relation,Long.class);}
    private String value(String sql){return jdbc.queryForObject(sql,String.class);}
}
