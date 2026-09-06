package com.dip3.ontologyagent.graphsync;

public interface GraphWriter {
    WriteResult replaceOrganization(String organizationId, GraphProjection projection,
                                    String runId, long fencingToken, GraphBatch batch);

    record WriteResult(int nodesWritten, int edgesWritten, int nodesDeleted, int edgesDeleted) {}
}
