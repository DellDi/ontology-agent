package com.dip3.ontologyagent.easyv.internal.adapter.out.postgres;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.mock;

import com.dip3.ontologyagent.easyv.internal.application.PrototypeStructureReadPort;
import com.dip3.ontologyagent.semantic.api.*;
import com.dip3.ontologyagent.semantic.internal.adapter.out.postgres.PostgresObjectQueryAdapter;
import com.dip3.ontologyagent.support.JsonCodec;
import org.junit.jupiter.api.Test;
import org.springframework.aop.support.AopUtils;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.dao.annotation.PersistenceExceptionTranslationPostProcessor;
import org.springframework.jdbc.core.JdbcTemplate;

class PrototypeObjectReadConfigurationTest {
  private final ApplicationContextRunner context = new ApplicationContextRunner()
      .withUserConfiguration(PostgresObjectQueryAdapter.class, PrototypeStructurePostgresAdapter.class)
      .withBean(JdbcTemplate.class, () -> mock(JdbcTemplate.class))
      .withBean(SemanticModel.class, SemanticModel::discover)
      .withBean(JsonCodec.class, JsonCodec::new)
      .withBean(PersistenceExceptionTranslationPostProcessor.class, () -> {
        var processor = new PersistenceExceptionTranslationPostProcessor();
        processor.setProxyTargetClass(true);
        return processor;
      });

  @Test
  void enabledAdaptersSupportTheApplicationsClassBasedPersistenceProxies() {
    context.withPropertyValues("dip3.easyv.enabled=true").run(app -> {
      assertNull(app.getStartupFailure());
      assertTrue(AopUtils.isAopProxy(app.getBean(ObjectQueryPort.class)));
      assertTrue(AopUtils.isAopProxy(app.getBean(PrototypeStructureReadPort.class)));
    });
  }

  @Test
  void disabledDomainDoesNotAssembleItsStructureReader() {
    context.withPropertyValues("dip3.easyv.enabled=false").run(app -> {
      assertNull(app.getStartupFailure());
      assertTrue(app.getBeansOfType(PrototypeStructureReadPort.class).isEmpty());
    });
  }
}
