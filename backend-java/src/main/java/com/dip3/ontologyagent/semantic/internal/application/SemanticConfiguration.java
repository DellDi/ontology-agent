package com.dip3.ontologyagent.semantic.internal.application;

import com.dip3.ontologyagent.semantic.api.SemanticModel;
import com.dip3.ontologyagent.semantic.api.SemanticQueryCompiler;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** 平台语义层：汇总类路径上全部领域本体声明，启动时校验引用完整性（失败即拒绝启动）。 */
@Configuration(proxyBeanMethods = false)
public class SemanticConfiguration {

  @Bean
  public SemanticModel semanticModel() {
    return SemanticModel.discover();
  }

  @Bean
  public SemanticQueryCompiler semanticQueryCompiler(SemanticModel model) {
    return new SemanticQueryCompiler(model);
  }
}
