package com.dip3.ontologyagent.auth;

import java.time.Instant;

public record AuthSession(String sessionId, String userId, String displayName, AccessScope scope, Instant expiresAt) {}
