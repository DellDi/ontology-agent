package com.dip3.ontologyagent.graphsync;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.dip3.ontologyagent.support.MigrationTestSupport;
import java.util.List;
import java.util.Map;
import org.apache.ibatis.session.SqlSessionFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mybatis.spring.SqlSessionFactoryBean;
import org.mybatis.spring.SqlSessionTemplate;
import org.neo4j.driver.Driver;
import org.neo4j.driver.GraphDatabase;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.neo4j.Neo4jContainer;
import org.testcontainers.postgresql.PostgreSQLContainer;

import javax.sql.DataSource;

@Testcontainers
class GraphSyncBootstrapIntegrationTest {
    @Container
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:17.8-alpine");
    @Container
    static final Neo4jContainer NEO4J = new Neo4jContainer("neo4j:5.26.12-community")
            .withoutAuthentication();
    private static AnnotationConfigApplicationContext context;
    private JdbcTemplate jdbc;
    private Driver driver;

    @BeforeAll
    static void startContext() {
        MigrationTestSupport.migrate(POSTGRES);
        context = new AnnotationConfigApplicationContext(TestConfig.class);
    }

    @AfterAll
    static void stopContext() {
        if (context != null) context.close();
    }

    @BeforeEach
    void clean() {
        jdbc = context.getBean(JdbcTemplate.class);
        driver = context.getBean(Driver.class);
        jdbc.update("truncate platform.graph_sync_runs");
        driver.executableQuery("match (n) detach delete n").execute();
    }

    @Test
    void canonicalProjectionBootstrapsOrganizationsAndPersistsVersionBinding() {
        GraphSyncRun parent = context.getBean(GraphSyncBootstrapService.class).run("trace-bootstrap");

        assertEquals("completed", parent.status());
        assertEquals("property-set-1", parent.cursorSnapshot().get("datasetVersionSetId"));
        assertEquals(2, parent.nodesWritten());
        assertEquals(2, jdbc.queryForObject("""
                select count(*) from platform.graph_sync_runs
                where cursor_snapshot->>'parentRunId'=? and status='completed'
                """, Integer.class, parent.id()));
        assertEquals(2L, driver.executableQuery("""
                match (n:GraphNode {dataset_version_set_id:'property-set-1'}) return count(n) as count
                """).execute().records().getFirst().get("count").asLong());
    }

    @Configuration(proxyBeanMethods = false)
    static class TestConfig {
        @Bean DataSource dataSource() {
            return new DriverManagerDataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(),
                    POSTGRES.getPassword());
        }

        @Bean JdbcTemplate jdbcTemplate(DataSource dataSource) {
            return new JdbcTemplate(dataSource);
        }

        @Bean SqlSessionFactory sqlSessionFactory(DataSource dataSource) throws Exception {
            SqlSessionFactoryBean factory = new SqlSessionFactoryBean();
            factory.setDataSource(dataSource);
            SqlSessionFactory sessionFactory = factory.getObject();
            sessionFactory.getConfiguration().addMapper(GraphSyncRunMapper.class);
            return sessionFactory;
        }

        @Bean SqlSessionTemplate sqlSessionTemplate(SqlSessionFactory factory) {
            return new SqlSessionTemplate(factory);
        }

        @Bean GraphSyncRunMapper runMapper(SqlSessionTemplate template) {
            return template.getMapper(GraphSyncRunMapper.class);
        }

        @Bean GraphSyncRunRepository runs(GraphSyncRunMapper mapper) {
            return new GraphSyncRunRepository(mapper);
        }

        @Bean Driver neo4jDriver() {
            return GraphDatabase.driver(NEO4J.getBoltUrl());
        }

        @Bean GraphWriter graphWriter(Driver driver) {
            return new Neo4jGraphWriter(driver, "neo4j");
        }

        @Bean GraphBatchBuilder batches() {
            GraphProjection projection = new GraphProjection("property-set-1",
                    Map.of("property-project", "project-version-1"));
            return new GraphBatchBuilder() {
                @Override public GraphProjection latestProjection() { return projection; }
                @Override public GraphProjection requireProjection(String ignored) { return projection; }
                @Override public List<String> activeOrganizationIds(GraphProjection ignored) {
                    return List.of("1001", "1002");
                }
                @Override public GraphBatch build(String organizationId, String runId,
                                                  GraphProjection ignored) {
                    return new GraphBatch(List.of(Map.of(
                            "kind", "organization", "id", organizationId, "label", organizationId,
                            "organizationId", organizationId, "runId", runId,
                            "datasetVersionSetId", projection.datasetVersionSetId(),
                            "sourceProductKey", "property-project",
                            "productVersionId", "project-version-1")), List.of());
                }
            };
        }

        @Bean(destroyMethod = "shutdown") ThreadPoolTaskScheduler scheduler() {
            ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
            scheduler.setPoolSize(2);
            scheduler.initialize();
            return scheduler;
        }

        @Bean GraphSyncLease leases(ThreadPoolTaskScheduler scheduler, GraphSyncRunRepository runs) {
            return new GraphSyncLease(scheduler, runs);
        }

        @Bean GraphSyncService rebuilds(GraphSyncRunRepository runs, GraphBatchBuilder batches,
                                        GraphWriter graph, GraphSyncLease leases) {
            return new GraphSyncService(runs, batches, graph, leases);
        }

        @Bean GraphSyncBootstrapService bootstrapService(GraphSyncRunRepository runs,
                                                         GraphBatchBuilder batches,
                                                         GraphSyncService rebuilds,
                                                         GraphSyncLease leases) {
            return new GraphSyncBootstrapService(runs, batches, rebuilds, leases);
        }
    }
}
