package com.dip3.ontologyagent.config;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import org.springframework.boot.health.contributor.Status;

import java.net.InetSocketAddress;
import java.time.Duration;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

class CubeHealthIndicatorTest {
    @Test
    void reportsTheRealReadyEndpointWithoutExposingTheApiSecret() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/readyz", exchange -> {
            exchange.sendResponseHeaders(200, -1);
            exchange.close();
        });
        server.start();
        try {
            var health = new CubeHealthIndicator(properties(server.getAddress().getPort())).health();
            assertEquals(Status.UP, health.getStatus());
            assertEquals("readyz", health.getDetails().get("probe"));
            assertFalse(health.getDetails().toString().contains("cube-secret"));
        } finally {
            server.stop(0);
        }
    }

    @Test
    void reportsDownWhenCubeCannotBeReached() {
        assertEquals(Status.DOWN, new CubeHealthIndicator(properties(1)).health().getStatus());
    }

    private static BackendProperties properties(int port) {
        return new BackendProperties("session-secret", "dip3",
                new BackendProperties.Cube("http://127.0.0.1:" + port + "/cubejs-api/v1", "cube-secret",
                        Duration.ofMillis(250)),
                new BackendProperties.Neo4j("bolt://127.0.0.1:1", "neo4j", "password", "neo4j"),
                new BackendProperties.Worker(false, Duration.ofSeconds(1)),
                new BackendProperties.Stream(Duration.ofMillis(10), Duration.ofSeconds(1)),
                "", "", false, false, false);
    }
}
