package com.dip3.ontologyagent.graphsync;

import com.dip3.ontologyagent.support.BackendException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

@Component
public final class GraphSyncOpsAuthenticator {
    private final byte[] expectedDigest;

    public GraphSyncOpsAuthenticator(@Value("${GRAPH_SYNC_OPS_SECRET:}") String secret) {
        expectedDigest = secret == null || secret.isBlank() ? null : digest(secret);
    }

    public void authenticate(String suppliedSecret) {
        if (expectedDigest == null) {
            throw new BackendException("GRAPH_SYNC_OPS_SECRET_REQUIRED",
                    "GRAPH_SYNC_OPS_SECRET 未配置，拒绝执行 system operation。 ");
        }
        byte[] suppliedDigest = digest(suppliedSecret == null ? "" : suppliedSecret);
        if (!MessageDigest.isEqual(expectedDigest, suppliedDigest)) {
            throw new BackendException("GRAPH_SYNC_OPS_FORBIDDEN", "Graph Sync system operation 凭据无效。 ");
        }
    }

    private static byte[] digest(String value) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException("SHA-256 unavailable", error);
        }
    }
}
