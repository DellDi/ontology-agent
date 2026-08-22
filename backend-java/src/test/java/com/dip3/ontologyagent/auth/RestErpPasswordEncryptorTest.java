package com.dip3.ontologyagent.auth;

import com.dip3.ontologyagent.config.BackendProperties;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;

import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RestErpPasswordEncryptorTest {

    @Test
    void disabledWhenErpApiBaseUrlNotConfigured() {
        ErpPasswordEncryptor encryptor = new RestErpPasswordEncryptor(properties(""));
        assertEquals(Optional.empty(), encryptor.encrypt("plain"));
    }

    @Test
    void encryptsViaErpEndpointAndFailsLoudOnInvalidResponse() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/fastify/newsee/handlePassword", exchange -> {
            byte[] body = "{\"statusCode\":200,\"result\":\"encrypted-value\"}"
                    .getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(body);
            }
        });
        server.start();
        try {
            ErpPasswordEncryptor encryptor = new RestErpPasswordEncryptor(
                    properties("http://127.0.0.1:" + server.getAddress().getPort()));
            assertEquals(Optional.of("encrypted-value"), encryptor.encrypt("plain"));
        } finally {
            server.stop(0);
        }
    }

    @Test
    void returnsEmptyWhenErpRespondsWithErrorShape() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/fastify/newsee/handlePassword", exchange -> {
            byte[] body = "{\"statusCode\":500}".getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(body);
            }
        });
        server.start();
        try {
            ErpPasswordEncryptor encryptor = new RestErpPasswordEncryptor(
                    properties("http://127.0.0.1:" + server.getAddress().getPort()));
            assertTrue(encryptor.encrypt("plain").isEmpty());
        } finally {
            server.stop(0);
        }
    }

    private static BackendProperties properties(String erpApiBaseUrl) {
        return new BackendProperties("secret", "dip3",
                new BackendProperties.Cube("http://cube", "secret", Duration.ofSeconds(1)),
                new BackendProperties.Neo4j("bolt://neo4j", "neo4j", "secret", "neo4j"),
                new BackendProperties.Worker(false, Duration.ofSeconds(1)),
                new BackendProperties.Stream(Duration.ofMillis(10), Duration.ofSeconds(1)),
                erpApiBaseUrl, "", false, false, false);
    }
}
