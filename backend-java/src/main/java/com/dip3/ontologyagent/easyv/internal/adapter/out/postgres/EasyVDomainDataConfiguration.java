package com.dip3.ontologyagent.easyv.internal.adapter.out.postgres;

import com.dip3.ontologyagent.easyv.internal.adapter.out.ingestion.EasyVCanonicalTransform;
import com.dip3.ontologyagent.easyv.internal.application.EasyVGenerationFacts;
import com.dip3.ontologyagent.ingestion.api.CanonicalProductTransform;
import com.dip3.ontologyagent.ingestion.api.DatasetVersionSetRegistry;
import com.dip3.ontologyagent.support.JsonCodec;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;

/** EasyV Domain Pack data mappings and canonical runtime reader. */
@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(prefix = "dip3.easyv", name = "enabled", havingValue = "true")
public class EasyVDomainDataConfiguration {
    @Bean
    EasyVGenerationFacts easyVGenerationFacts(
            JdbcTemplate jdbc,
            PlatformTransactionManager transactionManager,
            DatasetVersionSetRegistry versionSets) {
        return new EasyVCanonicalFactAdapter(jdbc, transactionManager, versionSets);
    }

    @Bean
    CanonicalProductTransform easyVApplicationTransform(JdbcTemplate jdbc, JsonCodec json) {
        return new EasyVCanonicalTransform(EasyVCanonicalTransform.Kind.APPLICATION, jdbc, json);
    }

    @Bean
    CanonicalProductTransform easyVPrototypeTransform(JdbcTemplate jdbc, JsonCodec json) {
        return new EasyVCanonicalTransform(EasyVCanonicalTransform.Kind.PROTOTYPE, jdbc, json);
    }

    @Bean
    CanonicalProductTransform easyVPipelineTransform(JdbcTemplate jdbc, JsonCodec json) {
        return new EasyVCanonicalTransform(EasyVCanonicalTransform.Kind.PIPELINE, jdbc, json);
    }

    @Bean
    CanonicalProductTransform easyVForgeTransform(JdbcTemplate jdbc, JsonCodec json) {
        return new EasyVCanonicalTransform(EasyVCanonicalTransform.Kind.FORGE, jdbc, json);
    }

    @Bean
    CanonicalProductTransform easyVFeedbackTransform(JdbcTemplate jdbc, JsonCodec json) {
        return new EasyVCanonicalTransform(EasyVCanonicalTransform.Kind.FEEDBACK, jdbc, json);
    }
}
