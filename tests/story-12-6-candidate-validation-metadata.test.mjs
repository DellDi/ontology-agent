import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function runTsSnippet(code) {
  const { stdout } = await execFileAsync(
    'node',
    ['--import', 'tsx', '--input-type=module', '-e', code],
    {
      cwd: process.cwd(),
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
  const lastLine = trimmed.split('\n').pop() ?? '';
  return JSON.parse(lastLine);
}

test('Story 12.6 | 执行任务契约保留候选因素，供 worker 逐因素验证', async () => {
  const result = await runTsSnippet(`
    import modelsModule from './src/domain/analysis-execution/models.ts';
    const { validateAnalysisExecutionJobData } = modelsModule;
    const jobData = validateAnalysisExecutionJobData({
      sessionId: 'session-1',
      ownerUserId: 'owner-1',
      organizationId: 'org-1',
      projectIds: ['project-1'],
      areaIds: ['area-1'],
      followUpId: null,
      questionText: '分析收缴率异常原因',
      candidateFactors: [
        { key: 'receivable-factor', label: '应收余额变化', ignored: true },
      ],
      submittedAt: '2026-06-07T00:00:00.000Z',
      plan: {
        mode: 'multi-step',
        summary: '验证候选因素',
        steps: [
          {
            id: 'validate-candidate-factors',
            order: 1,
            title: '验证候选因素',
            objective: '逐项验证候选因素',
            dependencyIds: [],
          },
        ],
      },
    });
    console.log(JSON.stringify(jobData.candidateFactors));
  `);

  assert.deepEqual(result, [
    { key: 'receivable-factor', label: '应收余额变化' },
  ]);
});

test('Story 12.6 | 提交执行时把候选因素写入 job payload', async () => {
  const result = await runTsSnippet(`
    import submissionModule from './src/application/analysis-execution/submission-use-cases.ts';
    const { createAnalysisExecutionSubmissionUseCases } = submissionModule;
    let submittedData = null;
    const useCases = createAnalysisExecutionSubmissionUseCases({
      jobUseCases: {
        async submitJob(input) {
          submittedData = input.data;
          return {
            id: input.id ?? 'job-1',
            type: 'analysis-execution',
            status: 'pending',
            data: input.data,
            result: null,
            error: null,
            createdAt: '2026-06-07T00:00:00.000Z',
            updatedAt: '2026-06-07T00:00:00.000Z',
          };
        },
        async getJob() {
          return null;
        },
      },
    });
    await useCases.submitExecution({
      session: {
        id: 'session-1',
        ownerUserId: 'owner-1',
        organizationId: 'org-1',
        projectIds: ['project-1'],
        areaIds: ['area-1'],
        questionText: '分析收缴率异常原因',
        savedContext: {},
        status: 'pending',
        createdAt: '2026-06-07T00:00:00.000Z',
        updatedAt: '2026-06-07T00:00:00.000Z',
      },
      plan: {
        mode: 'multi-step',
        summary: '验证候选因素',
        steps: [
          {
            id: 'validate-candidate-factors',
            order: 1,
            title: '验证候选因素',
            objective: '逐项验证候选因素',
            dependencyIds: [],
          },
        ],
      },
      candidateFactors: [
        { key: 'work-order-factor', label: '工单响应时效' },
      ],
    });
    console.log(JSON.stringify(submittedData.candidateFactors));
  `);

  assert.deepEqual(result, [
    { key: 'work-order-factor', label: '工单响应时效' },
  ]);
});

test('Story 12.6 | renderer 为验证步骤 stage-result 写入 validatedFactors metadata', async () => {
  const result = await runTsSnippet(`
    import validationModule from './src/application/analysis-execution/candidate-factor-validation.ts';
    import rendererModule from './src/worker/analysis-execution-renderer.ts';
    const { deriveCandidateFactorValidations } = validationModule;
    const { buildStepResultEvent } = rendererModule;
    const stepResult = {
      status: 'completed',
      strategy: '测试策略',
      tools: [
        { toolName: 'neo4j.graph-query', objective: '验证候选因素', confidence: 0.9 },
      ],
      events: [
        {
          ok: true,
          toolName: 'neo4j.graph-query',
          correlationId: 'corr-1',
          startedAt: '2026-06-07T00:00:00.000Z',
          finishedAt: '2026-06-07T00:00:01.000Z',
          output: {
            factors: [
              {
                factorLabel: '应收余额变化',
                relationType: 'has-receivable',
                explanation: '应收余额变化与收缴率波动相关',
              },
            ],
          },
        },
      ],
    };
    const validatedFactors = deriveCandidateFactorValidations({
      candidateFactors: [
        { key: 'receivable-factor', label: '应收余额变化' },
        { key: 'service-order-factor', label: '工单响应时效' },
      ],
      result: stepResult,
    });
    const event = buildStepResultEvent({
      sessionId: 'session-1',
      executionId: 'exec-1',
      step: {
        id: 'validate-candidate-factors',
        order: 3,
        title: '验证候选因素',
      },
      result: stepResult,
      processedStepCount: 3,
      totalStepCount: 4,
      metadata: { validatedFactors },
    });
    console.log(JSON.stringify(event.metadata.validatedFactors));
  `);

  assert.equal(result.length, 2);
  assert.equal(result[0].factorKey, 'receivable-factor');
  assert.equal(result[0].status, 'supported');
  assert.match(result[0].note, /应收余额变化/);
  assert.equal(result[1].factorKey, 'service-order-factor');
  assert.equal(result[1].status, 'supported');
});

test('Story 12.6 | 工具明确空结果时逐因素标记为 not-supported', async () => {
  const result = await runTsSnippet(`
    import validationModule from './src/application/analysis-execution/candidate-factor-validation.ts';
    const { deriveCandidateFactorValidations } = validationModule;
    const validations = deriveCandidateFactorValidations({
      candidateFactors: [
        { key: 'complaint-factor', label: '投诉增长' },
      ],
      result: {
        status: 'completed',
        strategy: '测试策略',
        tools: [],
        events: [
          {
            ok: false,
            toolName: 'erp.read-model',
            correlationId: 'corr-1',
            startedAt: '2026-06-07T00:00:00.000Z',
            finishedAt: '2026-06-07T00:00:01.000Z',
            error: {
              code: 'tool-empty-result',
              message: '未查询到记录',
              toolName: 'erp.read-model',
              correlationId: 'corr-1',
              retryable: false,
            },
          },
        ],
      },
    });
    console.log(JSON.stringify(validations));
  `);

  assert.equal(result[0].status, 'not-supported');
  assert.match(result[0].note, /未返回/);
});
