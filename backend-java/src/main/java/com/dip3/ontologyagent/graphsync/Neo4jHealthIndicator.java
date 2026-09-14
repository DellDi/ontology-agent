package com.dip3.ontologyagent.graphsync;

import org.neo4j.driver.Driver;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.health.contributor.Health;
import org.springframework.boot.health.contributor.HealthIndicator;
import org.springframework.stereotype.Component;

@Component("neo4j")
@ConditionalOnProperty(prefix = "dip3.property", name = "enabled", havingValue = "true", matchIfMissing = true)
public final class Neo4jHealthIndicator implements HealthIndicator {
    private final Driver driver;

    public Neo4jHealthIndicator(Driver driver) { this.driver = driver; }

    @Override
    public Health health() {
        try {
            driver.verifyConnectivity();
            return Health.up().build();
        } catch (RuntimeException error) {
            return Health.down().withDetail("error", error.getClass().getSimpleName()).build();
        }
    }
}
