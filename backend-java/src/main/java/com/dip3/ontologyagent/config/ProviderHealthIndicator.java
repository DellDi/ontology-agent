package com.dip3.ontologyagent.config;

import org.springframework.boot.health.contributor.Health;
import org.springframework.boot.health.contributor.HealthIndicator;
import org.springframework.stereotype.Component;

@Component("llmProvider")
public final class ProviderHealthIndicator implements HealthIndicator {
    private final ProviderCompatibilityValidator provider;

    public ProviderHealthIndicator(ProviderCompatibilityValidator provider) {
        this.provider = provider;
    }

    @Override
    public Health health() {
        ProviderCapabilityProperties capabilities = provider.properties();
        return Health.unknown()
                .withDetail("mode", capabilities.mode().name().toLowerCase().replace('_', '-'))
                .withDetail("adapter", "spring-ai-openai")
                .withDetail("model", provider.model())
                .withDetail("toolCalling", capabilities.toolCalling())
                .withDetail("structuredOutput", capabilities.structuredOutput().name().toLowerCase().replace('_', '-'))
                .withDetail("verification", "configuration-only")
                .withDetail("upstreamReachability", "not-probed")
                .build();
    }
}
