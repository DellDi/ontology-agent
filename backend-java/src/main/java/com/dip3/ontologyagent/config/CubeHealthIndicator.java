package com.dip3.ontologyagent.config;

import org.springframework.boot.health.contributor.Health;
import org.springframework.boot.health.contributor.HealthIndicator;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.net.URI;

@Component("cube")
public final class CubeHealthIndicator implements HealthIndicator {
    private final RestClient http;
    private final URI readyUrl;

    public CubeHealthIndicator(BackendProperties properties) {
        var requestFactory = new SimpleClientHttpRequestFactory();
        requestFactory.setConnectTimeout(properties.cube().timeout());
        requestFactory.setReadTimeout(properties.cube().timeout());
        this.http = RestClient.builder().requestFactory(requestFactory).build();
        URI api = URI.create(properties.cube().apiUrl());
        this.readyUrl = URI.create(api.getScheme() + "://" + api.getAuthority() + "/readyz");
    }

    @Override
    public Health health() {
        try {
            var response = http.get().uri(readyUrl).retrieve().toBodilessEntity();
            return response.getStatusCode().is2xxSuccessful()
                    ? Health.up().withDetail("probe", "readyz").build()
                    : Health.down().withDetail("probe", "readyz").build();
        } catch (RuntimeException error) {
            return Health.down().withDetail("probe", "readyz")
                    .withDetail("errorType", error.getClass().getSimpleName()).build();
        }
    }
}
