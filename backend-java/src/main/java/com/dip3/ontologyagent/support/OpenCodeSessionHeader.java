package com.dip3.ontologyagent.support;

import java.util.Map;

public final class OpenCodeSessionHeader {
    public static final String NAME = "x-opencode-session";

    private OpenCodeSessionHeader() {}

    public static Map<String, String> forConversation(String sessionId) {
        if (sessionId == null || sessionId.isBlank()) {
            throw new IllegalArgumentException("OpenCode conversation session id must not be blank");
        }
        return Map.of(NAME, sessionId);
    }
}
