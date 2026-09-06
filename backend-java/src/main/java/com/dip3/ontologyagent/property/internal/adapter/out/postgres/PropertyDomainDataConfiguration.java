package com.dip3.ontologyagent.property.internal.adapter.out.postgres;

import com.dip3.ontologyagent.ingestion.api.CanonicalProductTransform;
import com.dip3.ontologyagent.ingestion.spi.PostgresSourceConnectionProvider;
import com.dip3.ontologyagent.property.internal.adapter.out.ingestion.PropertyCanonicalTransform;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;

import javax.sql.DataSource;

/**
 * Property Domain Pack registrations.  The current ERP staging source lives
 * in the platform PostgreSQL database, so ingestion reuses the platform
 * DataSource and transaction manager while the generic connector enforces a
 * read-only repeatable-read snapshot.
 */
@Configuration(proxyBeanMethods = false)
@Profile("ingest")
public class PropertyDomainDataConfiguration {
    private static final int SOURCE_QUERY_TIMEOUT_SECONDS = 30;

    @Bean
    PostgresSourceConnectionProvider.Registration propertySourceConnectionRegistration(
            @Qualifier("dataSource") DataSource dataSource,
            @Qualifier("transactionManager") PlatformTransactionManager transactionManager) {
        return new PostgresSourceConnectionProvider.Registration(
                "property-staging-source",
                new PostgresSourceConnectionProvider.ResolvedConnection(
                        dataSource, transactionManager, SOURCE_QUERY_TIMEOUT_SECONDS));
    }

    @Bean
    CanonicalProductTransform propertyOrganizationTransform(JdbcTemplate jdbc) {
        return new PropertyCanonicalTransform(PropertyCanonicalTransform.Kind.ORGANIZATION, jdbc);
    }

    @Bean
    CanonicalProductTransform propertyProjectTransform(JdbcTemplate jdbc) {
        return new PropertyCanonicalTransform(PropertyCanonicalTransform.Kind.PROJECT, jdbc);
    }

    @Bean
    CanonicalProductTransform propertyChargeItemTransform(JdbcTemplate jdbc) {
        return new PropertyCanonicalTransform(PropertyCanonicalTransform.Kind.CHARGE_ITEM, jdbc);
    }

    @Bean
    CanonicalProductTransform propertyReceivableTransform(JdbcTemplate jdbc) {
        return new PropertyCanonicalTransform(PropertyCanonicalTransform.Kind.RECEIVABLE, jdbc);
    }

    @Bean
    CanonicalProductTransform propertyPaymentTransform(JdbcTemplate jdbc) {
        return new PropertyCanonicalTransform(PropertyCanonicalTransform.Kind.PAYMENT, jdbc);
    }

    @Bean
    CanonicalProductTransform propertyServiceOrderTransform(JdbcTemplate jdbc) {
        return new PropertyCanonicalTransform(PropertyCanonicalTransform.Kind.SERVICE_ORDER, jdbc);
    }
}
