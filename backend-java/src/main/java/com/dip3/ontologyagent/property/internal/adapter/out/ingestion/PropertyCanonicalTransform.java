package com.dip3.ontologyagent.property.internal.adapter.out.ingestion;

import com.dip3.ontologyagent.ingestion.api.CanonicalProductTransform;
import com.dip3.ontologyagent.ingestion.api.SourceRow;
import org.springframework.jdbc.core.JdbcTemplate;

import java.math.BigDecimal;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Date;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * Reviewed Property mappings from the controlled ERP staging source to typed
 * platform facts.  The source catalog remains declarative; joins and value
 * semantics live here as reviewed code rather than executable SQL in data.
 */
public final class PropertyCanonicalTransform implements CanonicalProductTransform {
    private final Kind kind;
    private final JdbcTemplate jdbc;

    public PropertyCanonicalTransform(Kind kind, JdbcTemplate jdbc) {
        this.kind = Objects.requireNonNull(kind, "kind must not be null");
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
    }

    @Override
    public String transformRef() {
        return kind.transformRef;
    }

    @Override
    public PreparedProduct prepare(Context context) {
        requireRegistration(context);
        List<List<Object>> rows = switch (kind) {
            case ORGANIZATION -> oneInput(context, "source", kind.datasetKey).stream()
                    .map(row -> organization(context, row)).toList();
            case PROJECT -> oneInput(context, "source", kind.datasetKey).stream()
                    .map(row -> project(context, row)).toList();
            case CHARGE_ITEM -> oneInput(context, "source", kind.datasetKey).stream()
                    .map(row -> chargeItem(context, row)).toList();
            case RECEIVABLE -> receivables(context);
            case PAYMENT -> payments(context);
            case SERVICE_ORDER -> oneInput(context, "source", kind.datasetKey).stream()
                    .map(row -> serviceOrder(context, row)).toList();
        };
        List<List<Object>> ordered = rows.stream()
                .sorted(Comparator.comparing(row -> stableText(row.get(3))))
                .toList();
        return new PreparedProduct(
                "facts://" + kind.relation + "/" + context.productVersionId(),
                ordered.size(), contentHash(ordered),
                () -> ordered.forEach(row -> jdbc.update(kind.insertSql, row.toArray())));
    }

    private void requireRegistration(Context context) {
        if (!kind.productKey.equals(context.product().productKey())
                || !"property".equals(context.product().domainKey())
                || !"facts".equals(context.product().canonicalSchema())
                || !kind.relation.equals(context.product().canonicalRelation())
                || !kind.transformRef.equals(context.product().transformRef())) {
            throw new IllegalArgumentException("Property transform does not match product registration");
        }
    }

    private List<SourceRow> oneInput(Context context, String inputKey, String datasetKey) {
        SourceInput input = context.inputs().get(inputKey);
        if (input == null || context.inputs().size() != 1
                || !datasetKey.equals(input.dataset().datasetKey())) {
            throw new IllegalArgumentException(kind.productKey
                    + " requires exactly one matching source input");
        }
        return input.rows();
    }

    private List<List<Object>> receivables(Context context) {
        SourceInput source = requireInput(context, "source", kind.datasetKey);
        SourceInput chargeItems = requireInput(context, "charge-items", "property-charge-item");
        if (context.inputs().size() != 2) {
            throw new IllegalArgumentException("property-receivable has unexpected inputs");
        }
        Map<String, SourceRow> items = indexBy(chargeItems, "charge_item_id");
        return source.rows().stream().map(row -> {
            Columns sourceColumns = new Columns(source);
            Columns itemColumns = itemColumns(items.get(sourceColumns.nullableText(row, "charge_item_id")), chargeItems);
            return receivable(context, source, sourceColumns, row, itemColumns);
        }).toList();
    }

    private List<List<Object>> payments(Context context) {
        SourceInput source = requireInput(context, "source", kind.datasetKey);
        SourceInput receivables = requireInput(context, "receivables", "property-receivable");
        SourceInput chargeItems = requireInput(context, "charge-items", "property-charge-item");
        if (context.inputs().size() != 3) {
            throw new IllegalArgumentException("property-payment has unexpected inputs");
        }
        Map<String, SourceRow> receivableByDetail = indexBy(receivables, "charge_detail_id");
        Map<String, SourceRow> itemById = indexBy(chargeItems, "charge_item_id");
        Columns sourceColumns = new Columns(source);
        Columns receivableColumns = new Columns(receivables);
        Columns itemColumns = new Columns(chargeItems);
        return source.rows().stream().map(row -> {
            String detailId = sourceColumns.nullableText(row, "charge_detail_id");
            SourceRow receivable = receivableByDetail.get(detailId);
            String itemId = firstText(sourceColumns.nullableText(row, "charge_item_id"),
                    receivable == null ? null
                            : receivableColumns.nullableText(receivable, "charge_item_id"));
            SourceRow item = itemById.get(itemId);
            return payment(context, source, sourceColumns, row,
                    receivable, receivableColumns, item, itemColumns);
        }).toList();
    }

    private List<Object> organization(Context context, SourceRow row) {
        SourceInput input = context.inputs().get("source");
        Columns values = new Columns(input);
        return joined(context, input, row,
                values.longValue(row, "source_id"),
                values.nullableLong(row, "organization_parent_id"),
                values.nullableLong(row, "enterprise_id"),
                values.text(row, "organization_name"),
                values.nullableText(row, "organization_code"),
                values.nullableText(row, "organization_path"),
                deleted(values.nullableInteger(row, "is_deleted")),
                values.nullableTimestamp(row, "create_time"),
                values.nullableTimestamp(row, "update_time"));
    }

    private List<Object> project(Context context, SourceRow row) {
        SourceInput input = context.inputs().get("source");
        Columns values = new Columns(input);
        return joined(context, input, row,
                values.text(row, "precinct_id"),
                firstText(values.nullableText(row, "org_id"),
                        values.nullableLongText(row, "organization_id")),
                values.nullableText(row, "area_id"),
                values.nullableText(row, "enterprise_id"),
                values.text(row, "precinct_name"),
                deleted(values.nullableInteger(row, "is_delete")),
                deleted(values.nullableInteger(row, "delete_flag")),
                values.nullableTimestamp(row, "create_date"),
                values.nullableTimestamp(row, "update_date"),
                values.nullableTimestamp(row, "sync_date"));
    }

    private List<Object> chargeItem(Context context, SourceRow row) {
        SourceInput input = context.inputs().get("source");
        Columns values = new Columns(input);
        return joined(context, input, row,
                values.text(row, "charge_item_id"),
                values.nullableText(row, "organization_id"),
                values.nullableText(row, "enterprise_id"),
                values.nullableText(row, "charge_item_code"),
                values.text(row, "charge_item_name"),
                values.nullableText(row, "charge_item_type"),
                deleted(values.nullableInteger(row, "delete_flag")),
                values.nullableTimestamp(row, "create_date"),
                values.nullableTimestamp(row, "update_date"),
                values.nullableTimestamp(row, "sync_date"));
    }

    private List<Object> receivable(Context context, SourceInput source, Columns values,
                                    SourceRow row, Columns itemValues) {
        String chargeItemId = values.nullableText(row, "charge_item_id");
        String chargeItemType = itemValues == null ? null : itemValues.nullableText(
                itemValues.row, "charge_item_type");
        return joined(context, source, row,
                values.longValue(row, "record_id"),
                values.text(row, "organization_id"),
                values.nullableText(row, "enterprise_id"),
                values.nullableText(row, "precinct_id"),
                values.nullableText(row, "precinct_name"),
                values.nullableText(row, "charge_detail_id"),
                chargeItemId,
                values.nullableText(row, "charge_item_name"),
                chargeItemType,
                values.nullableText(row, "owner_id"),
                decimalOrZero(values.nullableDecimal(row, "actual_charge_sum")),
                decimalOrZero(values.nullableDecimal(row, "arrears")),
                yearMonth(values.nullableInteger(row, "should_account_book")),
                values.nullableTimestamp(row, "calc_end_date"),
                deleted(values.nullableInteger(row, "is_delete")),
                checked(values.nullableText(row, "is_check")),
                values.nullableTimestamp(row, "create_date"),
                values.nullableTimestamp(row, "update_date"),
                values.nullableTimestamp(row, "sync_date"));
    }

    private List<Object> payment(Context context, SourceInput source, Columns values,
                                 SourceRow row, SourceRow receivable, Columns receivableValues,
                                 SourceRow chargeItem, Columns itemValues) {
        String detailId = values.nullableText(row, "charge_detail_id");
        String itemId = firstText(values.nullableText(row, "charge_item_id"),
                receivable == null ? null : receivableValues.nullableText(receivable, "charge_item_id"));
        String projectId = firstText(values.nullableText(row, "precinct_id"),
                receivable == null ? null : receivableValues.nullableText(receivable, "precinct_id"));
        String projectName = firstText(values.nullableText(row, "precinct_name"),
                receivable == null ? null : receivableValues.nullableText(receivable, "precinct_name"));
        String chargeItemName = firstText(values.nullableText(row, "charge_item_name"),
                receivable == null ? null : receivableValues.nullableText(receivable, "charge_item_name"));
        if (chargeItem == null && itemId != null) {
            throw new IllegalArgumentException("Property payment references an unknown charge item: " + itemId);
        }
        String chargeItemType = chargeItem == null ? null
                : itemValues.nullableText(chargeItem, "charge_item_type");
        return joined(context, source, row,
                values.longValue(row, "record_id"),
                values.text(row, "organization_id"),
                values.nullableText(row, "enterprise_id"),
                projectId,
                projectName,
                detailId,
                itemId,
                chargeItemName,
                chargeItemType,
                values.nullableText(row, "owner_id"),
                decimalOrZero(values.nullableDecimal(row, "charge_paid")),
                paymentDate(values.nullableTimestamp(row, "operator_date"),
                        values.nullableInteger(row, "paid_year"),
                        values.nullableInteger(row, "paid_month"),
                        values.nullableInteger(row, "paid_day")),
                receivable == null ? null
                        : yearMonth(receivableValues.nullableInteger(receivable, "should_account_book")),
                receivable == null ? null
                        : receivableValues.nullableTimestamp(receivable, "calc_end_date"),
                values.nullableText(row, "refund_status"),
                values.nullableInteger(row, "precinct_collection_type"),
                values.nullableText(row, "subject_code"),
                deleted(values.nullableInteger(row, "is_delete")),
                entered(values.nullableText(row, "is_enter_account")),
                receivable == null ? null
                        : deleted(receivableValues.nullableInteger(receivable, "is_delete")),
                receivable == null ? null
                        : checked(receivableValues.nullableText(receivable, "is_check")),
                values.nullableTimestamp(row, "update_date"),
                values.nullableTimestamp(row, "sync_date"));
    }

    private List<Object> serviceOrder(Context context, SourceRow row) {
        SourceInput input = context.inputs().get("source");
        Columns values = new Columns(input);
        Integer satisfactionEvaluation = values.nullableInteger(row, "satisfaction_eval");
        return joined(context, input, row,
                values.text(row, "services_no"),
                values.text(row, "organization_id"),
                values.nullableText(row, "precinct_id"),
                values.nullableText(row, "precinct_name"),
                values.nullableText(row, "service_type_name"),
                values.nullableText(row, "service_style_name"),
                values.nullableText(row, "service_status"),
                values.nullableText(row, "service_status_name"),
                values.nullableTimestamp(row, "create_date_time"),
                values.nullableTimestamp(row, "accept_date"),
                values.nullableTimestamp(row, "accomplish_date"),
                values.nullableInteger(row, "satisfaction"),
                satisfactionEvaluation != null,
                deleted(values.nullableInteger(row, "is_delete")),
                values.nullableTimestamp(row, "update_date_time"),
                values.nullableTimestamp(row, "sync_date"));
    }

    private static SourceInput requireInput(Context context, String inputKey, String datasetKey) {
        SourceInput input = context.inputs().get(inputKey);
        if (input == null || !datasetKey.equals(input.dataset().datasetKey())) {
            throw new IllegalArgumentException("missing " + inputKey + " input for " + datasetKey);
        }
        return input;
    }

    private static Map<String, SourceRow> indexBy(SourceInput input, String column) {
        Columns values = new Columns(input);
        Map<String, SourceRow> result = new LinkedHashMap<>();
        for (SourceRow row : input.rows()) {
            String key = values.nullableText(row, column);
            if (key != null && result.put(key, row) != null) {
                throw new IllegalArgumentException("duplicate join key " + column + ": " + key);
            }
        }
        return result;
    }

    private static Columns itemColumns(SourceRow row, SourceInput input) {
        return row == null ? null : new Columns(input, row);
    }

    private static List<Object> joined(Context context, SourceInput input, SourceRow row,
                                       Object... values) {
        List<Object> result = new ArrayList<>(3 + values.length);
        result.add(context.productVersionId());
        result.add(input.dataset().datasetKey());
        result.add(input.sourceVersionId());
        result.addAll(Arrays.asList(values));
        return Collections.unmodifiableList(result);
    }

    private static boolean deleted(Integer value) {
        return value != null && value != 0;
    }

    private static boolean entered(String value) {
        return value != null && ("1".equals(value) || "true".equalsIgnoreCase(value)
                || "yes".equalsIgnoreCase(value));
    }

    private static boolean checked(String value) {
        return "审核通过".equals(value);
    }

    private static BigDecimal decimalOrZero(BigDecimal value) {
        return value == null ? BigDecimal.ZERO : value;
    }

    private static Date yearMonth(Integer value) {
        if (value == null) return null;
        int year = value / 100;
        int month = value % 100;
        try {
            return Date.valueOf(LocalDate.of(year, month, 1));
        } catch (RuntimeException error) {
            throw new IllegalArgumentException("Property accounting period must be YYYYMM: " + value,
                    error);
        }
    }

    private static Timestamp paymentDate(Timestamp operatorDate, Integer year,
                                         Integer month, Integer day) {
        if (operatorDate != null) return operatorDate;
        if (year == null && month == null && day == null) return null;
        if (year == null || month == null || day == null) {
            throw new IllegalArgumentException("Property payment date components must be complete");
        }
        try {
            return Timestamp.from(LocalDate.of(year, month, day)
                    .atStartOfDay(ZoneOffset.UTC).toInstant());
        } catch (RuntimeException error) {
            throw new IllegalArgumentException("Property payment date is invalid", error);
        }
    }

    private static String firstText(String preferred, String fallback) {
        return preferred == null || preferred.isBlank() ? fallback : preferred;
    }

    private static String contentHash(List<List<Object>> rows) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            for (List<Object> row : rows) {
                for (Object value : row.subList(3, row.size())) {
                    if (value == null) {
                        digest.update((byte) 0);
                        continue;
                    }
                    digest.update((byte) 1);
                    byte[] bytes = stableText(value).getBytes(StandardCharsets.UTF_8);
                    digest.update(ByteBuffer.allocate(Integer.BYTES).putInt(bytes.length).array());
                    digest.update(bytes);
                }
            }
            return HexFormat.of().formatHex(digest.digest());
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException("SHA-256 is unavailable", error);
        }
    }

    private static String stableText(Object value) {
        if (value instanceof Timestamp timestamp) return timestamp.toInstant().toString();
        if (value instanceof Date date) return date.toLocalDate().toString();
        if (value instanceof OffsetDateTime offset) return offset.toInstant().toString();
        if (value instanceof Instant instant) return instant.toString();
        return value.toString();
    }

    private static String digest(String algorithm, byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance(algorithm).digest(bytes));
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException(algorithm + " is unavailable", error);
        }
    }

    public enum Kind {
        ORGANIZATION("property-organization", "property_organization", "property-organization-v1", """
                insert into facts.property_organization
                  (product_version_id,source_dataset_key,source_dataset_version_id,organization_id,
                   parent_organization_id,enterprise_id,organization_name,organization_code,
                   organization_path,is_deleted,created_at,updated_at)
                values (?,?,?,?,?,?,?,?,?,?,?,?)
                """),
        PROJECT("property-project", "property_project", "property-project-v1", """
                insert into facts.property_project
                  (product_version_id,source_dataset_key,source_dataset_version_id,project_id,
                   organization_id,area_id,enterprise_id,project_name,is_deleted,delete_flag,
                   created_at,updated_at,synced_at)
                values (?,?,?,?,?,?,?,?,?,?,?,?,?)
                """),
        CHARGE_ITEM("property-charge-item", "property_charge_item", "property-charge-item-v1", """
                insert into facts.property_charge_item
                  (product_version_id,source_dataset_key,source_dataset_version_id,charge_item_id,
                   organization_id,enterprise_id,charge_item_code,charge_item_name,charge_item_type,
                   is_deleted,created_at,updated_at,synced_at)
                values (?,?,?,?,?,?,?,?,?,?,?,?,?)
                """),
        RECEIVABLE("property-receivable", "property_receivable", "property-receivable-v1", """
                insert into facts.property_receivable
                  (product_version_id,source_dataset_key,source_dataset_version_id,record_id,
                   organization_id,enterprise_id,project_id,project_name,charge_detail_id,
                   charge_item_id,charge_item_name,charge_item_type,owner_id,receivable_amount,
                   arrears_amount,receivable_accounting_period,billing_cycle_end_date,is_deleted,
                   is_checked,created_at,updated_at,synced_at)
                values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """),
        PAYMENT("property-payment", "property_payment", "property-payment-v1", """
                insert into facts.property_payment
                  (product_version_id,source_dataset_key,source_dataset_version_id,record_id,
                   organization_id,enterprise_id,project_id,project_name,charge_detail_id,
                   charge_item_id,charge_item_name,charge_item_type,owner_id,paid_amount,
                   payment_date,receivable_accounting_period,billing_cycle_end_date,refund_status,
                   collection_type,subject_code,is_deleted,is_entered_account,is_charge_deleted,
                   is_charge_checked,updated_at,synced_at)
                values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """),
        SERVICE_ORDER("property-service-order", "property_service_order", "property-service-order-v1", """
                insert into facts.property_service_order
                  (product_version_id,source_dataset_key,source_dataset_version_id,service_order_id,
                   organization_id,project_id,project_name,service_type_name,service_style_name,
                   service_status,service_status_name,created_at,accepted_at,completed_at,
                   satisfaction,satisfaction_evaluated,is_deleted,updated_at,synced_at)
                values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """);

        private final String productKey;
        private final String relation;
        private final String transformRef;
        private final String datasetKey;
        private final String insertSql;

        Kind(String productKey, String relation, String transformRef, String insertSql) {
            this.productKey = productKey;
            this.relation = relation;
            this.transformRef = transformRef;
            this.datasetKey = productKey;
            this.insertSql = insertSql;
        }
    }

    private static final class Columns {
        private final Map<String, Integer> indexes;
        private final SourceRow row;

        private Columns(SourceInput input) {
            this(input, null);
        }

        private Columns(SourceInput input, SourceRow row) {
            this.row = row;
            Map<String, Integer> result = new LinkedHashMap<>();
            for (int index = 0; index < input.dataset().columnContract().size(); index++) {
                result.put(input.dataset().columnContract().get(index).name(), index);
            }
            this.indexes = Map.copyOf(result);
        }

        private Object value(SourceRow sourceRow, String column) {
            Integer index = indexes.get(column);
            if (index == null || sourceRow.values().size() != indexes.size()) {
                throw new IllegalArgumentException("Property source row does not match column contract");
            }
            return sourceRow.values().get(index);
        }

        private String text(SourceRow sourceRow, String column) {
            String value = nullableText(sourceRow, column);
            if (value == null || value.isBlank()) {
                throw new IllegalArgumentException("Property " + column + " must not be blank");
            }
            return value;
        }

        private String nullableText(SourceRow sourceRow, String column) {
            Object value = value(sourceRow, column);
            return value == null ? null : value.toString();
        }

        private long longValue(SourceRow sourceRow, String column) {
            Long value = nullableLong(sourceRow, column);
            if (value == null) throw new IllegalArgumentException("Property " + column + " is required");
            return value;
        }

        private Long nullableLong(SourceRow sourceRow, String column) {
            Object value = value(sourceRow, column);
            return value == null ? null : ((Number) value).longValue();
        }

        private String nullableLongText(SourceRow sourceRow, String column) {
            Long value = nullableLong(sourceRow, column);
            return value == null ? null : value.toString();
        }

        private Integer nullableInteger(SourceRow sourceRow, String column) {
            Object value = value(sourceRow, column);
            return value == null ? null : ((Number) value).intValue();
        }

        private BigDecimal nullableDecimal(SourceRow sourceRow, String column) {
            Object value = value(sourceRow, column);
            if (value == null) return null;
            return value instanceof BigDecimal decimal ? decimal : new BigDecimal(value.toString());
        }

        private Timestamp nullableTimestamp(SourceRow sourceRow, String column) {
            Object value = value(sourceRow, column);
            if (value == null) return null;
            if (value instanceof Timestamp timestamp) return timestamp;
            if (value instanceof Instant instant) return Timestamp.from(instant);
            if (value instanceof OffsetDateTime offset) return Timestamp.from(offset.toInstant());
            if (value instanceof LocalDateTime local) return Timestamp.valueOf(local);
            throw new IllegalArgumentException("Property " + column + " must be a timestamp");
        }

        private Date nullableDate(SourceRow sourceRow, String column) {
            Object value = value(sourceRow, column);
            if (value == null) return null;
            if (value instanceof Date date) return date;
            if (value instanceof LocalDate local) return Date.valueOf(local);
            throw new IllegalArgumentException("Property " + column + " must be a date");
        }
    }
}
