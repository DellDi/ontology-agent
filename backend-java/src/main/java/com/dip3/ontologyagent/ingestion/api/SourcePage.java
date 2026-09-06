package com.dip3.ontologyagent.ingestion.api;

import java.util.List;
import java.util.Map;

/**
 * A bounded page read from one source dataset.
 *
 * <p>{@code nextCursor} is the keyset position after the returned rows. It
 * remains available on the final non-empty page so an ingestion run can
 * persist the observed source position; {@code lastPage} tells the caller not
 * to request another page.</p>
 */
public record SourcePage(String datasetKey, List<SourceRow> rows,
                         Map<String, Object> nextCursor, boolean lastPage) {
    public SourcePage {
        datasetKey = ValueChecks.catalogKey(datasetKey, "datasetKey");
        rows = ValueChecks.list(rows, "rows");
        nextCursor = nextCursor == null ? Map.of()
                : ValueChecks.objectMap(nextCursor, "nextCursor");
        if (!lastPage && nextCursor.isEmpty()) {
            throw new IllegalArgumentException(
                    "a non-final page must provide a next cursor");
        }
    }
}
