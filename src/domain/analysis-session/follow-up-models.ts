import {
  applyContextCorrection,
  type ContextCorrection,
  extractAnalysisContext,
  type AnalysisContext,
  type AnalysisContextConstraint,
  type AnalysisContextField,
} from '@/domain/analysis-context/models';
import type { AnalysisPlan, AnalysisPlanDiff } from '@/domain/analysis-plan/models';
import type { OntologyVersionBinding } from '@/domain/ontology/version-binding';

import { normalizeQuestionText } from './models';

export type AnalysisSessionFollowUp = {
  id: string;
  sessionId: string;
  ownerUserId: string;
  questionText: string;
  parentFollowUpId: string | null;
  referencedExecutionId: string;
  referencedConclusionTitle: string | null;
  referencedConclusionSummary: string | null;
  resultExecutionId: string | null;
  ontologyVersionId: string | null;
  ontologyVersionBinding: OntologyVersionBinding;
  inheritedContext: AnalysisContext;
  mergedContext: AnalysisContext;
  planVersion: number | null;
  currentPlanSnapshot: AnalysisPlan | null;
  previousPlanSnapshot: AnalysisPlan | null;
  currentPlanDiff: AnalysisPlanDiff | null;
  createdAt: string;
  updatedAt: string;
};

export type FollowUpContextFieldKey =
  | 'targetMetric'
  | 'entity'
  | 'timeRange'
  | 'comparison';

export type FollowUpContextChangeItem = {
  type: 'field' | 'constraint';
  key: string;
  label: string;
  previousValue?: string;
  nextValue: string;
};

export type FollowUpContextDiff = {
  added: FollowUpContextChangeItem[];
  overridden: FollowUpContextChangeItem[];
};

export type FollowUpContextAdjustment = {
  correction: ContextCorrection;
  factor: string | null;
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

const FIELD_LABELS: Record<FollowUpContextFieldKey, string> = {
  targetMetric: '目标指标',
  entity: '实体对象',
  timeRange: '时间范围',
  comparison: '比较方式',
};

function pushDiffItem(
  items: FollowUpContextChangeItem[],
  item: FollowUpContextChangeItem,
) {
  items.push(item);
}

export function buildFollowUpContextDiff({
  inheritedContext,
  mergedContext,
}: {
  inheritedContext: AnalysisContext;
  mergedContext: AnalysisContext;
}): FollowUpContextDiff {
  const added: FollowUpContextChangeItem[] = [];
  const overridden: FollowUpContextChangeItem[] = [];

  (Object.keys(FIELD_LABELS) as FollowUpContextFieldKey[]).forEach((fieldKey) => {
    const inheritedField = inheritedContext[fieldKey];
    const mergedField = mergedContext[fieldKey];

    if (inheritedField.value === mergedField.value) {
      return;
    }

    const targetCollection =
      inheritedField.state === 'confirmed' ? overridden : added;

    pushDiffItem(targetCollection, {
      type: 'field',
      key: fieldKey,
      label: FIELD_LABELS[fieldKey],
      previousValue: inheritedField.value,
      nextValue: mergedField.value,
    });
  });

  const inheritedConstraintKeys = new Set(
    inheritedContext.constraints.map(
      (constraint) => `${constraint.label}:${constraint.value}`,
    ),
  );

  mergedContext.constraints.forEach((constraint) => {
    const key = `${constraint.label}:${constraint.value}`;

    if (inheritedConstraintKeys.has(key)) {
      return;
    }

    pushDiffItem(added, {
      type: 'constraint',
      key,
      label: constraint.label,
      nextValue: constraint.value,
    });
  });

  return {
    added,
    overridden,
  };
}

export function analyzeFollowUpContextAdjustment({
  currentContext,
  adjustment,
}: {
  currentContext: AnalysisContext;
  adjustment: FollowUpContextAdjustment;
}) {
  const conflicts: FollowUpContextChangeItem[] = [];

  (Object.keys(FIELD_LABELS) as FollowUpContextFieldKey[]).forEach((fieldKey) => {
    const candidate = adjustment.correction[fieldKey];

    if (!candidate) {
      return;
    }

    const currentField = currentContext[fieldKey];

    if (
      currentField.state === 'confirmed' &&
      currentField.value !== candidate.value
    ) {
      conflicts.push({
        type: 'field',
        key: fieldKey,
        label: FIELD_LABELS[fieldKey],
        previousValue: currentField.value,
        nextValue: candidate.value,
      });
    }
  });

  return {
    conflicts,
  };
}

export function applyFollowUpContextAdjustment({
  currentContext,
  adjustment,
}: {
  currentContext: AnalysisContext;
  adjustment: FollowUpContextAdjustment;
}) {
  const correctedContext = Object.keys(adjustment.correction).length
    ? applyContextCorrection(currentContext, adjustment.correction)
    : currentContext;
  const nextConstraints = [...correctedContext.constraints];

  if (adjustment.factor) {
    const factorKey = `候选因素:${adjustment.factor}`;
    const hasFactor = nextConstraints.some(
      (constraint) => `${constraint.label}:${constraint.value}` === factorKey,
    );

    if (!hasFactor) {
      nextConstraints.push({
        label: '候选因素',
        value: adjustment.factor,
      });
    }
  }

  return {
    ...correctedContext,
    constraints: nextConstraints,
  };
}
