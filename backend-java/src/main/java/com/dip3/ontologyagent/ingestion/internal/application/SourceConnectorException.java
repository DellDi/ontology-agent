package com.dip3.ontologyagent.ingestion.internal.application;

/** A fail-loud error from a governed source connector operation. */
public final class SourceConnectorException extends RuntimeException {
    private final String code;

    public SourceConnectorException(String code, String message) {
        super(message);
        this.code = requireCode(code);
    }

    public SourceConnectorException(String code, String message, Throwable cause) {
        super(message, cause);
        this.code = requireCode(code);
    }

    public String code() {
        return code;
    }

    private static String requireCode(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("code must not be blank");
        }
        return value;
    }
}
