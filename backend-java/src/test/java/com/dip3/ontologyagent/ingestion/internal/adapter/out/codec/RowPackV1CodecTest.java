package com.dip3.ontologyagent.ingestion.internal.adapter.out.codec;

import com.dip3.ontologyagent.ingestion.api.DatasetDefinition;
import com.dip3.ontologyagent.ingestion.api.SourceRow;
import com.dip3.ontologyagent.ingestion.internal.application.SourceBatchCodec;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.nio.ByteBuffer;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RowPackV1CodecTest {
    private static final DatasetDefinition DEFINITION = definition();
    private static final OffsetDateTime OFFSET_TIME = OffsetDateTime.parse("2026-09-04T12:34:56.123456789+08:00");
    private static final Instant INSTANT = Instant.parse("2026-09-04T04:34:56.987654321Z");

    private final SourceBatchCodec codec = new RowPackV1Codec();

    @Test
    void exposesTheStableCodecNameAndRoundTripsEveryColumnType() {
        SourceRow row = row();

        byte[] payload = codec.encode(DEFINITION, List.of(row));
        List<SourceRow> decoded = codec.decode(DEFINITION, payload);

        assertEquals("row-pack-v1", codec.codec());
        assertEquals(1, decoded.size());
        List<Object> values = decoded.getFirst().values();
        assertEquals(12, values.get(0));
        assertEquals("你好", values.get(1));
        assertEquals(8_000_000_000L, values.get(2));
        assertEquals(new BigDecimal("123.4500"), values.get(3));
        assertEquals(Boolean.TRUE, values.get(4));
        assertEquals(LocalDate.of(2026, 9, 4), values.get(5));
        assertEquals(LocalDateTime.of(2026, 9, 4, 12, 34, 56, 123456789), values.get(6));
        assertEquals(OFFSET_TIME.toInstant(), values.get(7));
        assertEquals(INSTANT, values.get(8));
        assertEquals(jsonValue(), values.get(9));
        assertEquals(UUID.fromString("c7d7f6da-6aa3-4a6d-8b10-b6d0a9ce65e2"), values.get(10));
        assertEquals(null, values.get(11));
        assertInstanceOf(Map.class, values.get(9));
    }

    @Test
    void canonicalizesJsonObjectFieldOrderDeterministically() {
        Map<String, Object> first = new LinkedHashMap<>();
        first.put("z", 1);
        first.put("a", Map.of("y", true, "b", List.of(2, 3)));
        Map<String, Object> second = new LinkedHashMap<>();
        second.put("a", new LinkedHashMap<>(Map.of("b", List.of(2, 3), "y", true)));
        second.put("z", 1);

        SourceRow rowA = sourceRow(12, "你好", 8_000_000_000L,
                new BigDecimal("123.4500"), true, LocalDate.of(2026, 9, 4),
                LocalDateTime.of(2026, 9, 4, 12, 34, 56, 123456789), OFFSET_TIME,
                INSTANT, first, UUID.fromString("c7d7f6da-6aa3-4a6d-8b10-b6d0a9ce65e2"), null);
        SourceRow rowB = sourceRow(12, "你好", 8_000_000_000L,
                new BigDecimal("123.4500"), true, LocalDate.of(2026, 9, 4),
                LocalDateTime.of(2026, 9, 4, 12, 34, 56, 123456789), OFFSET_TIME,
                INSTANT, second, UUID.fromString("c7d7f6da-6aa3-4a6d-8b10-b6d0a9ce65e2"), null);

        assertTrue(Arrays.equals(codec.encode(DEFINITION, List.of(rowA)),
                codec.encode(DEFINITION, List.of(rowB))));
    }

    @Test
    void rejectsNullsAndValuesThatDoNotMatchTheContract() {
        List<Object> nonNullableNull = new ArrayList<>(row().values());
        nonNullableNull.set(0, null);
        assertThrows(IllegalArgumentException.class,
                () -> codec.encode(DEFINITION, List.of(new SourceRow(nonNullableNull))));

        List<Object> wrongType = new ArrayList<>(row().values());
        wrongType.set(4, "true");
        assertThrows(IllegalArgumentException.class,
                () -> codec.encode(DEFINITION, List.of(new SourceRow(wrongType))));

        assertThrows(IllegalArgumentException.class,
                () -> codec.encode(DEFINITION, List.of(new SourceRow(List.of(1)))));
        assertThrows(IllegalArgumentException.class,
                () -> codec.decode(DEFINITION, null));
    }

    @Test
    void rejectsMoreThanTenThousandRows() {
        List<SourceRow> rows = new ArrayList<>(RowPackV1Codec.MAX_ROWS + 1);
        for (int index = 0; index <= RowPackV1Codec.MAX_ROWS; index++) {
            rows.add(sourceRow(12, "你好", 8_000_000_000L, new BigDecimal("1"),
                    true, LocalDate.of(2026, 9, 4), LocalDateTime.of(2026, 9, 4, 0, 0),
                    OFFSET_TIME, INSTANT, jsonValue(),
                    UUID.fromString("c7d7f6da-6aa3-4a6d-8b10-b6d0a9ce65e2"), null));
        }
        assertThrows(IllegalArgumentException.class, () -> codec.encode(DEFINITION, rows));
    }

    @Test
    void rejectsCorruptHeaderSchemaContractMarkersAndTrailingBytes() {
        byte[] payload = codec.encode(DEFINITION, List.of(row()));

        byte[] badMagic = payload.clone();
        badMagic[0] ^= 1;
        assertThrows(IllegalArgumentException.class, () -> codec.decode(DEFINITION, badMagic));

        byte[] badVersion = payload.clone();
        badVersion[6] = 2;
        assertThrows(IllegalArgumentException.class, () -> codec.decode(DEFINITION, badVersion));

        byte[] badSchema = payload.clone();
        ByteBuffer.wrap(badSchema, 7, Integer.BYTES).putInt(99);
        assertThrows(IllegalArgumentException.class, () -> codec.decode(DEFINITION, badSchema));

        byte[] badColumns = payload.clone();
        ByteBuffer.wrap(badColumns, 11, Integer.BYTES).putInt(1);
        assertThrows(IllegalArgumentException.class, () -> codec.decode(DEFINITION, badColumns));

        byte[] badRows = payload.clone();
        ByteBuffer.wrap(badRows, 15, Integer.BYTES).putInt(RowPackV1Codec.MAX_ROWS + 1);
        assertThrows(IllegalArgumentException.class, () -> codec.decode(DEFINITION, badRows));

        byte[] badFingerprint = payload.clone();
        badFingerprint[19] ^= 1;
        assertThrows(IllegalArgumentException.class, () -> codec.decode(DEFINITION, badFingerprint));

        assertThrows(IllegalArgumentException.class,
                () -> codec.decode(DEFINITION, Arrays.copyOf(payload, payload.length - 1)));
        assertThrows(IllegalArgumentException.class,
                () -> codec.decode(DEFINITION, Arrays.copyOf(payload, payload.length + 1)));

        byte[] badMarker = payload.clone();
        badMarker[51] = 2;
        assertThrows(IllegalArgumentException.class, () -> codec.decode(DEFINITION, badMarker));

        DatasetDefinition changed = new DatasetDefinition(DEFINITION.datasetKey(), DEFINITION.sourceKey(),
                DEFINITION.sourceNamespace(), DEFINITION.sourceRelation(),
                        replaceColumn(DEFINITION.columnContract(), 1,
                        new DatasetDefinition.SourceColumn("label", DatasetDefinition.ColumnType.STRING,
                                true)), DEFINITION.primaryKeyColumns(), DEFINITION.cursorSpec(),
                DEFINITION.deletePolicy(), DEFINITION.deleteSpec(), DEFINITION.schemaVersion(),
                DEFINITION.status(), DEFINITION.metadata());
        assertThrows(IllegalArgumentException.class, () -> codec.decode(changed, payload));
    }

    private static DatasetDefinition definition() {
        List<DatasetDefinition.SourceColumn> columns = List.of(
                new DatasetDefinition.SourceColumn("id", DatasetDefinition.ColumnType.INTEGER, false),
                new DatasetDefinition.SourceColumn("label", DatasetDefinition.ColumnType.STRING, false),
                new DatasetDefinition.SourceColumn("big_value", DatasetDefinition.ColumnType.LONG, false),
                new DatasetDefinition.SourceColumn("amount", DatasetDefinition.ColumnType.DECIMAL, false),
                new DatasetDefinition.SourceColumn("enabled", DatasetDefinition.ColumnType.BOOLEAN, false),
                new DatasetDefinition.SourceColumn("day", DatasetDefinition.ColumnType.DATE, false),
                new DatasetDefinition.SourceColumn("local_time",
                        DatasetDefinition.ColumnType.TIMESTAMP_WITHOUT_TIME_ZONE, false,
                        DatasetDefinition.TimeSemantics.timestampWithoutTimeZone(
                                "local_time", ZoneId.of("Asia/Shanghai"))),
                new DatasetDefinition.SourceColumn("zoned_time", DatasetDefinition.ColumnType.TIMESTAMPTZ,
                        false, DatasetDefinition.TimeSemantics.instant("zoned_time")),
                new DatasetDefinition.SourceColumn("instant", DatasetDefinition.ColumnType.INSTANT,
                        false, DatasetDefinition.TimeSemantics.instant("instant")),
                new DatasetDefinition.SourceColumn("attributes", DatasetDefinition.ColumnType.JSON, false),
                new DatasetDefinition.SourceColumn("event_id", DatasetDefinition.ColumnType.UUID, false),
                new DatasetDefinition.SourceColumn("optional", DatasetDefinition.ColumnType.STRING, true));
        return new DatasetDefinition("dataset-a", "source-a", "source_data", "events", columns,
                List.of("id"), new DatasetDefinition.CursorSpec(
                DatasetDefinition.CursorSpec.Strategy.SNAPSHOT, null, null),
                DatasetDefinition.DeletePolicy.NONE, DatasetDefinition.DeletionSpec.none(), 7,
                DatasetDefinition.Status.ACTIVE, Map.of());
    }

    private static SourceRow row() {
        return sourceRow(12, "你好", 8_000_000_000L, new BigDecimal("123.4500"), true,
                LocalDate.of(2026, 9, 4), LocalDateTime.of(2026, 9, 4, 12, 34, 56, 123456789),
                OFFSET_TIME, INSTANT, jsonValue(),
                UUID.fromString("c7d7f6da-6aa3-4a6d-8b10-b6d0a9ce65e2"), null);
    }

    private static SourceRow sourceRow(Object... values) {
        return new SourceRow(Arrays.asList(values));
    }

    private static Map<String, Object> jsonValue() {
        Map<String, Object> nested = new LinkedHashMap<>();
        nested.put("b", List.of(2, 3));
        nested.put("y", true);
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("z", 1);
        value.put("a", nested);
        return value;
    }

    private static List<DatasetDefinition.SourceColumn> replaceColumn(
            List<DatasetDefinition.SourceColumn> columns, int index,
            DatasetDefinition.SourceColumn replacement) {
        List<DatasetDefinition.SourceColumn> copy = new ArrayList<>(columns);
        copy.set(index, replacement);
        return copy;
    }
}
