import { NextResponse } from 'next/server';

import {
  CHANGE_TYPES,
  COMPATIBILITY_TYPES,
  TARGET_OBJECT_TYPES,
} from '@/domain/ontology/governance';
import {
  createCompositionRoot,
} from '@/composition-root';

import { authorizeGovernanceRequest, buildRedirect, describeGovernanceError } from '../_helpers';

function readString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

type JsonFieldResult =
  | { ok: true; value: Record<string, unknown> | null }
  | { ok: false; error: string };

function readJsonField(formData: FormData, key: string): JsonFieldResult {
  const raw = readString(formData, key);
  if (!raw) return { ok: true, value: null };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ok: true, value: parsed as Record<string, unknown> };
    }
    return {
      ok: false,
      error: `字段 "${key}" 必须是 JSON 对象（不能是数组或原始值）。`,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'JSON 解析失败。';
    return {
      ok: false,
      error: `字段 "${key}" JSON 解析失败：${detail}`,
    };
  }
}

function readImpactScope(formData: FormData): string[] {
  const raw = readString(formData, 'impactScope');
  if (!raw) return [];
  return raw
    .split(/[\n,]+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

export async function POST(request: Request) {
  const root = createCompositionRoot();
  const authResult = await authorizeGovernanceRequest(root, 'author');
  if (authResult instanceof NextResponse) return authResult;

  const { session } = authResult;
  const formData = await request.formData();

  const ontologyVersionId = readString(formData, 'ontologyVersionId');
  const targetObjectType = readString(formData, 'targetObjectType');
  const targetObjectKey = readString(formData, 'targetObjectKey');
  const changeType = readString(formData, 'changeType');
  const compatibilityType = readString(formData, 'compatibilityType');
  const title = readString(formData, 'title');

  const failFast = async (reason: string, message: string) => {
    await root.auditUseCases.recordEvent({
      userId: session.userId,
      organizationId: session.scope.organizationId,
      sessionId: session.sessionId,
      eventType: 'ontology.change_request.submitted',
      eventResult: 'failed',
      eventSource: 'route-handler',
      payload: {
        action: 'create',
        ontologyVersionId: ontologyVersionId || null,
        reason,
      },
    });
    const params = new URLSearchParams();
    params.set('error', message);
    return buildRedirect(request, '/admin/ontology/change-requests', params);
  };

  if (
    !ontologyVersionId ||
    !targetObjectKey ||
    !title ||
    !TARGET_OBJECT_TYPES.includes(targetObjectType as (typeof TARGET_OBJECT_TYPES)[number]) ||
    !CHANGE_TYPES.includes(changeType as (typeof CHANGE_TYPES)[number]) ||
    !COMPATIBILITY_TYPES.includes(compatibilityType as (typeof COMPATIBILITY_TYPES)[number])
  ) {
    return failFast('invalid-input', '提交失败：必填字段缺失或字段值非法。');
  }

  const beforeSummary = readJsonField(formData, 'beforeSummary');
  if (!beforeSummary.ok) {
    return failFast('invalid-before-summary', `提交失败：${beforeSummary.error}`);
  }
  const afterSummary = readJsonField(formData, 'afterSummary');
  if (!afterSummary.ok) {
    return failFast('invalid-after-summary', `提交失败：${afterSummary.error}`);
  }

  const { governanceUseCases } = root.ontologyAdminRuntime;

  try {
    const cr = await governanceUseCases.createChangeRequest({
      ontologyVersionId,
      targetObjectType: targetObjectType as (typeof TARGET_OBJECT_TYPES)[number],
      targetObjectKey,
      changeType: changeType as (typeof CHANGE_TYPES)[number],
      title,
      description: readString(formData, 'description') || null,
      beforeSummary: beforeSummary.value,
      afterSummary: afterSummary.value,
      impactScope: readImpactScope(formData),
      compatibilityType: compatibilityType as (typeof COMPATIBILITY_TYPES)[number],
      compatibilityNote: readString(formData, 'compatibilityNote') || null,
      submittedBy: session.userId,
    });

    await root.auditUseCases.recordEvent({
      userId: session.userId,
      organizationId: session.scope.organizationId,
      sessionId: session.sessionId,
      eventType: 'ontology.change_request.submitted',
      eventResult: 'succeeded',
      eventSource: 'route-handler',
      payload: {
        action: 'create',
        changeRequestId: cr.id,
        ontologyVersionId,
        targetObjectType,
        targetObjectKey,
        changeType,
        compatibilityType,
      },
    });

    const params = new URLSearchParams();
    params.set('ok', `变更申请已创建：${cr.title}`);
    return buildRedirect(request, `/admin/ontology/change-requests/${cr.id}`, params);
  } catch (error) {
    const desc = describeGovernanceError(error);
    await root.auditUseCases.recordEvent({
      userId: session.userId,
      organizationId: session.scope.organizationId,
      sessionId: session.sessionId,
      eventType: 'ontology.change_request.submitted',
      eventResult: 'failed',
      eventSource: 'route-handler',
      payload: {
        action: 'create',
        ontologyVersionId,
        reason: desc.reason,
      },
    });
    const params = new URLSearchParams();
    params.set('error', desc.message);
    return buildRedirect(request, '/admin/ontology/change-requests', params);
  }
}
