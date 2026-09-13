package com.dip3.ontologyagent.ingestion.internal.adapter.out.persistence;

import com.dip3.ontologyagent.ingestion.internal.application.IngestionManagementPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Repository
public class IngestionManagementPostgresAdapter implements IngestionManagementPort {
    private static final int RUN_LIMIT = 50;
    private static final int RELEASE_LIMIT = 20;
    private final JdbcTemplate jdbc;

    public IngestionManagementPostgresAdapter(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public Overview overview() {
        var sources = jdbc.query("""
                select source_key, connector_type, status from ingestion.source_definitions order by source_key
                """, (rs, n) -> new Source(rs.getString(1), rs.getString(2), rs.getString(3)));
        var datasets = jdbc.query("""
                select dataset_key, source_key, status, schema_version
                from ingestion.dataset_definitions order by source_key, dataset_key
                """, (rs, n) -> new Dataset(rs.getString(1), rs.getString(2), rs.getString(3), rs.getInt(4)));
        var products = jdbc.query("""
                select p.product_key, p.domain_key, p.status,
                       array(select i.dataset_key from ingestion.data_product_inputs i
                             where i.product_key=p.product_key order by i.ordinal) as datasets
                from ingestion.data_product_definitions p order by p.domain_key, p.product_key
                """, (rs, n) -> new Product(rs.getString(1), rs.getString(2), rs.getString(3),
                List.copyOf(Arrays.asList((String[]) rs.getArray(4).getArray()))));
        // Explicit projections exclude error_detail and snapshot_context: connector errors may
        // contain SQL, hostnames or credentials. Codes + run/correlation IDs locate server logs.
        var runs = jdbc.query("""
                select * from (
                  select id, 'source' as kind, source_key as target_key, mode, status,
                         error_code, correlation_id, created_at, started_at, finished_at
                  from ingestion.source_ingestion_runs
                  union all
                  select id, 'product' as kind, product_key as target_key, mode, status,
                         error_code, correlation_id, created_at, started_at, finished_at
                  from ingestion.product_materialization_runs
                ) runs order by created_at desc, kind, id desc limit ?
                """, (rs, n) -> new Run(rs.getString("id"), rs.getString("kind"), rs.getString("target_key"),
                rs.getString("mode"), rs.getString("status"), rs.getString("error_code"),
                rs.getString("correlation_id"), instant(rs, "created_at"), instant(rs, "started_at"),
                instant(rs, "finished_at")), RUN_LIMIT);
        var releases = jdbc.query("""
                select set_id, status, captured_at from ingestion.dataset_version_sets
                order by captured_at desc, set_id desc limit ?
                """, (rs, n) -> new Release(rs.getString(1), rs.getString(2), instant(rs, "captured_at"), List.of()),
                RELEASE_LIMIT);
        Map<String, Map<String, ReleaseProduct>> members = new LinkedHashMap<>();
        // Restrict lineage to the same bounded release window without N+1 queries.
        jdbc.query("""
                with recent as (
                  select set_id from ingestion.dataset_version_sets
                  order by captured_at desc, set_id desc limit ?
                )
                select i.set_id, i.product_key, v.id, v.status, v.row_count, v.materialization_run_id,
                       l.source_dataset_key, l.source_dataset_version_id, s.source_ingestion_run_id
                from recent r join ingestion.dataset_version_set_items i on i.set_id=r.set_id
                join ingestion.data_product_versions v on v.id=i.product_version_id
                left join ingestion.data_product_version_lineage l on l.product_version_id=v.id
                left join ingestion.source_dataset_versions s on s.id=l.source_dataset_version_id
                order by i.set_id, i.product_key, l.input_key
                """, (org.springframework.jdbc.core.RowCallbackHandler) rs -> {
            Map<String, ReleaseProduct> productsByKey = members.computeIfAbsent(rs.getString("set_id"),
                    ignored -> new LinkedHashMap<>());
            String key = rs.getString("product_key");
            ReleaseProduct product = productsByKey.get(key);
            if (product == null) {
                product = new ReleaseProduct(key, rs.getString("id"), rs.getString("status"),
                        rs.getLong("row_count"), rs.getString("materialization_run_id"), new ArrayList<>());
                productsByKey.put(key, product);
            }
            if (rs.getString("source_dataset_key") != null) {
                product.sources().add(new SourceVersion(rs.getString("source_dataset_key"),
                        rs.getString("source_dataset_version_id"), rs.getString("source_ingestion_run_id")));
            }
        }, RELEASE_LIMIT);
        return new Overview("platform", RUN_LIMIT, RELEASE_LIMIT, sources, datasets, products, runs,
                releases.stream().map(release -> new Release(release.id(), release.status(), release.capturedAt(),
                        List.copyOf(members.getOrDefault(release.id(), Map.of()).values()))).toList());
    }

    private static Instant instant(ResultSet rs, String column) throws SQLException {
        var value = rs.getTimestamp(column);
        return value == null ? null : value.toInstant();
    }
}
