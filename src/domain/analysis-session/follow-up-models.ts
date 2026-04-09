import {
  extractAnalysisContext,
  type AnalysisContext,
  type AnalysisContextConstraint,
  type AnalysisContextField,
} from '@/domain/analysis-context/models';

import { normalizeQuestionText } from './models';

export type AnalysisSessionFollowUp = {
  id: string;
  sessionId: string;
  ownerUserId: string;
  questionText: string;
  referencedExecutionId: string;
  referencedConclusionTitle: string | null;
  referencedConclusionSummary: string | null;
  inheritedContext: AnalysisContext;
  mergedContext: AnalysisContext;
  createdAt: string;
  updatedAt: string;
};

function mergeField(
  inheritedField: AnalysisContextField,
  followUpField: AnalysisContextField,
) {
  if (followUpField.state === 'confirmed') {
    return followUpField;
  }

  if (inheritedField.state === 'confirmed') {
    return inheritedField;
  }

  if (followUpField.state === 'uncertain') {
    return followUpField;
  }

  return inheritedField;
}

function mergeConstraints(
  inheritedConstraints: AnalysisContextConstraint[],
  followUpConstraints: AnalysisContextConstraint[],
) {
  const mergedConstraints: AnalysisContextConstraint[] = [];
  const dedupe = new Set<string>();

  for (const constraint of [...inheritedConstraints, ...followUpConstraints]) {
    const key = `${constraint.label}:${constraint.value}`;

    if (dedupe.has(key)) {
      continue;
    }

    dedupe.add(key);
    mergedConstraints.push(constraint);
  }

  return mergedConstraints;
}

export function mergeFollowUpContext({
  inheritedContext,
  followUpQuestionText,
}: {
  inheritedContext: AnalysisContext;
  followUpQuestionText: string;
}) {
  const extractedFollowUpContext = extractAnalysisContext(
    normalizeQuestionText(followUpQuestionText),
  );

  return {
    targetMetric: mergeField(
      inheritedContext.targetMetric,
      extractedFollowUpContext.targetMetric,
    ),
    entity: mergeField(inheritedContext.entity, extractedFollowUpContext.entity),
    timeRange: mergeField(
      inheritedContext.timeRange,
      extractedFollowUpContext.timeRange,
    ),
    comparison: mergeField(
      inheritedContext.comparison,
      extractedFollowUpContext.comparison,
    ),
    constraints: mergeConstraints(
      inheritedContext.constraints,
      extractedFollowUpContext.constraints,
    ),
  };
}
