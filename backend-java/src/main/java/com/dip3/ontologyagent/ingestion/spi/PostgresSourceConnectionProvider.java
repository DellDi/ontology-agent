package com.dip3.ontologyagent.ingestion.spi;

import org.springframework.transaction.PlatformTransactionManager;

import javax.sql.DataSource;

/** Resolves a server-owned connection reference for the PostgreSQL connector. */
@FunctionalInterface
public interface PostgresSourceConnectionProvider {
    ResolvedConnection resolve(String connectionRef);

    /** One Domain Data Pack registration consumed by the platform connection resolver. */
    record Registration(String connectionRef, ResolvedConnection connection) {
        public Registration {
            if (connectionRef == null || !connectionRef.matches("[a-z][a-z0-9_-]*")) {
                throw new IllegalArgumentException("connectionRef must be a restricted catalog key");
            }
            if (connection == null) throw new IllegalArgumentException("connection must not be null");
        }
    }

    record ResolvedConnection(DataSource dataSource,
                              PlatformTransactionManager transactionManager,
                              int queryTimeoutSeconds) {
        public ResolvedConnection {
            if (dataSource == null) throw new IllegalArgumentException("dataSource must not be null");
            if (transactionManager == null) {
                throw new IllegalArgumentException("transactionManager must not be null");
            }
            if (queryTimeoutSeconds <= 0 || queryTimeoutSeconds > 300) {
                throw new IllegalArgumentException("queryTimeoutSeconds must be between 1 and 300");
            }
        }
    }
}
