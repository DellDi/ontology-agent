package com.dip3.ontologyagent.auth;

import java.time.Instant;
import java.util.List;

/** identity.accounts 行 + 已授予角色。 */
public record IdentityAccount(long id, String account, String displayName, String passwordHash,
                              String status, String source, String organizationId,
                              Instant lockedUntil, List<String> roleCodes) {

    public boolean disabled() {
        return "disabled".equals(status);
    }

    public boolean locked() {
        return lockedUntil != null && lockedUntil.isAfter(Instant.now());
    }
}
