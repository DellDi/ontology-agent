package com.dip3.ontologyagent.graphsync;

import java.util.List;

/** Domain projection port used by the graph-sync control plane. */
public interface GraphBatchBuilder {
    GraphProjection latestProjection();

    GraphProjection requireProjection(String datasetVersionSetId);

    List<String> activeOrganizationIds(GraphProjection projection);

    GraphBatch build(String organizationId, String runId, GraphProjection projection);
}
