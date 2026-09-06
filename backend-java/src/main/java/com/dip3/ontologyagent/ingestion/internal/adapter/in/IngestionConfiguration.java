package com.dip3.ontologyagent.ingestion.internal.adapter.in;

import com.dip3.ontologyagent.ingestion.api.CanonicalProductTransform;
import com.dip3.ontologyagent.ingestion.internal.adapter.out.codec.RowPackV1Codec;
import com.dip3.ontologyagent.ingestion.internal.adapter.out.postgres.PostgresSourceConnector;
import com.dip3.ontologyagent.ingestion.internal.application.CanonicalProductTransformRegistry;
import com.dip3.ontologyagent.ingestion.internal.application.IngestionPersistencePort;
import com.dip3.ontologyagent.ingestion.internal.application.ProductCatalogPort;
import com.dip3.ontologyagent.ingestion.internal.application.ProductMaterializer;
import com.dip3.ontologyagent.ingestion.internal.application.DatasetReleasePublisher;
import com.dip3.ontologyagent.ingestion.internal.application.SourceBatchCodec;
import com.dip3.ontologyagent.ingestion.internal.application.SourceCatalogPort;
import com.dip3.ontologyagent.ingestion.internal.application.SourceConnector;
import com.dip3.ontologyagent.ingestion.internal.application.SourceConnectorRegistry;
import com.dip3.ontologyagent.ingestion.internal.application.SourceIngestionOrchestrator;
import com.dip3.ontologyagent.ingestion.spi.PostgresSourceConnectionProvider;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Platform composition for governed ingestion; Domain Packs contribute only registrations. */
@Configuration(proxyBeanMethods = false)
public class IngestionConfiguration {

    @Bean
    PostgresSourceConnectionProvider postgresSourceConnectionProvider(
            List<PostgresSourceConnectionProvider.Registration> registrations) {
        Map<String, PostgresSourceConnectionProvider.ResolvedConnection> connections =
                new LinkedHashMap<>();
        for (PostgresSourceConnectionProvider.Registration registration : registrations) {
            if (connections.putIfAbsent(registration.connectionRef(), registration.connection()) != null) {
                throw new IllegalArgumentException(
                        "duplicate PostgreSQL source connection: " + registration.connectionRef());
            }
        }
        Map<String, PostgresSourceConnectionProvider.ResolvedConnection> fixed = Map.copyOf(connections);
        return connectionRef -> {
            PostgresSourceConnectionProvider.ResolvedConnection connection = fixed.get(connectionRef);
            if (connection == null) {
                throw new IllegalArgumentException(
                        "unknown PostgreSQL source connection reference: " + connectionRef);
            }
            return connection;
        };
    }

    @Bean
    SourceBatchCodec sourceBatchCodec() {
        return new RowPackV1Codec();
    }

    @Bean
    SourceConnector postgresSourceConnector(PostgresSourceConnectionProvider connections) {
        return new PostgresSourceConnector(connections);
    }

    @Bean
    SourceConnectorRegistry sourceConnectorRegistry(List<SourceConnector> connectors) {
        return new SourceConnectorRegistry(connectors);
    }

    @Bean
    CanonicalProductTransformRegistry canonicalProductTransformRegistry(
            List<CanonicalProductTransform> transforms) {
        return new CanonicalProductTransformRegistry(transforms);
    }

    @Bean
    SourceIngestionOrchestrator sourceIngestionOrchestrator(
            SourceCatalogPort catalog, SourceConnectorRegistry connectors,
            SourceBatchCodec codec, IngestionPersistencePort persistence) {
        return new SourceIngestionOrchestrator(catalog, connectors, codec, persistence);
    }

    @Bean
    ProductMaterializer productMaterializer(
            ProductCatalogPort catalog, CanonicalProductTransformRegistry transforms,
            SourceBatchCodec codec, IngestionPersistencePort persistence) {
        return new ProductMaterializer(catalog, transforms, codec, persistence);
    }

    @Bean
    DatasetReleasePublisher datasetReleasePublisher(
            SourceIngestionOrchestrator sourceIngestion,
            SourceCatalogPort sourceCatalog,
            ProductCatalogPort productCatalog,
            ProductMaterializer productMaterializer,
            IngestionPersistencePort persistence) {
        return new DatasetReleasePublisher(
                sourceIngestion, sourceCatalog, productCatalog, productMaterializer, persistence);
    }
}
