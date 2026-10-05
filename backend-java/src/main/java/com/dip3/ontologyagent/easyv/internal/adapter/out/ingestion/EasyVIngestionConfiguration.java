package com.dip3.ontologyagent.easyv.internal.adapter.out.ingestion;

import com.dip3.ontologyagent.ingestion.api.CanonicalProductTransform;
import com.dip3.ontologyagent.support.JsonCodec;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;

/** EasyV Domain Pack 的受信任物化转换器；每个 Kind 对应一个已审核的数据产品。 */
@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(prefix = "dip3.easyv", name = "enabled", havingValue = "true")
public class EasyVIngestionConfiguration {
    @Bean
    CanonicalProductTransform easyVSchemeLibraryTransform(JdbcTemplate jdbc, JsonCodec json) {
        return new EasyVSchemeCanonicalTransform(jdbc, json);
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

    @Bean
    CanonicalProductTransform easyVPrototypeLayoutTransform(JdbcTemplate jdbc, JsonCodec json) {
        return new EasyVCanonicalTransform(EasyVCanonicalTransform.Kind.PROTOTYPE_LAYOUT, jdbc, json);
    }

    @Bean
    CanonicalProductTransform easyVPrototypeBlockTransform(JdbcTemplate jdbc, JsonCodec json) {
        return new EasyVCanonicalTransform(EasyVCanonicalTransform.Kind.PROTOTYPE_BLOCK, jdbc, json);
    }

    @Bean
    CanonicalProductTransform easyVPrototypeComponentTransform(JdbcTemplate jdbc, JsonCodec json) {
        return new EasyVCanonicalTransform(EasyVCanonicalTransform.Kind.PROTOTYPE_COMPONENT, jdbc, json);
    }
}
