package com.dip3.ontologyagent;

import com.dip3.ontologyagent.config.BackendProperties;
import com.dip3.ontologyagent.config.EasyVPostgresProperties;
import com.dip3.ontologyagent.config.ProviderCapabilityProperties;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
@EnableConfigurationProperties({BackendProperties.class, ProviderCapabilityProperties.class,
        EasyVPostgresProperties.class})
public class OntologyAgentApplication {
    public static void main(String[] args) {
        SpringApplication.run(OntologyAgentApplication.class, args);
    }
}
