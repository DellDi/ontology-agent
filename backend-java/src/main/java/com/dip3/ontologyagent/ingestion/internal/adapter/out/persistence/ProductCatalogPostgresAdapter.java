package com.dip3.ontologyagent.ingestion.internal.adapter.out.persistence;

import com.dip3.ontologyagent.ingestion.api.DataProductDefinition;
import com.dip3.ontologyagent.ingestion.api.DataProductInput;
import com.dip3.ontologyagent.ingestion.api.DatasetDefinition;
import com.dip3.ontologyagent.ingestion.internal.application.ProductCatalogPort;
import com.dip3.ontologyagent.ingestion.internal.application.SourceCatalogPort;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.support.JsonCodec;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Pattern;

/** PostgreSQL reader for canonical product registrations in the platform catalog. */
@Repository
public class ProductCatalogPostgresAdapter implements ProductCatalogPort {
    private static final Pattern CATALOG_KEY = Pattern.compile("[a-z][a-z0-9_-]*");

    private final JdbcTemplate jdbc;
    private final JsonCodec json;
    private final SourceCatalogPort sourceCatalog;

    public ProductCatalogPostgresAdapter(JdbcTemplate jdbc, JsonCodec json,
                                         SourceCatalogPort sourceCatalog) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
        this.json = Objects.requireNonNull(json, "json must not be null");
        this.sourceCatalog = Objects.requireNonNull(sourceCatalog, "sourceCatalog must not be null");
    }

    @Override
    public ProductCatalog loadActiveProduct(String productKey) {
        if (productKey == null || !CATALOG_KEY.matcher(productKey).matches()) {
            throw new IllegalArgumentException("productKey must be a restricted catalog key");
        }
        List<ProductRow> rows = jdbc.query("""
                select p.product_key,p.domain_key,p.canonical_schema,p.canonical_relation,
                       p.transform_ref,p.schema_version,p.freshness_policy,
                       p.status as product_status,p.metadata as product_metadata,
                       i.input_key,i.dataset_key,i.ordinal,i.is_required,
                       i.mapping_spec,i.metadata as input_metadata,d.source_key
                from ingestion.data_product_definitions p
                left join ingestion.data_product_inputs i on i.product_key=p.product_key
                left join ingestion.dataset_definitions d on d.dataset_key=i.dataset_key
                where p.product_key=?
                order by i.ordinal,i.input_key
                """, this::productRow, productKey);
        if (rows.isEmpty()) {
            throw error("INGESTION_PRODUCT_NOT_FOUND", "product 未注册：" + productKey, null);
        }
        ProductRow first = rows.getFirst();
        DataProductDefinition.Status productStatus = enumValue(
                DataProductDefinition.Status.class, first.productStatus(), "product status");
        if (productStatus != DataProductDefinition.Status.ACTIVE) {
            throw error("INGESTION_PRODUCT_NOT_ACTIVE", "product 已禁用：" + productKey, null);
        }

        List<DataProductInput> inputs = new ArrayList<>();
        Set<String> sourceKeys = new LinkedHashSet<>();
        for (ProductRow row : rows) {
            if (row.inputKey() == null || row.datasetKey() == null || row.sourceKey() == null) {
                continue;
            }
            inputs.add(new DataProductInput(row.inputKey(), row.datasetKey(), row.ordinal(),
                    row.required(), json.map(row.mappingSpec()), json.map(row.inputMetadata())));
            sourceKeys.add(row.sourceKey());
        }
        if (inputs.isEmpty()) {
            throw error("INGESTION_PRODUCT_INPUTS_MISSING",
                    "product 没有已注册 input：" + productKey, null);
        }
        DataProductDefinition product;
        try {
            product = new DataProductDefinition(first.productKey(), first.domainKey(),
                    first.canonicalSchema(), first.canonicalRelation(), first.transformRef(),
                    first.schemaVersion(), json.map(first.freshnessPolicy()), productStatus,
                    inputs, json.map(first.productMetadata()));
        } catch (RuntimeException invalid) {
            throw error("INGESTION_CATALOG_INVALID", "product 定义无效：" + productKey, invalid);
        }

        Map<String, DatasetDefinition> datasetsByKey = new LinkedHashMap<>();
        for (String sourceKey : sourceKeys) {
            sourceCatalog.loadActiveSource(sourceKey).datasets().forEach(
                    dataset -> datasetsByKey.put(dataset.datasetKey(), dataset));
        }
        Map<String, DatasetDefinition> inputDatasets = new LinkedHashMap<>();
        for (DataProductInput input : inputs) {
            DatasetDefinition dataset = datasetsByKey.get(input.datasetKey());
            if (dataset == null) {
                throw error("INGESTION_PRODUCT_INPUT_INVALID",
                        "product input dataset 未激活：" + input.datasetKey(), null);
            }
            inputDatasets.put(input.inputKey(), dataset);
        }
        return new ProductCatalog(product, inputDatasets);
    }

    private ProductRow productRow(ResultSet rs, int rowNumber) throws SQLException {
        return new ProductRow(rs.getString("product_key"), rs.getString("domain_key"),
                rs.getString("canonical_schema"), rs.getString("canonical_relation"),
                rs.getString("transform_ref"), rs.getInt("schema_version"),
                rs.getObject("freshness_policy"), rs.getString("product_status"),
                rs.getObject("product_metadata"), rs.getString("input_key"),
                rs.getString("dataset_key"), rs.getInt("ordinal"),
                rs.getBoolean("is_required"), rs.getObject("mapping_spec"),
                rs.getObject("input_metadata"), rs.getString("source_key"));
    }

    private static <E extends Enum<E>> E enumValue(Class<E> type, String value, String field) {
        try {
            return Enum.valueOf(type, value.toUpperCase(Locale.ROOT));
        } catch (RuntimeException invalid) {
            throw new IllegalArgumentException(field + " is invalid: " + value, invalid);
        }
    }

    private static BackendException error(String code, String message, Throwable cause) {
        return cause == null ? new BackendException(code, message)
                : new BackendException(code, message, cause);
    }

    private record ProductRow(String productKey, String domainKey, String canonicalSchema,
                              String canonicalRelation, String transformRef, int schemaVersion,
                              Object freshnessPolicy, String productStatus, Object productMetadata,
                              String inputKey, String datasetKey, int ordinal, boolean required,
                              Object mappingSpec, Object inputMetadata, String sourceKey) {}
}
