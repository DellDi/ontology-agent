package com.dip3.ontologyagent.ingestion.internal.application;

import com.dip3.ontologyagent.ingestion.api.DatasetDefinition;
import com.dip3.ontologyagent.ingestion.api.IngestionCursor;
import com.dip3.ontologyagent.ingestion.api.IngestionRun;
import com.dip3.ontologyagent.ingestion.api.SourceDefinition;
import com.dip3.ontologyagent.ingestion.api.SourceSnapshot;

import java.util.List;
/**
 * Outbound port for a governed source snapshot.
 *
 * <p>The connector receives definitions and already committed cursors. It
 * does not receive SQL, a projection, or source credentials. Implementations
 * decide how to read a page from the declared source relation only.</p>
 */
public interface SourceConnector {
    String connectorType();

    SourceSnapshot openSnapshot(SourceDefinition source,
                                List<DatasetDefinition> datasets,
                                List<IngestionCursor> committedCursors,
                                IngestionRun.Mode mode,
                                int pageSize);
}
