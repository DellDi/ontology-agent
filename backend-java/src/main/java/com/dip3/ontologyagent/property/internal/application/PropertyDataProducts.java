package com.dip3.ontologyagent.property.internal.application;

import java.util.Set;

/** Stable canonical product keys owned by the Property Domain Pack. */
public final class PropertyDataProducts {
  public static final String ORGANIZATION = "property-organization";
  public static final String PROJECT = "property-project";
  public static final String CHARGE_ITEM = "property-charge-item";
  public static final String RECEIVABLE = "property-receivable";
  public static final String PAYMENT = "property-payment";
  public static final String SERVICE_ORDER = "property-service-order";

  public static final Set<String> REQUIRED = Set.of(
      ORGANIZATION, PROJECT, CHARGE_ITEM, RECEIVABLE, PAYMENT, SERVICE_ORDER);

  private PropertyDataProducts() {}
}
