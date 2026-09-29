package com.dip3.ontologyagent.support;

import java.util.List;
import java.util.Optional;

public final class BackendException extends RuntimeException {
    private final String code;
    private final Clarification clarification;

    /** 结构化澄清：澄清问题与候选项随错误透传，调用方不必从 message 文本中解析。 */
    public record Clarification(String question, List<String> options) {
        public Clarification {
            options = options == null ? List.of() : List.copyOf(options);
        }
    }

    public BackendException(String code, String message) {
        this(code, message, null, null);
    }

    public BackendException(String code, String message, Throwable cause) {
        this(code, message, cause, null);
    }

    private BackendException(String code, String message, Throwable cause, Clarification clarification) {
        super(message, cause);
        this.code = code;
        this.clarification = clarification;
    }

    public static BackendException clarification(String code, String message, String question,
                                                 List<String> options) {
        return new BackendException(code, message, null, new Clarification(question, options));
    }

    public String code() {
        return code;
    }

    public Optional<Clarification> clarification() {
        return Optional.ofNullable(clarification);
    }
}
