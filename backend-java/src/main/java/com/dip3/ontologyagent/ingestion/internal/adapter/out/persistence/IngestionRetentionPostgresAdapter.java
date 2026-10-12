package com.dip3.ontologyagent.ingestion.internal.adapter.out.persistence;

import com.dip3.ontologyagent.ingestion.internal.application.IngestionRetentionPort;
import com.dip3.ontologyagent.support.JsonCodec;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Repository
public class IngestionRetentionPostgresAdapter implements IngestionRetentionPort {
    private final JdbcTemplate jdbc;
    private final JsonCodec json;
    private final TransactionTemplate transaction;
    public IngestionRetentionPostgresAdapter(JdbcTemplate jdbc, JsonCodec json, PlatformTransactionManager manager) {
        this.jdbc=jdbc; this.json=json; this.transaction=new TransactionTemplate(manager);
    }

    @Override public Result retain(Instant cutoff, int releases, boolean apply) {
        return transaction.execute(status -> run(cutoff, releases, apply));
    }

    private Result run(Instant cutoff, int releases, boolean apply) {
        // Publication/pinning writes cannot cross the dependency scan and retirement transaction.
        // Lock order is fixed; a busy system fails this maintenance attempt instead of waiting indefinitely.
        jdbc.execute("set local lock_timeout='5s'");
        jdbc.execute("set local statement_timeout='5min'");
        if (apply) jdbc.execute("""
            lock table platform.jobs,platform.analysis_execution_snapshots,platform.analysis_session_follow_ups,
              platform.graph_sync_runs,ingestion.source_ingestion_runs,ingestion.product_materialization_runs,
              ingestion.dataset_cursors,ingestion.source_dataset_versions,ingestion.data_product_versions,
              ingestion.dataset_version_sets,ingestion.dataset_version_set_items in share row exclusive mode
            """);
        List<String> sets=jdbc.queryForList("""
            with grouped as (
              select s.set_id,s.captured_at,array_agg(distinct i.product_key order by i.product_key) products,
                     array_agg(distinct v.source_key order by v.source_key) sources
              from ingestion.dataset_version_sets s join ingestion.dataset_version_set_items i using(set_id)
              left join ingestion.data_product_version_lineage l on l.product_version_id=i.product_version_id
              left join ingestion.source_dataset_versions v on v.id=l.source_dataset_version_id
              where s.status='frozen' group by s.set_id,s.captured_at
              having bool_and(v.source_key is not null)
            ) select set_id from grouped s where captured_at<?
              and (select count(*) from grouped newer where newer.products @> s.products and newer.sources=s.sources
                   and (newer.captured_at,newer.set_id)>=(s.captured_at,s.set_id))>?
              and not exists(select 1 from platform.jobs where dataset_version_set_id=s.set_id)
              and not exists(select 1 from platform.analysis_execution_snapshots where dataset_version_set_id=s.set_id)
              and not exists(select 1 from platform.analysis_session_follow_ups where dataset_version_set_id=s.set_id)
              and not exists(select 1 from platform.graph_sync_runs where cursor_snapshot->>'datasetVersionSetId'=s.set_id)
            order by set_id
            """,String.class,Timestamp.from(cutoff),releases);
        String[] retiringSets=sets.toArray(String[]::new);
        List<String> products=jdbc.queryForList("""
            select v.id from ingestion.data_product_versions v where v.status='published' and v.published_at<?
              and exists(select 1 from ingestion.data_product_versions newer where newer.product_key=v.product_key
                         and newer.status='published' and newer.version_number>v.version_number)
              and not exists(select 1 from ingestion.dataset_version_set_items i
                             join ingestion.dataset_version_sets s using(set_id)
                             where i.product_version_id=v.id and s.status='frozen' and not (s.set_id=any(?::text[])))
            order by v.id
            """,String.class,Timestamp.from(cutoff),retiringSets);
        String[] retiringProducts=products.toArray(String[]::new);
        List<Relation> relations=jdbc.query("""
            select canonical_schema,canonical_relation from ingestion.data_product_definitions order by product_key
            """,(rs,n)->new Relation(rs.getString(1),rs.getString(2)));
        String factSources=relations.stream().map(r->"select source_dataset_version_id id from "+r.sql()+
            " where not (product_version_id=any(?::text[]))").collect(java.util.stream.Collectors.joining(" union "));
        String sourceQuery="""
            with recursive roots(id) as (
              select last_successful_version_id from ingestion.dataset_cursors where last_successful_version_id is not null
              union select l.source_dataset_version_id from ingestion.data_product_version_lineage l
                    join ingestion.data_product_versions p on p.id=l.product_version_id
                    where p.status in ('building','published') and not (p.id=any(?::text[]))
              union select i.value from ingestion.product_materialization_runs r,jsonb_each_text(r.input_summary) i
                    where r.status in ('pending','running')
              union select id from ingestion.source_dataset_versions where status='building' or published_at>=?
            """+(factSources.isEmpty()?"":" union "+factSources)+"""
            ), protected(id) as (
              select id from roots union select v.parent_version_id from ingestion.source_dataset_versions v
              join protected p on p.id=v.id where v.parent_version_id is not null
            ) select v.id from ingestion.source_dataset_versions v
              where v.status='published' and v.published_at<? and not exists(select 1 from protected p where p.id=v.id)
              order by v.version_number desc,v.id
            """;
        var params=new java.util.ArrayList<Object>(); params.add(retiringProducts); params.add(Timestamp.from(cutoff));
        relations.forEach(r->params.add(retiringProducts)); params.add(Timestamp.from(cutoff));
        List<String> sources=jdbc.queryForList(sourceQuery,String.class,params.toArray());
        String[] retiringSources=sources.toArray(String[]::new);
        Map<String,Long> factRows=new LinkedHashMap<>();
        for(Relation relation:relations) {
            long count=jdbc.queryForObject("select count(*) from "+relation.sql()+" where product_version_id=any(?::text[])",Long.class,(Object)retiringProducts);
            if(count>0) factRows.put(relation.sql(),count);
        }
        long batches=jdbc.queryForObject("select count(*) from ingestion.source_dataset_batches where source_dataset_version_id=any(?::text[])",Long.class,(Object)retiringSources);
        long bytes=jdbc.queryForObject("select coalesce(sum(octet_length(payload)),0) from ingestion.source_dataset_batches where source_dataset_version_id=any(?::text[])",Long.class,(Object)retiringSources);
        Result result=new Result(apply,cutoff,releases,List.copyOf(sets),List.copyOf(products),List.copyOf(sources),Map.copyOf(factRows),batches,bytes);
        if(!apply) return result;
        for(String id:sets) jdbc.update("update ingestion.dataset_version_sets set status='revoked' where set_id=? and status='frozen'",id);
        for(String id:products) jdbc.update("update ingestion.data_product_versions set status='revoked' where id=? and status='published'",id);
        for(Relation relation:relations) jdbc.update("delete from "+relation.sql()+" where product_version_id=any(?::text[])",(Object)retiringProducts);
        for(String id:sources) jdbc.update("update ingestion.source_dataset_versions set status='revoked' where id=? and status='published'",id);
        jdbc.update("delete from ingestion.source_dataset_batches where source_dataset_version_id=any(?::text[])",(Object)retiringSources);
        jdbc.update("""
            insert into platform.audit_events(id,user_id,organization_id,session_id,event_type,event_result,event_source,
               correlation_id,payload,created_at,retention_until)
            values (?,'system','platform',null,'ingestion.retention.completed','success','ingestion-retention',?,
                    cast(? as jsonb),now(),now()+interval '180 days')
            """,UUID.randomUUID().toString(),UUID.randomUUID().toString(),json.write(result));
        return result;
    }
    private record Relation(String schema,String name) {
        Relation {
            if(!schema.equals("facts") || !name.matches("[a-z_][a-z0-9_]*"))
                throw new IllegalStateException("retention requires a registered facts relation: "+schema+"."+name);
        }
        String sql(){return schema+"."+name;}
    }
}
