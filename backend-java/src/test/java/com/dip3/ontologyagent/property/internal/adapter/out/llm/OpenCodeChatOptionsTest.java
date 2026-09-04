package com.dip3.ontologyagent.property.internal.adapter.out.llm;

import com.openai.client.OpenAIClient;
import com.openai.client.OpenAIClientImpl;
import com.openai.core.ClientOptions;
import com.dip3.ontologyagent.support.OpenCodeSessionHeader;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.openai.OpenAiChatModel;
import org.springframework.ai.openai.OpenAiChatOptions;
import org.springframework.ai.openai.http.okhttp.SpringAiOpenAiHttpClient;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;

class OpenCodeChatOptionsTest {
    @Test
    void springAiSendsTheStableConversationHeaderOnTheWire() throws Exception {
        AtomicReference<String> receivedSession = new AtomicReference<>();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/chat/completions", exchange -> {
            receivedSession.set(exchange.getRequestHeaders().getFirst(OpenCodeSessionHeader.NAME));
            byte[] body = ("""
                    {"id":"chatcmpl-test","object":"chat.completion","created":%d,"model":"test-model",
                    "choices":[{"index":0,"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}],
                    "usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}
                    """).formatted(Instant.now().getEpochSecond()).getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.start();

        SpringAiOpenAiHttpClient http = SpringAiOpenAiHttpClient.builder().build();
        OpenAIClient client = new OpenAIClientImpl(ClientOptions.builder()
                .httpClient(http)
                .baseUrl("http://127.0.0.1:" + server.getAddress().getPort() + "/v1")
                .apiKey("test-key")
                .maxRetries(0)
                .build());
        try {
            OpenAiChatModel model = OpenAiChatModel.builder()
                    .openAiClient(client)
                    .openAiClientAsync(client.async())
                    .options(OpenAiChatOptions.builder().model("test-model").build())
                    .build();

            String content = ChatClient.create(model).prompt()
                    .options(OpenAiChatOptions.builder()
                            .customHeaders(OpenCodeSessionHeader.forConversation("session-1")))
                    .user("ping")
                    .call()
                    .content();

            assertEquals("ok", content);
            assertEquals("session-1", receivedSession.get());
        } finally {
            client.close();
            server.stop(0);
        }
    }
}
