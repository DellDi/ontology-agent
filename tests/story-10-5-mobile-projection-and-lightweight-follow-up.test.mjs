import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

async function runTsSnippet(code) {
  const { stdout } = await execFileAsync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', code],
    {
      cwd: projectRoot,
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--conditions=react-server']
          .filter(Boolean)
          .join(' '),
      },
    },
  );

  const trimmed = stdout.trim();
  if (!trimmed) return null;
  return JSON.parse(trimmed.split('\n').pop() ?? 'null');
}

const MOBILE_IMPORT = `
  import mobileAnalysisModule from './src/application/mobile-analysis/index.ts';
  import runtimeModule from './src/application/ai-runtime/index.ts';
  const {
    MOBILE_ANALYSIS_ALLOWED_RUNTIME_PART_KINDS,
    MOBILE_ANALYSIS_PROJECTION_VERSION,
    buildMobileAnalysisProjection,
    evaluateMobileLightweightFollowUp,
  } = mobileAnalysisModule;
  const { buildAiRuntimeProjection } = runtimeModule;
`;

function buildEvents({ status = 'processing' } = {}) {
  return [
    {
      id: 'evt-1',
      sessionId: 'session-10-5',
      executionId: 'exec-10-5',
      sequence: 1,
      kind: 'execution-status',
      timestamp: '2026-05-10T00:00:00.000Z',
      status,
      message: '移动端投影测试执行中',
      renderBlocks: [],
    },
    {
      id: 'evt-2',
      sessionId: 'session-10-5',
      executionId: 'exec-10-5',
      sequence: 2,
      kind: 'stage-result',
      timestamp: '2026-05-10T00:00:01.000Z',
      message: '关键证据已归集',
      step: {
        id: 'step-1',
        order: 1,
        title: '归集关键证据',
        status: 'completed',
      },
      renderBlocks: [
        {
          type: 'evidence-card',
          title: '关键证据',
          summary: '收费下降与投诉上升同时出现。',
          evidence: [
            { label: '收费', summary: '收费率下降 12%' },
            { label: '投诉', summary: '投诉量上升 18%' },
            { label: '满意度', summary: '满意度下降 9%' },
          ],
          confidence: 0.82,
        },
        {
          type: 'chart',
          title: 'PC 专用趋势图',
          chartType: 'line',
          series: [
            {
              name: '投诉量',
              points: [
                { label: '周一', value: 12 },
                { label: '周二', value: 18 },
              ],
            },
          ],
        },
      ],
      metadata: {
        conclusionText: '物业服务响应变慢',
        conclusionSummary: '物业服务响应变慢是当前最可能原因。',
        conclusionConfidence: 0.82,
        conclusionEvidence: [
          { label: '收费', summary: '收费率下降 12%' },
          { label: '投诉', summary: '投诉量上升 18%' },
        ],
      },
    },
  ];
}

const SHARED_INPUT = `
  const viewer = {
    userId: 'owner-10-5',
    displayName: '移动端负责人',
    scope: {
      organizationId: 'org-10-5',
      projectIds: ['project-a'],
      areaIds: ['area-a'],
      roleCodes: ['PROPERTY_ANALYST'],
    },
  };
  const session = {
    id: 'session-10-5',
    ownerUserId: 'owner-10-5',
    organizationId: 'org-10-5',
    projectIds: ['project-a'],
    areaIds: ['area-a'],
    questionText: '为什么项目 A 的收费率下降了？',
    savedContext: {
      targetMetric: { value: '收费率', confidence: 0.9 },
      entity: { value: '项目 A', confidence: 0.9 },
      timeRange: { value: '近三个月', confidence: 0.8 },
      comparison: { value: '环比', confidence: 0.8 },
      constraints: [],
    },
    status: 'pending',
    createdAt: '2026-05-10T00:00:00.000Z',
    updatedAt: '2026-05-10T00:00:02.000Z',
  };
  const historyReadModel = {
    latestRoundId: 'follow-up-1',
    selectedRound: null,
    rounds: [
      {
        id: 'session-root',
        kind: 'initial',
        label: '初始分析',
        questionText: session.questionText,
        createdAt: session.createdAt,
        followUpId: null,
        executionId: 'exec-root',
        status: 'completed',
        conclusionTitle: '物业服务响应变慢',
        conclusionSummary: '物业服务响应变慢是当前最可能原因。',
        isLatest: false,
      },
      {
        id: 'follow-up-1',
        kind: 'follow-up',
        label: '第 1 轮追问',
        questionText: '继续解释投诉证据',
        createdAt: '2026-05-10T00:00:03.000Z',
        followUpId: 'follow-up-1',
        executionId: 'exec-10-5',
        status: 'processing',
        conclusionTitle: '投诉集中在维修响应',
        conclusionSummary: '投诉主要集中在维修响应慢。',
        isLatest: true,
      },
    ],
  };
`;

test('Story 10.5 AC1/AC2 | mobile 从同源 interaction schema 生成受限摘要投影，不透出 PC-only rich blocks', async () => {
  const result = await runTsSnippet(`
    ${MOBILE_IMPORT}
    ${SHARED_INPUT}
    const events = ${JSON.stringify(buildEvents())};
    const runtimeProjection = buildAiRuntimeProjection({
      sessionId: 'session-10-5',
      executionId: 'exec-10-5',
      events,
    });
    const mobile = buildMobileAnalysisProjection({
      viewer,
      session,
      runtimeProjection,
      resumeCursor: { lastSequence: 2, lastEventId: 'evt-2' },
      historyReadModel,
      pcWorkspaceUrl: '/workspace/analysis/session-10-5',
      followUpActionUrl: '/api/mobile/analysis/sessions/session-10-5/follow-ups',
    });
    console.log(JSON.stringify({
      version: mobile.version,
      schemaVersion: mobile.schemaVersion,
      contractVersion: mobile.contractVersion,
      allowedRuntimeKinds: MOBILE_ANALYSIS_ALLOWED_RUNTIME_PART_KINDS,
      pcPartKinds: runtimeProjection.messages[0].parts.map((part) => part.kind),
      mobilePartKinds: mobile.summaryProjection.parts.map((part) => part.kind),
      evidenceBlockKinds: mobile.summaryProjection.parts
        .filter((part) => part.kind === 'evidence-card')
        .flatMap((part) => part.blocks.map((block) => block.kind)),
      currentConclusion: mobile.summaryProjection.currentConclusion,
      keyEvidence: mobile.summaryProjection.keyEvidence,
      lastUpdatedAt: mobile.summaryProjection.lastUpdatedAt,
      historyCount: mobile.summaryProjection.minimalHistoryContext.length,
    }));
  `);

  assert.equal(result.version, 1);
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.contractVersion, 1);
  assert.deepEqual(result.allowedRuntimeKinds, [
    'status-banner',
    'evidence-card',
    'conclusion-card',
    'resume-anchor',
  ]);
  assert.ok(result.pcPartKinds.includes('step-timeline'));
  assert.deepEqual(result.mobilePartKinds, [
    'status-banner',
    'evidence-card',
    'conclusion-card',
    'resume-anchor',
  ]);
  assert.deepEqual(result.evidenceBlockKinds, ['evidence-card']);
  assert.equal(result.currentConclusion.title, '物业服务响应变慢');
  assert.equal(result.keyEvidence.length, 2);
  assert.equal(result.lastUpdatedAt, '2026-05-10T00:00:02.000Z');
  assert.equal(result.historyCount, 2);
});

test('Story 10.5 AC3 | mobile resume 使用共享 cursor 与 resume-anchor，缺失恢复锚点必须 fail loud', async () => {
  const result = await runTsSnippet(`
    ${MOBILE_IMPORT}
    ${SHARED_INPUT}
    const runtimeProjection = buildAiRuntimeProjection({
      sessionId: 'session-10-5',
      executionId: 'exec-10-5',
      events: ${JSON.stringify(buildEvents())},
    });
    const mobile = buildMobileAnalysisProjection({
      viewer,
      session,
      runtimeProjection,
      resumeCursor: { lastSequence: 2, lastEventId: 'evt-2' },
      historyReadModel,
      pcWorkspaceUrl: '/workspace/analysis/session-10-5',
      followUpActionUrl: '/api/mobile/analysis/sessions/session-10-5/follow-ups',
    });
    let missingAnchorError = '';
    try {
      buildMobileAnalysisProjection({
        viewer,
        session,
        runtimeProjection: {
          ...runtimeProjection,
          messages: runtimeProjection.messages.map((message) => ({
            ...message,
            parts: message.parts.filter((part) => part.kind !== 'resume-anchor'),
          })),
        },
        resumeCursor: { lastSequence: 2, lastEventId: 'evt-2' },
        historyReadModel,
        pcWorkspaceUrl: '/workspace/analysis/session-10-5',
        followUpActionUrl: '/api/mobile/analysis/sessions/session-10-5/follow-ups',
      });
    } catch (error) {
      missingAnchorError = error.message;
    }
    console.log(JSON.stringify({
      resumeProjection: mobile.resumeProjection,
      missingAnchorError,
    }));
  `);

  assert.equal(result.resumeProjection.sessionId, 'session-10-5');
  assert.equal(result.resumeProjection.executionId, 'exec-10-5');
  assert.equal(result.resumeProjection.lastSequence, 2);
  assert.equal(result.resumeProjection.lastEventId, 'evt-2');
  assert.equal(result.resumeProjection.resumeMode, 'continue-stream');
  assert.equal(result.resumeProjection.latestRoundId, 'follow-up-1');
  assert.match(result.missingAnchorError, /resume-anchor/);
});

test('Story 10.5 AC4 | mobile 轻量追问只允许短小局部下钻，复杂计划编辑明确引导 PC', async () => {
  const result = await runTsSnippet(`
    ${MOBILE_IMPORT}
    const allowed = evaluateMobileLightweightFollowUp({
      questionText: '继续解释投诉证据',
      pcWorkspaceUrl: '/workspace/analysis/session-10-5',
    });
    const blockedComplex = evaluateMobileLightweightFollowUp({
      questionText: '帮我重写整个分析计划并审批工具调用',
      pcWorkspaceUrl: '/workspace/analysis/session-10-5',
    });
    const blockedLong = evaluateMobileLightweightFollowUp({
      questionText: '请'.repeat(130),
      pcWorkspaceUrl: '/workspace/analysis/session-10-5',
    });
    console.log(JSON.stringify({ allowed, blockedComplex, blockedLong }));
  `);

  assert.equal(result.allowed.allowed, true);
  assert.equal(result.allowed.normalizedQuestionText, '继续解释投诉证据');
  assert.equal(result.blockedComplex.allowed, false);
  assert.match(result.blockedComplex.message, /PC/);
  assert.equal(result.blockedComplex.pcWorkspaceUrl, '/workspace/analysis/session-10-5');
  assert.equal(result.blockedLong.allowed, false);
  assert.match(result.blockedLong.message, /120/);
});

test('Story 10.5 AC5 | mobile projection 继续执行 owner 与 scope 服务端校验', async () => {
  const result = await runTsSnippet(`
    ${MOBILE_IMPORT}
    ${SHARED_INPUT}
    const runtimeProjection = buildAiRuntimeProjection({
      sessionId: 'session-10-5',
      executionId: 'exec-10-5',
      events: ${JSON.stringify(buildEvents())},
    });
    let ownerError = '';
    try {
      buildMobileAnalysisProjection({
        viewer: { ...viewer, userId: 'foreign-owner' },
        session,
        runtimeProjection,
        resumeCursor: { lastSequence: 2, lastEventId: 'evt-2' },
        historyReadModel,
        pcWorkspaceUrl: '/workspace/analysis/session-10-5',
        followUpActionUrl: '/api/mobile/analysis/sessions/session-10-5/follow-ups',
      });
    } catch (error) {
      ownerError = error.message;
    }
    let scopeError = '';
    try {
      buildMobileAnalysisProjection({
        viewer: {
          ...viewer,
          scope: { ...viewer.scope, projectIds: ['project-b'] },
        },
        session,
        runtimeProjection,
        resumeCursor: { lastSequence: 2, lastEventId: 'evt-2' },
        historyReadModel,
        pcWorkspaceUrl: '/workspace/analysis/session-10-5',
        followUpActionUrl: '/api/mobile/analysis/sessions/session-10-5/follow-ups',
      });
    } catch (error) {
      scopeError = error.message;
    }
    console.log(JSON.stringify({ ownerError, scopeError }));
  `);

  assert.match(result.ownerError, /会话不存在或无权访问/);
  assert.match(result.scopeError, /会话不存在或无权访问/);
});
