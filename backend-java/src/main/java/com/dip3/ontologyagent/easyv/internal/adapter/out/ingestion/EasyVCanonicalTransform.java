package com.dip3.ontologyagent.easyv.internal.adapter.out.ingestion;

import com.dip3.ontologyagent.ingestion.api.CanonicalProductTransform;
import com.dip3.ontologyagent.ingestion.api.SourceRow;
import com.dip3.ontologyagent.support.JsonCodec;
import org.springframework.jdbc.core.JdbcTemplate;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/** Reviewed EasyV mappings from governed source rows into one typed facts relation. */
public final class EasyVCanonicalTransform implements CanonicalProductTransform {
    public static final ZoneId BUSINESS_ZONE = ZoneId.of("Asia/Shanghai");

    private final Kind kind;
    private final JdbcTemplate jdbc;
    private final JsonCodec json;

    public EasyVCanonicalTransform(Kind kind, JdbcTemplate jdbc, JsonCodec json) {
        this.kind = Objects.requireNonNull(kind, "kind must not be null");
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
        this.json = Objects.requireNonNull(json, "json must not be null");
    }

    @Override
    public String transformRef() {
        return kind.transformRef;
    }

    @Override
    public PreparedProduct prepare(Context context) {
        requireRegistration(context);
        SourceInput input = context.inputs().get("source");
        if (input == null || context.inputs().size() != 1
                || !kind.datasetKey.equals(input.dataset().datasetKey())) {
            throw new IllegalArgumentException(kind.productKey
                    + " requires exactly one matching source input");
        }

        Columns columns = new Columns(input);
        List<List<Object>> rows = input.rows().stream()
                .map(row -> map(context.productVersionId(), input.sourceVersionId(), columns, row))
                .sorted(Comparator.comparing(row -> (Comparable<Object>) row.get(3)))
                .toList();
        String contentHash = contentHash(rows);
        return new PreparedProduct(
                "facts://" + kind.relation + "/" + context.productVersionId(),
                rows.size(), contentHash,
                () -> rows.forEach(row -> jdbc.update(kind.insertSql, row.toArray())));
    }

    private void requireRegistration(Context context) {
        if (!kind.productKey.equals(context.product().productKey())
                || !"easyv".equals(context.product().domainKey())
                || !"facts".equals(context.product().canonicalSchema())
                || !kind.relation.equals(context.product().canonicalRelation())
                || !kind.transformRef.equals(context.product().transformRef())) {
            throw new IllegalArgumentException("EasyV transform does not match product registration");
        }
    }

    private List<Object> map(String productVersionId, String sourceVersionId,
                             Columns values, SourceRow row) {
        List<Object> prefix = List.of(productVersionId, kind.datasetKey, sourceVersionId);
        return switch (kind) {
            case APPLICATION -> joined(prefix,
                    values.longValue(row, "id"), values.text(row, "app_id"),
                    values.nullableText(row, "generation_task_id"),
                    values.longValue(row, "user_id"), values.longValue(row, "space_id"),
                    values.longValue(row, "team_id"), values.text(row, "scope_type"),
                    values.instant(row, "create_time"), values.instant(row, "update_time"),
                    deleted(values.nullableText(row, "is_delete")));
            case PROTOTYPE -> joined(prefix,
                    values.longValue(row, "id"), values.text(row, "app_id"),
                    values.instant(row, "create_time"), values.instant(row, "update_time"));
            case PIPELINE -> joined(prefix,
                    values.longValue(row, "id"), values.text(row, "task_id"),
                    values.text(row, "step_name"), values.text(row, "branch"),
                    values.text(row, "status"), values.nullableLong(row, "duration_ms"),
                    values.instant(row, "create_time"));
            case FORGE -> joined(prefix,
                    values.uuid(row, "id"), values.text(row, "task_id"),
                    values.text(row, "app_id"),
                    values.text(row, "status").toLowerCase(Locale.ROOT),
                    md5(values.value(row, "failure_reason")),
                    values.nullableInstant(row, "started_at"),
                    values.nullableInstant(row, "finished_at"),
                    values.instant(row, "create_time"), values.instant(row, "update_time"));
            case FEEDBACK -> {
                int result = values.integer(row, "execute_result");
                if (result != 0 && result != 1) {
                    throw new IllegalArgumentException("EasyV execute_result must be 0 or 1");
                }
                Integer rating = values.nullableInteger(row, "rating");
                if (rating != null && (rating < 1 || rating > 5)) {
                    throw new IllegalArgumentException("EasyV rating must be between 1 and 5");
                }
                yield joined(prefix,
                        values.longValue(row, "id"), values.longValue(row, "space_id"),
                        values.longValue(row, "user_id"), values.instant(row, "operate_time"),
                        values.text(row, "ai_action_type"), result, rating,
                        values.nullableText(row, "app_id"),
                        values.nullableText(row, "task_id"),
                        values.nullableBoolean(row, "is_save_as_edit"));
            }
        };
    }

    private static boolean deleted(String value) {
        if (value == null || "0".equals(value)) return false;
        if ("1".equals(value)) return true;
        throw new IllegalArgumentException("EasyV is_delete must be null, 0, or 1");
    }

    private String md5(Object value) {
        String canonical = value == null ? "" : json.write(value);
        return digest("MD5", canonical.getBytes(StandardCharsets.UTF_8));
    }

    private static String contentHash(List<List<Object>> rows) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            for (List<Object> row : rows) {
                // Product/source version ids are lineage, not canonical content.
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
        if (value instanceof OffsetDateTime offset) return offset.toInstant().toString();
        return value.toString();
    }

    private static String digest(String algorithm, byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance(algorithm).digest(bytes));
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException(algorithm + " is unavailable", error);
        }
    }

    private static List<Object> joined(List<Object> prefix, Object... values) {
        List<Object> result = new ArrayList<>(prefix.size() + values.length);
        result.addAll(prefix);
        result.addAll(Arrays.asList(values));
        return Collections.unmodifiableList(result);
    }

    public enum Kind {
        APPLICATION("easyv-ai-application", "easyv_ai_application", "easyv-ai-application-v1", """
                insert into facts.easyv_ai_application
                  (product_version_id,source_dataset_key,source_dataset_version_id,source_id,
                   app_id,generation_task_id,user_id,space_id,team_id,scope_type,created_at,
                   updated_at,is_deleted) values (?,?,?,?,?,?,?,?,?,?,?,?,?)
                """),
        PROTOTYPE("easyv-prototype-task", "easyv_prototype_task", "easyv-prototype-task-v1", """
                insert into facts.easyv_prototype_task
                  (product_version_id,source_dataset_key,source_dataset_version_id,source_id,
                   app_id,created_at,updated_at) values (?,?,?,?,?,?,?)
                """),
        PIPELINE("easyv-pipeline-node", "easyv_pipeline_node", "easyv-pipeline-node-v1", """
                insert into facts.easyv_pipeline_node
                  (product_version_id,source_dataset_key,source_dataset_version_id,source_id,
                   task_id,step_name,branch,status,duration_ms,created_at)
                values (?,?,?,?,?,?,?,?,?,?)
                """),
        FORGE("easyv-forge-task", "easyv_forge_generation_task", "easyv-forge-task-v1", """
                insert into facts.easyv_forge_generation_task
                  (product_version_id,source_dataset_key,source_dataset_version_id,source_id,
                   task_id,app_id,status,failure_reason_hash,started_at,finished_at,created_at,updated_at)
                values (?,?,?,?,?,?,?,?,?,?,?,?)
                """),
        FEEDBACK("easyv-generation-feedback", "easyv_generation_feedback",
                "easyv-generation-feedback-v1", """
                insert into facts.easyv_generation_feedback
                  (product_version_id,source_dataset_key,source_dataset_version_id,source_id,
                   space_id,user_id,operated_at,ai_action_type,execute_result,rating,app_id,task_id,
                   is_save_as_edit) values (?,?,?,?,?,?,?,?,?,?,?,?,?)
                """);

        private final String productKey;
        private final String datasetKey;
        private final String relation;
        private final String transformRef;
        private final String insertSql;

        Kind(String key, String relation, String transformRef, String insertSql) {
            this.productKey = key;
            this.datasetKey = key;
            this.relation = relation;
            this.transformRef = transformRef;
            this.insertSql = insertSql;
        }
    }

    private static final class Columns {
        private final Map<String, Integer> indexes;

        private Columns(SourceInput input) {
            Map<String, Integer> result = new LinkedHashMap<>();
            for (int index = 0; index < input.dataset().columnContract().size(); index++) {
                result.put(input.dataset().columnContract().get(index).name(), index);
            }
            this.indexes = Map.copyOf(result);
        }

        private Object value(SourceRow row, String column) {
            Integer index = indexes.get(column);
            if (index == null || row.values().size() != indexes.size()) {
                throw new IllegalArgumentException("EasyV source row does not match column contract");
            }
            return row.values().get(index);
        }

        private String text(SourceRow row, String column) {
            String value = nullableText(row, column);
            if (value == null || value.isBlank()) {
                throw new IllegalArgumentException("EasyV " + column + " must not be blank");
            }
            return value;
        }

        private String nullableText(SourceRow row, String column) {
            Object value = value(row, column);
            if (value == null) return null;
            if (!(value instanceof String text)) {
                throw new IllegalArgumentException("EasyV " + column + " must be text");
            }
            return text;
        }

        private long longValue(SourceRow row, String column) {
            Long value = nullableLong(row, column);
            if (value == null) throw new IllegalArgumentException("EasyV " + column + " is required");
            return value;
        }

        private Long nullableLong(SourceRow row, String column) {
            Object value = value(row, column);
            return value == null ? null : ((Number) value).longValue();
        }

        private int integer(SourceRow row, String column) {
            Integer value = nullableInteger(row, column);
            if (value == null) throw new IllegalArgumentException("EasyV " + column + " is required");
            return value;
        }

        private Integer nullableInteger(SourceRow row, String column) {
            Object value = value(row, column);
            return value == null ? null : ((Number) value).intValue();
        }

        private UUID uuid(SourceRow row, String column) {
            Object value = value(row, column);
            if (!(value instanceof UUID uuid)) {
                throw new IllegalArgumentException("EasyV " + column + " must be UUID");
            }
            return uuid;
        }

        private Timestamp instant(SourceRow row, String column) {
            Timestamp value = nullableInstant(row, column);
            if (value == null) throw new IllegalArgumentException("EasyV " + column + " is required");
            return value;
        }

        private Timestamp nullableInstant(SourceRow row, String column) {
            Object value = value(row, column);
            if (value == null) return null;
            Instant instant;
            if (value instanceof Instant sourceInstant) {
                instant = sourceInstant;
            } else if (value instanceof LocalDateTime local) {
                instant = local.atZone(BUSINESS_ZONE).toInstant();
            } else if (value instanceof Timestamp timestamp) {
                instant = timestamp.toInstant();
            } else {
                throw new IllegalArgumentException("EasyV " + column + " must be a timestamp");
            }
            return Timestamp.from(instant);
        }

        private Boolean nullableBoolean(SourceRow row, String column) {
            Object value = value(row, column);
            if (value == null || value instanceof Boolean) return (Boolean) value;
            throw new IllegalArgumentException("EasyV " + column + " must be boolean");
        }
    }
}
