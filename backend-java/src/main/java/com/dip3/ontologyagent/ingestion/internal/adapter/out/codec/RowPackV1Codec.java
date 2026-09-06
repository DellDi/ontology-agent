package com.dip3.ontologyagent.ingestion.internal.adapter.out.codec;

import com.dip3.ontologyagent.ingestion.api.DatasetDefinition;
import com.dip3.ontologyagent.ingestion.api.SourceRow;
import com.dip3.ontologyagent.ingestion.internal.application.SourceBatchCodec;
import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.EOFException;
import java.io.IOException;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

/** Fixed, uncompressed binary codec for the durable {@code row-pack-v1} artifact. */
public final class RowPackV1Codec implements SourceBatchCodec {
    public static final String CODEC = "row-pack-v1";
    public static final int MAX_ROWS = 10_000;

    private static final byte[] MAGIC = "DIP3RP".getBytes(StandardCharsets.US_ASCII);
    private static final int FORMAT_VERSION = 1;
    private static final int SHA256_BYTES = 32;
    private static final int HEADER_BYTES = MAGIC.length + 1 + Integer.BYTES * 3 + SHA256_BYTES;
    private static final int MAX_COLUMNS = 1_024;
    private static final int MAX_FIELD_BYTES = 64 * 1024 * 1024;

    private final ObjectMapper mapper;

    public RowPackV1Codec() {
        this(defaultMapper());
    }

    /** Keep Jackson configuration injectable without making the port framework-bound. */
    public RowPackV1Codec(ObjectMapper mapper) {
        this.mapper = Objects.requireNonNull(mapper, "mapper must not be null");
    }

    @Override
    public String codec() {
        return CODEC;
    }

    /** Encode rows in the exact order and types declared by the dataset contract. */
    @Override
    public byte[] encode(DatasetDefinition definition, List<SourceRow> rows) {
        requireDefinition(definition);
        if (rows == null) {
            throw new CodecException("rows must not be null");
        }
        if (rows.size() > MAX_ROWS) {
            throw new CodecException("row count exceeds row-pack-v1 limit of " + MAX_ROWS);
        }
        List<DatasetDefinition.SourceColumn> columns = definition.columnContract();
        try {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream(Math.max(HEADER_BYTES, 256));
            try (DataOutputStream output = new DataOutputStream(bytes)) {
                writeHeader(output, definition, rows.size());
                for (int rowIndex = 0; rowIndex < rows.size(); rowIndex++) {
                    SourceRow row = rows.get(rowIndex);
                    if (row == null) {
                        throw new CodecException("row " + rowIndex + " must not be null");
                    }
                    if (row.values().size() != columns.size()) {
                        throw new CodecException("row " + rowIndex + " has " + row.values().size()
                                + " values; expected " + columns.size());
                    }
                    for (int columnIndex = 0; columnIndex < columns.size(); columnIndex++) {
                        DatasetDefinition.SourceColumn column = columns.get(columnIndex);
                        Object value = row.values().get(columnIndex);
                        if (value == null) {
                            if (!column.nullable()) {
                                throw valueFailure(rowIndex, columnIndex, column,
                                        "non-nullable column received SQL null");
                            }
                            output.writeByte(0);
                        } else {
                            output.writeByte(1);
                            writeValue(output, normalize(value, column, rowIndex, columnIndex),
                                    column.type(), rowIndex, columnIndex, column);
                        }
                    }
                }
                output.flush();
            }
            return bytes.toByteArray();
        } catch (IOException error) {
            throw new CodecException("row-pack-v1 encoding failed", error);
        }
    }

    /** Decode a payload against the caller-supplied dataset contract. */
    @Override
    public List<SourceRow> decode(DatasetDefinition definition, byte[] payload) {
        requireDefinition(definition);
        if (payload == null || payload.length == 0) {
            throw new CodecException("row-pack-v1 payload must not be empty");
        }
        if (payload.length < HEADER_BYTES) {
            throw new CodecException("row-pack-v1 payload is shorter than its header");
        }
        try (DataInputStream input = new DataInputStream(new ByteArrayInputStream(payload))) {
            int rowCount = readAndValidateHeader(input, definition);
            return decodeRows(input, definition, rowCount);
        } catch (CodecException error) {
            throw error;
        } catch (EOFException error) {
            throw new CodecException("row-pack-v1 payload is truncated", error);
        } catch (IOException | RuntimeException error) {
            throw new CodecException("row-pack-v1 payload is invalid", error);
        }
    }

    private List<SourceRow> decodeRows(DataInputStream input, DatasetDefinition definition,
                                       int rowCount) throws IOException {
        List<DatasetDefinition.SourceColumn> columns = definition.columnContract();
        List<SourceRow> rows = new ArrayList<>(rowCount);
        for (int rowIndex = 0; rowIndex < rowCount; rowIndex++) {
            List<Object> values = new ArrayList<>(columns.size());
            for (int columnIndex = 0; columnIndex < columns.size(); columnIndex++) {
                DatasetDefinition.SourceColumn column = columns.get(columnIndex);
                int marker = input.readUnsignedByte();
                if (marker == 0) {
                    if (!column.nullable()) {
                        throw valueFailure(rowIndex, columnIndex, column,
                                "payload contains SQL null for non-nullable column");
                    }
                    values.add(null);
                } else if (marker == 1) {
                    values.add(readValue(input, column.type(), rowIndex, columnIndex, column));
                } else {
                    throw valueFailure(rowIndex, columnIndex, column,
                            "payload contains unknown null marker " + marker);
                }
            }
            rows.add(new SourceRow(values));
        }
        if (input.available() != 0) {
            throw new CodecException("row-pack-v1 payload contains trailing bytes");
        }
        return List.copyOf(rows);
    }

    private void writeHeader(DataOutputStream output, DatasetDefinition definition,
                             int rowCount) throws IOException {
        output.write(MAGIC);
        output.writeByte(FORMAT_VERSION);
        output.writeInt(definition.schemaVersion());
        output.writeInt(definition.columnContract().size());
        output.writeInt(rowCount);
        output.write(contractFingerprint(definition));
    }

    private int readAndValidateHeader(DataInputStream input,
                                      DatasetDefinition definition) throws IOException {
        byte[] magic = input.readNBytes(MAGIC.length);
        if (!Arrays.equals(MAGIC, magic)) {
            throw new CodecException("row-pack-v1 magic does not match");
        }
        int version = input.readUnsignedByte();
        if (version != FORMAT_VERSION) {
            throw new CodecException("unsupported row-pack format version " + version);
        }
        int schemaVersion = input.readInt();
        if (schemaVersion != definition.schemaVersion()) {
            throw new CodecException("row-pack schema version " + schemaVersion
                    + " does not match dataset schema version " + definition.schemaVersion());
        }
        int columnCount = input.readInt();
        if (columnCount != definition.columnContract().size()) {
            throw new CodecException("row-pack column count " + columnCount
                    + " does not match dataset column contract");
        }
        if (columnCount <= 0 || columnCount > MAX_COLUMNS) {
            throw new CodecException("row-pack column count is outside the supported range");
        }
        int rowCount = readNonNegativeBounded(input, "row count", MAX_ROWS);
        byte[] expectedFingerprint = contractFingerprint(definition);
        byte[] actualFingerprint = input.readNBytes(SHA256_BYTES);
        if (!MessageDigest.isEqual(expectedFingerprint, actualFingerprint)) {
            throw new CodecException("row-pack column contract fingerprint does not match dataset definition");
        }
        return rowCount;
    }

    private static int readNonNegativeBounded(DataInputStream input, String field,
                                              int maximum) throws IOException {
        int value = input.readInt();
        if (value < 0 || value > maximum) {
            throw new CodecException(field + " is outside the supported range");
        }
        return value;
    }

    private Object normalize(Object value, DatasetDefinition.SourceColumn column,
                             int rowIndex, int columnIndex) {
        try {
            return switch (column.type()) {
                case STRING -> value instanceof CharSequence
                        ? value.toString() : rejectType(value, column);
                case INTEGER -> integral(value, Integer.MIN_VALUE, Integer.MAX_VALUE,
                        column, rowIndex, columnIndex).intValue();
                case LONG -> integral(value, Long.MIN_VALUE, Long.MAX_VALUE,
                        column, rowIndex, columnIndex).longValue();
                case DECIMAL -> decimal(value, column, rowIndex, columnIndex);
                case BOOLEAN -> value instanceof Boolean ? value : rejectType(value, column);
                case DATE -> date(value, column, rowIndex, columnIndex);
                case TIMESTAMP_WITHOUT_TIME_ZONE -> localDateTime(value, column,
                        rowIndex, columnIndex);
                case TIMESTAMPTZ, INSTANT -> instant(value, column, rowIndex, columnIndex);
                case JSON, UUID -> value;
            };
        } catch (CodecException error) {
            throw error;
        } catch (RuntimeException error) {
            throw valueFailure(rowIndex, columnIndex, column,
                    "value cannot be encoded as " + column.type(), error);
        }
    }

    private static Object rejectType(Object value, DatasetDefinition.SourceColumn column) {
        throw new CodecException("column " + column.name() + " requires " + column.type()
                + " but received " + value.getClass().getName());
    }

    private static BigInteger integral(Object value, long minimum, long maximum,
                                      DatasetDefinition.SourceColumn column,
                                      int rowIndex, int columnIndex) {
        BigInteger integer;
        if (value instanceof Byte || value instanceof Short || value instanceof Integer
                || value instanceof Long || value instanceof BigInteger) {
            integer = new BigInteger(value.toString());
        } else {
            throw valueFailure(rowIndex, columnIndex, column,
                    "integral value required; received " + value.getClass().getName());
        }
        if (integer.compareTo(BigInteger.valueOf(minimum)) < 0
                || integer.compareTo(BigInteger.valueOf(maximum)) > 0) {
            throw valueFailure(rowIndex, columnIndex, column,
                    "integral value is outside the " + column.type() + " range");
        }
        return integer;
    }

    private static BigDecimal decimal(Object value, DatasetDefinition.SourceColumn column,
                                      int rowIndex, int columnIndex) {
        if (value instanceof BigDecimal decimal) return decimal;
        if (value instanceof BigInteger integer) return new BigDecimal(integer);
        if (value instanceof Byte || value instanceof Short || value instanceof Integer
                || value instanceof Long) {
            return new BigDecimal(value.toString());
        }
        throw valueFailure(rowIndex, columnIndex, column,
                "BigDecimal or integral value required; received "
                        + value.getClass().getName());
    }

    private static LocalDate date(Object value, DatasetDefinition.SourceColumn column,
                                  int rowIndex, int columnIndex) {
        if (value instanceof LocalDate date) return date;
        if (value instanceof java.sql.Date date) return date.toLocalDate();
        throw valueFailure(rowIndex, columnIndex, column,
                "LocalDate or java.sql.Date required; received " + value.getClass().getName());
    }

    private static LocalDateTime localDateTime(Object value,
                                               DatasetDefinition.SourceColumn column,
                                               int rowIndex, int columnIndex) {
        if (value instanceof LocalDateTime dateTime) return dateTime;
        if (value instanceof Timestamp timestamp) return timestamp.toLocalDateTime();
        throw valueFailure(rowIndex, columnIndex, column,
                "LocalDateTime or java.sql.Timestamp required; received "
                        + value.getClass().getName());
    }

    private static Instant instant(Object value, DatasetDefinition.SourceColumn column,
                                  int rowIndex, int columnIndex) {
        if (value instanceof Instant instant) return instant;
        if (value instanceof OffsetDateTime dateTime) return dateTime.toInstant();
        if (value instanceof Timestamp timestamp) return timestamp.toInstant();
        throw valueFailure(rowIndex, columnIndex, column,
                "Instant, OffsetDateTime or java.sql.Timestamp required; received "
                        + value.getClass().getName());
    }

    private void writeValue(DataOutputStream output, Object value,
                            DatasetDefinition.ColumnType type, int rowIndex,
                            int columnIndex, DatasetDefinition.SourceColumn column)
            throws IOException {
        switch (type) {
            case STRING -> writeUtf8(output, (String) value, rowIndex, columnIndex, column);
            case INTEGER -> output.writeInt((Integer) value);
            case LONG -> output.writeLong((Long) value);
            case DECIMAL -> writeUtf8(output, ((BigDecimal) value).toString(),
                    rowIndex, columnIndex, column);
            case BOOLEAN -> output.writeBoolean((Boolean) value);
            case DATE -> output.writeLong(((LocalDate) value).toEpochDay());
            case TIMESTAMP_WITHOUT_TIME_ZONE -> {
                LocalDateTime local = (LocalDateTime) value;
                output.writeLong(local.toEpochSecond(ZoneOffset.UTC));
                output.writeInt(local.getNano());
            }
            case TIMESTAMPTZ, INSTANT -> {
                Instant instant = (Instant) value;
                output.writeLong(instant.getEpochSecond());
                output.writeInt(instant.getNano());
            }
            case JSON -> writeUtf8(output, canonicalJson(value, rowIndex, columnIndex, column),
                    rowIndex, columnIndex, column);
            case UUID -> {
                if (!(value instanceof UUID uuid)) {
                    throw valueFailure(rowIndex, columnIndex, column,
                            "UUID required; received " + value.getClass().getName());
                }
                output.writeLong(uuid.getMostSignificantBits());
                output.writeLong(uuid.getLeastSignificantBits());
            }
        }
    }

    private Object readValue(DataInputStream input, DatasetDefinition.ColumnType type,
                             int rowIndex, int columnIndex,
                             DatasetDefinition.SourceColumn column) throws IOException {
        try {
            return switch (type) {
                case STRING -> readUtf8(input, rowIndex, columnIndex, column);
                case INTEGER -> input.readInt();
                case LONG -> input.readLong();
                case DECIMAL -> new BigDecimal(readUtf8(input, rowIndex, columnIndex, column));
                case BOOLEAN -> readBoolean(input, rowIndex, columnIndex, column);
                case DATE -> LocalDate.ofEpochDay(input.readLong());
                case TIMESTAMP_WITHOUT_TIME_ZONE -> LocalDateTime.ofEpochSecond(
                        input.readLong(), input.readInt(), ZoneOffset.UTC);
                case TIMESTAMPTZ, INSTANT -> Instant.ofEpochSecond(
                        input.readLong(), input.readInt());
                case JSON -> decodeJson(readUtf8(input, rowIndex, columnIndex, column),
                        rowIndex, columnIndex, column);
                case UUID -> new UUID(input.readLong(), input.readLong());
            };
        } catch (CodecException error) {
            throw error;
        } catch (RuntimeException error) {
            throw valueFailure(rowIndex, columnIndex, column,
                    "payload value cannot be decoded as " + type, error);
        }
    }

    private byte[] canonicalJson(Object value, int rowIndex, int columnIndex,
                                 DatasetDefinition.SourceColumn column) {
        try {
            JsonNode node;
            if (value instanceof JsonNode jsonNode) {
                node = jsonNode;
            } else if (value instanceof CharSequence text) {
                node = parseJson(text.toString());
            } else if ("org.postgresql.util.PGobject".equals(value.getClass().getName())) {
                node = parseJson(value.toString());
            } else {
                node = mapper.valueToTree(value);
            }
            if (node == null) {
                throw new CodecException("JSON value resolved to null node");
            }
            return mapper.writeValueAsBytes(sortJson(node));
        } catch (CodecException error) {
            throw error;
        } catch (JsonProcessingException | IllegalArgumentException error) {
            throw valueFailure(rowIndex, columnIndex, column,
                    "value is not valid JSON", error);
        }
    }

    private JsonNode parseJson(String text) throws JsonProcessingException {
        try (JsonParser parser = mapper.getFactory().createParser(text)) {
            JsonNode node = mapper.readTree(parser);
            if (node == null || parser.nextToken() != null) {
                throw new CodecException("JSON text must contain exactly one value");
            }
            return node;
        } catch (IOException error) {
            throw new JsonProcessingException("invalid JSON", error) {};
        }
    }

    private Object decodeJson(String json, int rowIndex, int columnIndex,
                              DatasetDefinition.SourceColumn column) {
        try {
            JsonNode node = parseJson(json);
            if (node.isNull()) {
                return JsonNodeFactory.instance.nullNode();
            }
            return mapper.convertValue(node, Object.class);
        } catch (RuntimeException | JsonProcessingException error) {
            throw valueFailure(rowIndex, columnIndex, column,
                    "payload contains invalid JSON", error);
        }
    }

    private static JsonNode sortJson(JsonNode node) {
        if (node.isObject()) {
            ObjectNode sorted = JsonNodeFactory.instance.objectNode();
            List<String> names = new ArrayList<>();
            node.fieldNames().forEachRemaining(names::add);
            names.sort(Comparator.naturalOrder());
            for (String name : names) {
                sorted.set(name, sortJson(node.get(name)));
            }
            return sorted;
        }
        if (node.isArray()) {
            ArrayNode sorted = JsonNodeFactory.instance.arrayNode();
            node.forEach(child -> sorted.add(sortJson(child)));
            return sorted;
        }
        return node;
    }

    private static boolean readBoolean(DataInputStream input, int rowIndex, int columnIndex,
                                       DatasetDefinition.SourceColumn column) throws IOException {
        int value = input.readUnsignedByte();
        if (value != 0 && value != 1) {
            throw valueFailure(rowIndex, columnIndex, column,
                    "payload contains invalid BOOLEAN value " + value);
        }
        return value == 1;
    }

    private static void writeUtf8(DataOutputStream output, String value, int rowIndex,
                                 int columnIndex, DatasetDefinition.SourceColumn column)
            throws IOException {
        writeUtf8(output, value.getBytes(StandardCharsets.UTF_8), rowIndex, columnIndex, column);
    }

    private static void writeUtf8(DataOutputStream output, byte[] value, int rowIndex,
                                 int columnIndex, DatasetDefinition.SourceColumn column)
            throws IOException {
        if (value.length > MAX_FIELD_BYTES) {
            throw valueFailure(rowIndex, columnIndex, column,
                    "encoded value exceeds row-pack-v1 field limit");
        }
        output.writeInt(value.length);
        output.write(value);
    }

    private static String readUtf8(DataInputStream input, int rowIndex, int columnIndex,
                                  DatasetDefinition.SourceColumn column) throws IOException {
        int length = input.readInt();
        if (length < 0 || length > MAX_FIELD_BYTES || length > input.available()) {
            throw valueFailure(rowIndex, columnIndex, column,
                    "payload string length is invalid: " + length);
        }
        byte[] value = input.readNBytes(length);
        try {
            return StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(value)).toString();
        } catch (CharacterCodingException error) {
            throw valueFailure(rowIndex, columnIndex, column,
                    "payload contains malformed UTF-8", error);
        }
    }

    private static byte[] contractFingerprint(DatasetDefinition definition) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            update(digest, "schemaVersion=" + definition.schemaVersion() + '\n');
            for (DatasetDefinition.SourceColumn column : definition.columnContract()) {
                update(digest, column.name() + '\u0000' + column.type() + '\u0000'
                        + column.nullable() + '\u0000');
                DatasetDefinition.TimeSemantics time = column.timeSemantics();
                if (time == null) {
                    update(digest, "-\n");
                } else {
                    update(digest, time.column() + '\u0000' + time.kind() + '\u0000'
                            + (time.zoneId() == null ? "-" : time.zoneId().getId()) + '\n');
                }
            }
            return digest.digest();
        } catch (NoSuchAlgorithmException error) {
            throw new AssertionError("JVM must provide SHA-256", error);
        }
    }

    private static void update(MessageDigest digest, String value) {
        digest.update(value.getBytes(StandardCharsets.UTF_8));
    }

    private static ObjectMapper defaultMapper() {
        return new ObjectMapper().findAndRegisterModules()
                .enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS);
    }

    private static void requireDefinition(DatasetDefinition definition) {
        if (definition == null) {
            throw new CodecException("definition must not be null");
        }
        if (definition.columnContract().size() > MAX_COLUMNS) {
            throw new CodecException("column count exceeds row-pack-v1 limit");
        }
    }

    private static CodecException valueFailure(int rowIndex, int columnIndex,
                                               DatasetDefinition.SourceColumn column,
                                               String detail) {
        return new CodecException("row-pack-v1 row " + rowIndex + ", column "
                + columnIndex + " (" + column.name() + ", " + column.type() + "): " + detail);
    }

    private static CodecException valueFailure(int rowIndex, int columnIndex,
                                               DatasetDefinition.SourceColumn column,
                                               String detail, Throwable cause) {
        return new CodecException("row-pack-v1 row " + rowIndex + ", column "
                + columnIndex + " (" + column.name() + ", " + column.type() + "): " + detail,
                cause);
    }

    /** Runtime error for contract and payload violations; callers must not silently recover. */
    public static final class CodecException extends IllegalArgumentException {
        public CodecException(String message) {
            super(message);
        }

        public CodecException(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
