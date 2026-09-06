package com.dip3.ontologyagent.ingestion.internal.adapter.out.persistence;

import com.dip3.ontologyagent.ingestion.api.DatasetVersionSet;
import com.dip3.ontologyagent.ingestion.api.DatasetVersionSetRegistry;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.support.JsonCodec;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/** PostgreSQL lookup for complete frozen manifests; partial product mixes are never returned. */
@Repository
public class DatasetVersionSetPostgresAdapter implements DatasetVersionSetRegistry {
    private final JdbcTemplate jdbc;
    private final JsonCodec json;

    public DatasetVersionSetPostgresAdapter(JdbcTemplate jdbc, JsonCodec json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    /**
     * Selects the newest captured canonical snapshot that is already frozen.
     *
     * <p>{@code captured_at} is the source-observation cutoff carried into
     * canonical fact reads; {@code frozen_at} is only the publication/audit
     * time. A delayed freeze must not make an older observation supersede a
     * newer one.</p>
     */
    @Override
    public Optional<DatasetVersionSet> latestFrozen(Set<String> requiredProductKeys) {
        List<String> required = requiredKeys(requiredProductKeys);
        List<String> ids = jdbc.queryForList("""
                select version_set.set_id
                from ingestion.dataset_version_sets version_set
                join ingestion.dataset_version_set_items item on item.set_id=version_set.set_id
                join ingestion.data_product_versions product_version
                  on product_version.product_key=item.product_key
                 and product_version.id=item.product_version_id
                 and product_version.status='published'
                where version_set.status='frozen'
                group by version_set.set_id,version_set.captured_at
                having jsonb_agg(item.product_key order by item.product_key)=cast(? as jsonb)
                order by version_set.captured_at desc,version_set.set_id desc
                limit 1
                """, String.class, json.write(required));
        return ids.isEmpty() ? Optional.empty()
                : Optional.of(requireFrozen(ids.getFirst(), requiredProductKeys));
    }

    @Override
    public DatasetVersionSet requireFrozen(String setId, Set<String> requiredProductKeys) {
        if (setId == null || !setId.matches("[A-Za-z0-9][A-Za-z0-9._-]*")) {
            throw new BackendException("DATASET_VERSION_SET_INVALID",
                    "执行绑定的数据版本集合 ID 无效。");
        }
        List<String> required = requiredKeys(requiredProductKeys);
        List<SetRow> rows = jdbc.query("""
                select version_set.set_id,version_set.status,version_set.captured_at,
                       version_set.frozen_at,version_set.created_at,version_set.created_by,
                       item.product_key,item.product_version_id,product_version.status as product_status
                from ingestion.dataset_version_sets version_set
                left join ingestion.dataset_version_set_items item
                  on item.set_id=version_set.set_id
                left join ingestion.data_product_versions product_version
                  on product_version.product_key=item.product_key
                 and product_version.id=item.product_version_id
                where version_set.set_id=?
                order by item.product_key
                """, (result, row) -> new SetRow(
                result.getString("set_id"), result.getString("status"),
                result.getTimestamp("captured_at").toInstant(),
                result.getTimestamp("frozen_at") == null ? null
                        : result.getTimestamp("frozen_at").toInstant(),
                result.getTimestamp("created_at").toInstant(), result.getString("created_by"),
                result.getString("product_key"), result.getString("product_version_id"),
                result.getString("product_status")), setId);
        if (rows.isEmpty()) {
            throw new BackendException("DATASET_VERSION_SET_NOT_FOUND",
                    "执行绑定的数据版本集合不存在：" + setId);
        }
        SetRow first = rows.getFirst();
        if (!"frozen".equals(first.status())) {
            throw new BackendException("DATASET_VERSION_SET_NOT_FROZEN",
                    "执行只能绑定已冻结的数据版本集合：" + setId);
        }
        Map<String, String> versions = new LinkedHashMap<>();
        for (SetRow row : rows) {
            if (row.productKey() == null || !"published".equals(row.productStatus())) {
                throw new BackendException("DATASET_VERSION_SET_PRODUCT_UNAVAILABLE",
                        "数据版本集合包含未发布或已撤销的数据产品：" + setId);
            }
            versions.put(row.productKey(), row.productVersionId());
        }
        if (!versions.keySet().equals(Set.copyOf(required))) {
            throw new BackendException("DATASET_VERSION_SET_INCOMPLETE",
                    "数据版本集合与能力所需的数据产品不一致：" + setId);
        }
        return new DatasetVersionSet(first.setId(), versions, first.capturedAt(),
                DatasetVersionSet.Status.FROZEN, first.frozenAt(), first.createdAt(),
                first.createdBy());
    }

    private static List<String> requiredKeys(Set<String> values) {
        if (values == null || values.isEmpty() || values.stream().anyMatch(value ->
                value == null || !value.matches("[a-z][a-z0-9_-]*"))) {
            throw new IllegalArgumentException("requiredProductKeys must contain catalog keys");
        }
        return values.stream().sorted().toList();
    }

    private record SetRow(String setId, String status, Instant capturedAt, Instant frozenAt,
                          Instant createdAt, String createdBy, String productKey,
                          String productVersionId, String productStatus) {}
}
