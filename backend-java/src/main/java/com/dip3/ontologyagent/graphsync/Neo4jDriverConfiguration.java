package com.dip3.ontologyagent.graphsync;

import com.dip3.ontologyagent.config.BackendProperties;
import org.neo4j.driver.AuthTokens;
import org.neo4j.driver.Driver;
import org.neo4j.driver.GraphDatabase;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
@ConditionalOnProperty(prefix = "dip3.property", name = "enabled", havingValue = "true", matchIfMissing = true)
public class Neo4jDriverConfiguration {
    @Bean(destroyMethod = "close")
    Driver neo4jDriver(BackendProperties properties) {
        BackendProperties.Neo4j config = properties.neo4j();
        return GraphDatabase.driver(config.uri(), AuthTokens.basic(config.username(), config.password()));
    }
}
