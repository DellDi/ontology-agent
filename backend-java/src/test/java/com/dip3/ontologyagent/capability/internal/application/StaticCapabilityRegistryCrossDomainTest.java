package com.dip3.ontologyagent.capability.internal.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.dip3.ontologyagent.capability.api.CapabilityDescriptor;
import com.dip3.ontologyagent.capability.api.CapabilityId;
import com.dip3.ontologyagent.capability.api.CapabilityInvocationContract;
import com.dip3.ontologyagent.capability.api.CapabilityRegistration;
import com.dip3.ontologyagent.capability.api.InitialCapabilityCandidate;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVCapabilityPolicy;
import com.dip3.ontologyagent.property.internal.domain.AnalysisCapabilityPolicy;
import com.dip3.ontologyagent.support.BackendException;
import java.util.List;
import java.util.Set;
import java.util.function.Predicate;
import org.junit.jupiter.api.Test;

class StaticCapabilityRegistryCrossDomainTest {
  private static final CapabilityId PROPERTY =
      new CapabilityId("property", "collection-rate-analysis");
  private static final CapabilityId EASYV =
      new CapabilityId("easyv", "generation-quality-analysis");

  @Test
  void selectsThePolicyBackedPropertyOrEasyVCandidateWithoutRegistrationOrderDependence() {
    StaticCapabilityRegistry first =
        new StaticCapabilityRegistry(List.of(property(), easyv()));
    StaticCapabilityRegistry reversed =
        new StaticCapabilityRegistry(List.of(easyv(), property()));

    assertEquals(PROPERTY, first.selectInitial("分析项目收缴率"));
    assertEquals(EASYV, first.selectInitial("分析 EasyV 大屏生成质量"));
    assertEquals(PROPERTY, reversed.selectInitial("分析项目收缴率"));
    assertEquals(EASYV, reversed.selectInitial("分析 EasyV 大屏生成质量"));
  }

  @Test
  void unsupportedQuestionHasNoHiddenCrossDomainFallback() {
    StaticCapabilityRegistry registry =
        new StaticCapabilityRegistry(List.of(property(), easyv()));

    BackendException error =
        assertThrows(BackendException.class, () -> registry.selectInitial("分析 CRM 客服转化率"));

    assertEquals("ANALYSIS_CAPABILITY_UNSUPPORTED", error.code());
  }

  @Test
  void deliberatePolicyOverlapFailsAsAmbiguous() {
    CapabilityId overlapping = new CapabilityId("easyv-alias", "generation-quality-analysis");
    StaticCapabilityRegistry registry =
        new StaticCapabilityRegistry(
            List.of(property(), easyv(), policyRegistration(overlapping, EasyVCapabilityPolicy::supportsInitial)));

    BackendException error =
        assertThrows(
            BackendException.class,
            () -> registry.selectInitial("分析 EasyV 大屏生成质量"));

    assertEquals("CAPABILITY_SELECTION_AMBIGUOUS", error.code());
  }

  private static CapabilityRegistration property() {
    return policyRegistration(
        PROPERTY,
        question ->
            !AnalysisCapabilityPolicy.unsupportedBusinessScope(question)
                && AnalysisCapabilityPolicy.supportsInitialCollectionRate(question));
  }

  private static CapabilityRegistration easyv() {
    return policyRegistration(EASYV, EasyVCapabilityPolicy::supportsInitial);
  }

  private static CapabilityRegistration policyRegistration(
      CapabilityId id, Predicate<String> policy) {
    CapabilityRegistration registration = mock(CapabilityRegistration.class);
    when(registration.descriptor()).thenReturn(descriptor(id));
    when(registration.initialQuestionCandidate(anyString()))
        .thenAnswer(
            invocation ->
                policy.test(invocation.getArgument(0))
                    ? InitialCapabilityCandidate.matched(id)
                    : InitialCapabilityCandidate.notMatched(id));
    return registration;
  }

  private static CapabilityDescriptor descriptor(CapabilityId id) {
    return new CapabilityDescriptor(
        id,
        id.toString(),
        Set.of("definition"),
        Set.of(),
        Set.of("evidence"),
        Set.of("claim"),
        new CapabilityInvocationContract(
            id.capabilityKey() + "-invocation",
            id.capabilityKey() + "-tool",
            1,
            "Agent",
            "Tool",
            id.capabilityKey() + "-count"));
  }
}
