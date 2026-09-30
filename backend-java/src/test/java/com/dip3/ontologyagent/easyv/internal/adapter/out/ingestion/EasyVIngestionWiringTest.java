package com.dip3.ontologyagent.easyv.internal.adapter.out.ingestion;

import com.dip3.ontologyagent.ingestion.api.CanonicalProductTransform;
import com.dip3.ontologyagent.ingestion.internal.application.CanonicalProductTransformRegistry;
import com.dip3.ontologyagent.support.JsonCodec;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.ComponentScan;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.mock;

/** 守护 EasyV 物化转换器由生产装配注册；仅在测试里手工 new 无法暴露装配遗漏。 */
class EasyVIngestionWiringTest {
    @Configuration(proxyBeanMethods = false)
    @ComponentScan("com.dip3.ontologyagent.easyv.internal.adapter.out.ingestion")
    static class Scan {}

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(Scan.class)
            .withBean(JdbcTemplate.class, () -> mock(JdbcTemplate.class))
            .withBean(JsonCodec.class, JsonCodec::new);

    @Test
    void registersATransformForEveryEasyVProductWhenTheDomainIsEnabled() {
        runner.withPropertyValues("dip3.easyv.enabled=true").run(context -> {
            List<CanonicalProductTransform> transforms =
                    List.copyOf(context.getBeansOfType(CanonicalProductTransform.class).values());
            CanonicalProductTransformRegistry registry = new CanonicalProductTransformRegistry(transforms);

            Arrays.stream(EasyVCanonicalTransform.Kind.values()).forEach(kind ->
                    assertEquals(kind.transformRef(), registry.require(kind.transformRef()).transformRef()));
            assertEquals(EasyVCanonicalTransform.Kind.values().length, transforms.size());
        });
    }

    @Test
    void registersNothingWhenTheDomainIsDisabled() {
        runner.withPropertyValues("dip3.easyv.enabled=false").run(context ->
                assertEquals(0, context.getBeansOfType(CanonicalProductTransform.class).size()));
    }
}
