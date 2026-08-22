package com.dip3.ontologyagent.config;

import jakarta.validation.constraints.NotNull;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@Validated
@ConfigurationProperties("dip3.ai.provider")
public record ProviderCapabilityProperties(@NotNull Mode mode, boolean toolCalling,
                                           @NotNull StructuredOutput structuredOutput) {
    public enum Mode {
        OPENAI_COMPATIBLE,
        DASHSCOPE
    }

    public enum StructuredOutput {
        NATIVE_JSON_SCHEMA,
        JSON_OBJECT
    }
}
