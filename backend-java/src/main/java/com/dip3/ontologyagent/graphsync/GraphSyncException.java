package com.dip3.ontologyagent.graphsync;

public final class GraphSyncException extends RuntimeException {
    private final String code;
    private final boolean partialWrite;

    public GraphSyncException(String code, String message, boolean partialWrite) {
        super(message);
        this.code = code;
        this.partialWrite = partialWrite;
    }

    public GraphSyncException(String code, String message, boolean partialWrite, Throwable cause) {
        super(message, cause);
        this.code = code;
        this.partialWrite = partialWrite;
    }

    public String code() { return code; }

    public boolean partialWrite() {
        return partialWrite;
    }
}
