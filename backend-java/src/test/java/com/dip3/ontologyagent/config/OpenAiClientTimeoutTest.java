package com.dip3.ontologyagent.config;

import com.sun.net.httpserver.HttpServer;
import java.io.InterruptedIOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.Executors;
import org.junit.jupiter.api.Test;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.model.openai.autoconfigure.OpenAiChatAutoConfiguration;
import org.springframework.ai.model.openai.autoconfigure.OpenAiChatProperties;
import org.springframework.ai.model.tool.ToolCallingManager;
import org.springframework.ai.openai.OpenAiChatModel;
import org.springframework.ai.openai.OpenAiChatOptions;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.core.io.ClassPathResource;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class OpenAiClientTimeoutTest {
    @Test
    void configuredStartupTimeoutControlsTheRealStreamingClient() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        var executor = Executors.newVirtualThreadPerTaskExecutor();
        server.setExecutor(executor);
        server.createContext("/v1/chat/completions", exchange -> {
            try {
                Thread.sleep(400);
                byte[] body = ("""
                        data: {"id":"test","object":"chat.completion.chunk","created":1,"model":"test-model","choices":[{"index":0,"delta":{"role":"assistant","content":"ok"},"finish_reason":null}]}

                        data: [DONE]

                        """).getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().set("Content-Type", "text/event-stream");
                exchange.sendResponseHeaders(200, body.length);
                exchange.getResponseBody().write(body);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            } finally {
                exchange.close();
            }
        });
        server.start();
        try {
            var runner = new ApplicationContextRunner()
                    .withConfiguration(AutoConfigurations.of(OpenAiChatAutoConfiguration.class))
                    .withBean(ToolCallingManager.class, () -> ToolCallingManager.builder().build())
                    .withInitializer(context -> {
                        try {
                            new YamlPropertySourceLoader().load("application", new ClassPathResource("application.yml"))
                                    .forEach(source -> context.getEnvironment().getPropertySources().addLast(source));
                        } catch (java.io.IOException failure) {
                            throw new IllegalStateException(failure);
                        }
                    })
                    .withPropertyValues("spring.ai.openai.base-url=http://127.0.0.1:" + server.getAddress().getPort() + "/v1",
                            "spring.ai.openai.api-key=test-key", "spring.ai.openai.chat.model=test-model");

            runner.withPropertyValues("spring.ai.openai.chat.timeout=100ms").run(context -> {
                var chat = ChatClient.create(context.getBean(OpenAiChatModel.class));
                // A request-level option does not replace the startup client's transport timeout.
                var failure = assertThrows(RuntimeException.class, () -> chat.prompt()
                        .options(OpenAiChatOptions.builder().timeout(Duration.ofSeconds(5)))
                        .user("ping").stream().content().collectList().block(Duration.ofSeconds(5)));
                boolean timedOut = false;
                for (Throwable cause = failure; cause != null; cause = cause.getCause()) {
                    timedOut |= cause instanceof InterruptedIOException;
                }
                assertTrue(timedOut, "应复现网络客户端超时，而不是其他调用错误");
            });
            runner.run(context -> {
                assertEquals(Duration.ofMinutes(3), context.getBean(OpenAiChatProperties.class).getTimeout());
                assertEquals("ok", ChatClient.create(context.getBean(OpenAiChatModel.class)).prompt()
                        .user("ping").stream().content().reduce("", String::concat).block(Duration.ofSeconds(5)));
            });
        } finally {
            server.stop(0);
            executor.close();
        }
    }
}
