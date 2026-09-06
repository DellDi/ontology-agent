package com.dip3.ontologyagent.ingestion.api;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.HashSet;
import java.util.regex.Pattern;

/** Package-private validation helpers shared by the public ingestion records. */
final class ValueChecks {
    private static final Pattern CATALOG_KEY = Pattern.compile("[a-z][a-z0-9_-]*");
    private static final Pattern OPAQUE_ID = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._-]*");
    private static final Pattern IDENTIFIER = Pattern.compile("[a-z_][a-z0-9_]*");

    private ValueChecks() {}

    static String text(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value;
    }

    /** Validate a catalog key, never a URL, SQL fragment, or secret. */
    static String catalogKey(String value, String field) {
        text(value, field);
        if (!CATALOG_KEY.matcher(value).matches()) {
            throw new IllegalArgumentException(field + " must be a restricted catalog key");
        }
        return value;
    }

    /** A non-URL/non-SQL opaque identifier, including UUIDs beginning with a digit. */
    static String opaqueId(String value, String field) {
        text(value, field);
        if (!OPAQUE_ID.matcher(value).matches()) {
            throw new IllegalArgumentException(field + " must be a restricted opaque id");
        }
        return value;
    }

    /** Validate one SQL identifier component, never a relation expression. */
    static String identifier(String value, String field) {
        text(value, field);
        if (!IDENTIFIER.matcher(value).matches()) {
            throw new IllegalArgumentException(field + " must be a single identifier");
        }
        return value;
    }

    static String nullableIdentifier(String value, String field) {
        return value == null ? null : identifier(value, field);
    }

    static <T> List<T> list(List<T> values, String field) {
        if (values == null || values.stream().anyMatch(value -> value == null)) {
            throw new IllegalArgumentException(field + " must not contain null");
        }
        return List.copyOf(values);
    }

    static Map<String, Object> objectMap(Map<String, Object> values, String field) {
        if (values == null) throw new IllegalArgumentException(field + " must not be null");
        Map<String, Object> copy = new LinkedHashMap<>();
        for (Map.Entry<String, Object> entry : values.entrySet()) {
            text(entry.getKey(), field + ".key");
            if (entry.getValue() == null) {
                throw new IllegalArgumentException(field + " must not contain null values");
            }
            copy.put(entry.getKey(), entry.getValue());
        }
        return Collections.unmodifiableMap(copy);
    }

    static Map<String, Long> nonNegativeCounts(Map<String, Long> values, String field) {
        if (values == null) throw new IllegalArgumentException(field + " must not be null");
        Map<String, Long> copy = new LinkedHashMap<>();
        for (Map.Entry<String, Long> entry : values.entrySet()) {
            text(entry.getKey(), field + ".key");
            if (entry.getValue() == null || entry.getValue() < 0) {
                throw new IllegalArgumentException(field + " values must not be negative");
            }
            copy.put(entry.getKey(), entry.getValue());
        }
        return Collections.unmodifiableMap(copy);
    }

    static Map<String, String> catalogToOpaqueMap(Map<String, String> values, String field) {
        if (values == null) throw new IllegalArgumentException(field + " must not be null");
        Map<String, String> copy = new LinkedHashMap<>();
        for (Map.Entry<String, String> entry : values.entrySet()) {
            catalogKey(entry.getKey(), field + ".key");
            opaqueId(entry.getValue(), field + ".value");
            copy.put(entry.getKey(), entry.getValue());
        }
        return Collections.unmodifiableMap(copy);
    }

    static List<String> uniqueIdentifierList(List<String> values, String field) {
        List<String> copy = list(values, field);
        if (copy.isEmpty()) throw new IllegalArgumentException(field + " must not be empty");
        Set<String> unique = new HashSet<>();
        for (String value : copy) {
            identifier(value, field + " value");
            if (!unique.add(value)) {
                throw new IllegalArgumentException(field + " must be unique");
            }
        }
        return copy;
    }
}
