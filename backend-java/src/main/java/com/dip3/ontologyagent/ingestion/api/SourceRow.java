package com.dip3.ontologyagent.ingestion.api;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * One source row in the exact order declared by a dataset's column contract.
 *
 * <p>Null values are allowed because source columns may be nullable. The
 * collection itself is copied so a connector cannot expose a mutable JDBC
 * result buffer to the ingestion pipeline.</p>
 */
public record SourceRow(List<Object> values) {
    public SourceRow {
        if (values == null) {
            throw new IllegalArgumentException("values must not be null");
        }
        values = Collections.unmodifiableList(new ArrayList<>(values));
    }
}
