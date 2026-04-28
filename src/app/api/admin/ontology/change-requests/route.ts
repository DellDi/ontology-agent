import { NextResponse } from 'next/server';

import {
  CHANGE_TYPES,
  COMPATIBILITY_TYPES,
  TARGET_OBJECT_TYPES,
} from '@/domain/ontology/governance';
import { auditUseCases } from '@/infrastructure/audit';
import { getOntologyAdminRuntime } from '@/infrastructure/ontology-admin';

import { authorizeGovernanceRequest, buildRedirect, describeGovernanceError } from '../_helpers';

function readString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

type JsonFieldResult =
  | { ok: true; value: Record<string, unknown> | null }
  | { ok: false; error: string };

/**
 * 读取并校验表单中的 JSON 字段（如 beforeSummary / afterSummary）。
 *
 * Story 9.5 Review 要求：无效 JSON 必须 fail loud，不能静默置空——否则会创建一条
 * 缺失差异摘要的 change request，审批人拿不到可复核的前/后对比。空串视为显式
 * 未填（返回 { ok: true, value: null }）；任何解析/类型错误都返回 { ok: false }。
 */
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
  const authResult = await authorizeGovernanceRequest('author');
  if (authResult instanceof NextResponse) return authResult;

  const { session } = authResult;
  const formData = await request.formData();

  const ontologyVersionId = readString(formData, 'ontologyVersionId');
  const targetObjectType = readString(formData, 'targetObjectType');
  const targetObjectKey = readString(formData, 'targetObjectKey');
  const changeType = readString(formData, 'changeType');
  const compatibilityType = readString(formData, 'compatibilityType');
  const title = readString(formData, 'title');

  /**
   * 提前失败的公共处理：写入 failed 审计 + 回传带 error 的重定向。
   * 用于必填字段缺失、枚举非法、JSON 解析失败等结构性输入错误。
   */
  const failFast = async (reason: string, message: string) => {
    await auditUseCases.recordEvent({
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

  const { governanceUseCases } = getOntologyAdminRuntime();

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

    await auditUseCases.recordEvent({
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
    await auditUseCases.recordEvent({
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
