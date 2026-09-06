package com.dip3.ontologyagent.ingestion.api;

import java.util.Map;

/**
 * A read-only source snapshot shared by all registered datasets.
 *
 * <p>Implementations keep the snapshot transaction open until this resource
 * is closed. Callers must consume it on the thread that opened it.</p>
 */
public interface SourceSnapshot extends AutoCloseable {
    /** Stable, non-secret metadata identifying the source transaction snapshot. */
    Map<String, Object> snapshotContext();

    /** Read the first page using the committed cursor supplied at open time. */
    SourcePage readPage(String datasetKey);

    /** Read a page after the supplied keyset cursor. */
    SourcePage readPage(String datasetKey, Map<String, Object> afterCursor);

    @Override
    void close();
}
