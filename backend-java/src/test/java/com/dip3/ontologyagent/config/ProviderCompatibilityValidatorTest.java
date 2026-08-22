package com.dip3.ontologyagent.config;

import org.junit.jupiter.api.Test;
import org.springframework.boot.health.contributor.Status;
import org.springframework.mock.env.MockEnvironment;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ProviderCompatibilityValidatorTest {
    @Test
    void acceptsExplicitOpenAiCompatibleCapabilities() {
        ProviderCompatibilityValidator validator = validator(
                ProviderCapabilityProperties.Mode.OPENAI_COMPATIBLE,
                ProviderCapabilityProperties.StructuredOutput.NATIVE_JSON_SCHEMA,
                "https://llm.example.com/v1", true, "0", "false");

        assertEquals("qwen-test", validator.model());
        assertEquals("https://llm.example.com/v1", validator.baseUrl());
    }

    @Test
    void acceptsDashScopeOnlyWithCompatibleEndpointAndJsonObject() {
        ProviderCompatibilityValidator validator = validator(
                ProviderCapabilityProperties.Mode.DASHSCOPE,
                ProviderCapabilityProperties.StructuredOutput.JSON_OBJECT,
                "https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/",
                true, "0", "false");

        assertEquals(ProviderCapabilityProperties.Mode.DASHSCOPE, validator.properties().mode());
    }

    @Test
    void rejectsUnverifiedDashScopeNativeSchemaClaim() {
        IllegalStateException error = assertThrows(IllegalStateException.class, () -> validator(
                ProviderCapabilityProperties.Mode.DASHSCOPE,
                ProviderCapabilityProperties.StructuredOutput.NATIVE_JSON_SCHEMA,
                "https://dashscope.aliyuncs.com/compatible-mode/v1",
                true, "0", "false"));

        assertTrue(error.getMessage().contains("JSON_OBJECT"));
    }

    @Test
    void rejectsMissingToolCallingAndProviderRetries() {
        assertThrows(IllegalStateException.class, () -> validator(
                ProviderCapabilityProperties.Mode.OPENAI_COMPATIBLE,
                ProviderCapabilityProperties.StructuredOutput.NATIVE_JSON_SCHEMA,
                "https://llm.example.com/v1", false, "0", "false"));
        assertThrows(IllegalStateException.class, () -> validator(
                ProviderCapabilityProperties.Mode.OPENAI_COMPATIBLE,
                ProviderCapabilityProperties.StructuredOutput.NATIVE_JSON_SCHEMA,
                "https://llm.example.com/v1", true, "1", "false"));
    }

    @Test
    void healthReportsConfiguredCapabilitiesWithoutClaimingUpstreamIsUpOrLeakingKey() {
        ProviderCompatibilityValidator validator = validator(
                ProviderCapabilityProperties.Mode.DASHSCOPE,
                ProviderCapabilityProperties.StructuredOutput.JSON_OBJECT,
                "https://dashscope.aliyuncs.com/compatible-mode/v1", true, "0", "false");
        var health = new ProviderHealthIndicator(validator).health();

        assertEquals(Status.UNKNOWN, health.getStatus());
        assertEquals("configuration-only", health.getDetails().get("verification"));
        assertEquals("not-probed", health.getDetails().get("upstreamReachability"));
        assertEquals("dashscope", health.getDetails().get("mode"));
        assertFalse(health.getDetails().toString().contains("secret-key"));
    }

    private static ProviderCompatibilityValidator validator(
            ProviderCapabilityProperties.Mode mode,
            ProviderCapabilityProperties.StructuredOutput structuredOutput,
            String baseUrl, boolean toolCalling, String retries, String parallelCalls) {
        ProviderCapabilityProperties properties = new ProviderCapabilityProperties(
                mode, toolCalling, structuredOutput);
        MockEnvironment environment = new MockEnvironment()
                .withProperty("spring.ai.openai.base-url", baseUrl)
                .withProperty("spring.ai.openai.api-key", "secret-key")
                .withProperty("spring.ai.openai.chat.model", "qwen-test")
                .withProperty("spring.ai.openai.chat.max-retries", retries)
                .withProperty("spring.ai.openai.chat.parallel-tool-calls", parallelCalls);
        return new ProviderCompatibilityValidator(properties, environment);
    }
}
