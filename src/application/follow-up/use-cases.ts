import { randomUUID } from 'node:crypto';

import type { AnalysisContextReadModel } from '@/application/analysis-context/use-cases';
import { validateContextCorrection } from '@/domain/analysis-context/models';
import type { AnalysisExecutionSnapshot } from '@/domain/analysis-execution/persistence-models';
import type { AnalysisPlan, AnalysisPlanDiff } from '@/domain/analysis-plan/models';
import {
  analyzeFollowUpContextAdjustment,
  applyFollowUpContextAdjustment,
  buildFollowUpContextDiff,
  type FollowUpContextAdjustment,
  mergeFollowUpContext,
  type AnalysisSessionFollowUp,
} from '@/domain/analysis-session/follow-up-models';
import {
  normalizeQuestionText,
  type AnalysisSession,
  validateQuestionText,
} from '@/domain/analysis-session/models';
import {
  assertOntologyVersionBindingIsPublished,
  createOntologyVersionBinding,
  getPlanOntologyVersionId,
  resolveOntologyVersionBindingSource,
} from '@/domain/ontology/version-binding';
import type { OntologyVersionStore } from '@/application/ontology/ports';

import type { AnalysisSessionFollowUpStore } from './ports';

export class InvalidAnalysisFollowUpQuestionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAnalysisFollowUpQuestionError';
  }
}

export class MissingAnalysisConclusionForFollowUpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissingAnalysisConclusionForFollowUpError';
  }
}

export class InvalidAnalysisFollowUpAdjustmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAnalysisFollowUpAdjustmentError';
  }
}

export class AnalysisFollowUpConflictError extends Error {
  constructor(
    message: string,
    public readonly conflicts: ReturnType<
      typeof analyzeFollowUpContextAdjustment
    >['conflicts'],
  ) {
    super(message);
    this.name = 'AnalysisFollowUpConflictError';
  }
}

export class InvalidAnalysisFollowUpReplanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAnalysisFollowUpReplanError';
  }
}

export function createAnalysisFollowUpUseCases({
  followUpStore,
  ontologyVersionStore,
}: {
  followUpStore: AnalysisSessionFollowUpStore;
  ontologyVersionStore?: Pick<OntologyVersionStore, 'findById'>;
}) {
  async function assertPublishedBinding(
    binding: AnalysisSessionFollowUp['ontologyVersionBinding'],
  ) {
    if (!binding.ontologyVersionId || !ontologyVersionStore) {
      return;
    }

    const version = await ontologyVersionStore.findById(binding.ontologyVersionId);
    assertOntologyVersionBindingIsPublished({
      ontologyVersionId: binding.ontologyVersionId,
      version,
    });
  }

  return {
    async createFollowUp({
      session,
      questionText,
      currentContextReadModel,
      latestSnapshot,
      baseFollowUp,
      baseExecutionSnapshot,
    }: {
      session: AnalysisSession;
      questionText: string;
      currentContextReadModel: AnalysisContextReadModel;
      latestSnapshot: AnalysisExecutionSnapshot | null;
      baseFollowUp?: AnalysisSessionFollowUp | null;
      baseExecutionSnapshot?: AnalysisExecutionSnapshot | null;
    }) {
      const validationMessage = validateQuestionText(questionText);

      if (validationMessage) {
        throw new InvalidAnalysisFollowUpQuestionError(validationMessage);
      }

      const latestConclusion = latestSnapshot?.conclusionState?.causes?.[0] ?? null;
      const baseConclusion =
        baseExecutionSnapshot?.conclusionState?.causes?.[0] ?? null;
      const inheritedContext =
        baseFollowUp?.mergedContext ?? currentContextReadModel.context;
      const referencedExecutionId =
        baseExecutionSnapshot?.executionId ??
        baseFollowUp?.referencedExecutionId ??
        latestSnapshot?.executionId ??
        null;
      const referencedConclusionTitle =
        baseConclusion?.title ??
        baseFollowUp?.referencedConclusionTitle ??
        latestConclusion?.title ??
        null;
      const referencedConclusionSummary =
        baseConclusion?.summary ??
        baseFollowUp?.referencedConclusionSummary ??
        latestConclusion?.summary ??
        null;
      const inheritedOntologyVersionId =
        baseExecutionSnapshot?.ontologyVersionId ??
        baseFollowUp?.ontologyVersionId ??
        latestSnapshot?.ontologyVersionId ??
        null;
      const ontologyVersionBinding = createOntologyVersionBinding(
        inheritedOntologyVersionId,
        'inherited',
      );

      if (
        !referencedExecutionId ||
        (!referencedConclusionTitle && !referencedConclusionSummary)
      ) {
        throw new MissingAnalysisConclusionForFollowUpError(
          '当前会话还没有可承接的既有结论，无法发起追问。',
        );
      }

      const normalizedQuestionText = normalizeQuestionText(questionText);
      const timestamp = new Date().toISOString();
      await assertPublishedBinding(ontologyVersionBinding);
      const followUp: AnalysisSessionFollowUp = {
        id: randomUUID(),
        sessionId: session.id,
        ownerUserId: session.ownerUserId,
        questionText: normalizedQuestionText,
        parentFollowUpId: baseFollowUp?.id ?? null,
        referencedExecutionId,
        referencedConclusionTitle,
        referencedConclusionSummary,
        resultExecutionId: null,
        ontologyVersionId: ontologyVersionBinding.ontologyVersionId,
        ontologyVersionBinding,
        inheritedContext,
        mergedContext: mergeFollowUpContext({
          inheritedContext,
          followUpQuestionText: normalizedQuestionText,
        }),
        planVersion: null,
        currentPlanSnapshot: null,
        previousPlanSnapshot: null,
        currentPlanDiff: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      return await followUpStore.create(followUp);
    },

    async listOwnedFollowUps({
      sessionId,
      ownerUserId,
    }: {
      sessionId: string;
      ownerUserId: string;
    }) {
      return await followUpStore.listBySessionId({
        sessionId,
        ownerUserId,
      });
    },

    async getOwnedFollowUp({
      followUpId,
      ownerUserId,
    }: {
      followUpId: string;
      ownerUserId: string;
    }) {
      return await followUpStore.getById({
        followUpId,
        ownerUserId,
      });
    },

    validateAdjustmentInput(input: {
      targetMetric?: string | null;
      entity?: string | null;
      timeRange?: string | null;
      comparison?: string | null;
      factor?: string | null;
    }): FollowUpContextAdjustment {
      const correctionPayload: Record<string, { value: string }> = {};

      (['targetMetric', 'entity', 'timeRange', 'comparison'] as const).forEach(
        (field) => {
          const value = input[field]?.trim();

          if (!value) {
            return;
          }

          correctionPayload[field] = {
            value,
          };
        },
      );

      const factor = input.factor?.trim() || null;

      if (Object.keys(correctionPayload).length === 0 && !factor) {
        throw new InvalidAnalysisFollowUpAdjustmentError(
          '至少需要补充一个因素或范围条件。',
        );
      }

      return {
        correction:
          Object.keys(correctionPayload).length > 0
            ? validateContextCorrection(correctionPayload)
            : {},
        factor,
      };
    },

    async adjustFollowUpContext({
      followUp,
      adjustment,
      confirmConflicts,
    }: {
      followUp: AnalysisSessionFollowUp;
      adjustment: FollowUpContextAdjustment;
      confirmConflicts: boolean;
    }) {
      const analysis = analyzeFollowUpContextAdjustment({
        currentContext: followUp.mergedContext,
        adjustment,
      });

      if (analysis.conflicts.length > 0 && !confirmConflicts) {
        throw new AnalysisFollowUpConflictError(
          '发现冲突条件，确认后才会覆盖当前轮次上下文。',
          analysis.conflicts,
        );
      }

      const mergedContext = applyFollowUpContextAdjustment({
        currentContext: followUp.mergedContext,
        adjustment,
      });
      const contextChanged =
        JSON.stringify(mergedContext) !== JSON.stringify(followUp.mergedContext);
      const updatedAt = new Date().toISOString();
      const updatedFollowUp = await followUpStore.updateMergedContext({
        followUpId: followUp.id,
        ownerUserId: followUp.ownerUserId,
        mergedContext,
        updatedAt,
        planVersion: followUp.planVersion,
        currentPlanSnapshot: contextChanged ? null : undefined,
        previousPlanSnapshot:
          contextChanged && followUp.currentPlanSnapshot
            ? followUp.currentPlanSnapshot
            : undefined,
        currentPlanDiff: contextChanged ? null : undefined,
      });

      if (!updatedFollowUp) {
        throw new InvalidAnalysisFollowUpAdjustmentError(
          '追问上下文更新失败，请稍后重试。',
        );
      }

      return {
        followUp: updatedFollowUp,
        diff: buildFollowUpContextDiff({
          inheritedContext: updatedFollowUp.inheritedContext,
          mergedContext: updatedFollowUp.mergedContext,
        }),
      };
    },

    async updateFollowUpPlan({
      followUp,
      previousPlanSnapshot,
      nextPlanSnapshot,
      planDiff,
    }: {
      followUp: AnalysisSessionFollowUp;
      previousPlanSnapshot: AnalysisPlan;
      nextPlanSnapshot: AnalysisPlan;
      planDiff: AnalysisPlanDiff;
    }) {
      const updatedAt = new Date().toISOString();
      const planVersion =
        followUp.planVersion === null ? 2 : followUp.planVersion + 1;
      const nextOntologyVersionId =
        getPlanOntologyVersionId(nextPlanSnapshot) ?? followUp.ontologyVersionId;
      const ontologyVersionBinding = createOntologyVersionBinding(
        nextOntologyVersionId,
        resolveOntologyVersionBindingSource({
          previousOntologyVersionId: followUp.ontologyVersionId,
          nextOntologyVersionId,
        }),
      );
      await assertPublishedBinding(ontologyVersionBinding);
      const updatedFollowUp = await followUpStore.updatePlanState({
        followUpId: followUp.id,
        ownerUserId: followUp.ownerUserId,
        planVersion,
        currentPlanSnapshot: nextPlanSnapshot,
        previousPlanSnapshot,
        currentPlanDiff: planDiff,
        ontologyVersionId: ontologyVersionBinding.ontologyVersionId,
        ontologyVersionBinding,
        updatedAt,
      });

      if (!updatedFollowUp) {
        throw new InvalidAnalysisFollowUpReplanError(
          '重规划结果保存失败，请稍后重试。',
        );
      }

      return updatedFollowUp;
    },

    async attachFollowUpExecution({
      followUpId,
      ownerUserId,
      executionId,
    }: {
      followUpId: string;
      ownerUserId: string;
      executionId: string;
    }) {
      return await followUpStore.attachResultExecution({
        followUpId,
        ownerUserId,
        resultExecutionId: executionId,
        updatedAt: new Date().toISOString(),
      });
    },
  };
}
