import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
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

const INTERACTION_IMPORT = `
  import interactionModule from './src/application/analysis-interaction/index.ts';
  import streamModule from './src/domain/analysis-execution/stream-models.ts';
  const {
    ANALYSIS_INTERACTION_PART_SCHEMA_VERSION,
    createDefaultAnalysisRendererRegistry,
    getDefaultAnalysisRendererRegistry,
    normalizeExecutionRenderBlock,
    normalizeExecutionRenderBlocks,
    projectAnalysisInteractionPart,
    renderAnalysisInteractionPart,
  } = interactionModule;
  const { validateAnalysisExecutionStreamEvent } = streamModule;
`;

const UI_RENDERER_IMPORT = `
  import rendererModule from './src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-interaction-rendered-block.tsx';
  import uiRegistryModule from './src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-interaction-ui-renderer-registry.tsx';
  const { getToolStatusLabel } = rendererModule;
  const {
    getDefaultAnalysisInteractionUiRendererRegistry,
  } = uiRegistryModule;
`;

function source(overrides = {}) {
  return {
    sourceType: 'execution-render-block',
    sessionId: 'session-10-2',
    executionId: 'exec-10-2',
    eventId: 'evt-1',
    sequence: 7,
    blockIndex: 0,
    ...overrides,
  };
}

test('统一 part schema 规范化当前 renderBlocks 与富分析块，携带版本、source、surface hints 与诊断字段', async () => {
  const result = await runTsSnippet(`
    ${INTERACTION_IMPORT}
    const blocks = [
      {
        type: 'status',
        title: '执行状态',
        value: '执行中',
        tone: 'info',
      },
      {
        type: 'table',
        title: '原因排序',
        columns: ['原因', '证据'],
        rows: [['需求下滑', '投诉上升']],
      },
      {
        type: 'chart',
        title: '投诉趋势',
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
      {
        type: 'graph',
        title: '因果图谱',
        nodes: [
          { id: 'complaint', label: '投诉量', kind: 'metric' },
          { id: 'service', label: '服务响应', kind: 'factor' },
        ],
        edges: [
          { source: 'service', target: 'complaint', label: '影响' },
        ],
      },
      {
        type: 'approval-state',
        title: '审批状态',
        state: 'pending',
        owner: '运营主管',
        reason: '等待确认自动执行计划',
      },
      {
        type: 'skills-state',
        title: 'Skills 状态',
        items: [
          { skillName: '物业收费分析', status: 'ready', summary: '可用' },
        ],
      },
    ];

    const parts = normalizeExecutionRenderBlocks(blocks, ${JSON.stringify(source())});
    console.log(JSON.stringify({
      version: ANALYSIS_INTERACTION_PART_SCHEMA_VERSION,
      kinds: parts.map((part) => part.kind),
      ids: parts.map((part) => part.id),
      sourceTypes: parts.map((part) => part.source.sourceType),
      surfaces: parts.map((part) => part.surfaceHints.supportedSurfaces),
      hasDiagnostics: parts.every((part) => part.diagnostics && typeof part.diagnostics.originalType === 'string'),
      chartPayload: parts.find((part) => part.kind === 'chart')?.payload,
      graphPayload: parts.find((part) => part.kind === 'graph')?.payload,
    }));
  `);

  assert.equal(result.version, 1);
  assert.deepEqual(result.kinds, [
    'status',
    'table',
    'chart',
    'graph',
    'approval-state',
    'skills-state',
  ]);
  assert.equal(new Set(result.ids).size, result.ids.length);
  assert.ok(result.sourceTypes.every((value) => value === 'execution-render-block'));
  assert.ok(
    result.surfaces.every(
      (surfaces) => surfaces.includes('workspace') && surfaces.includes('mobile'),
    ),
  );
  assert.equal(result.hasDiagnostics, true);
  assert.equal(result.chartPayload.chartType, 'line');
  assert.equal(result.graphPayload.nodes.length, 2);
});

test('stream event 验证正式支持富分析 renderBlocks，但非法 schema 必须 fail loud', async () => {
  const result = await runTsSnippet(`
    ${INTERACTION_IMPORT}
    const event = {
      id: 'evt-rich',
      sessionId: 'session-10-2',
      executionId: 'exec-10-2',
      sequence: 1,
      kind: 'stage-result',
      timestamp: '2026-05-05T00:00:00.000Z',
      renderBlocks: [
        {
          type: 'evidence-card',
          title: '关键证据',
          summary: '收费下降与投诉上升同时出现。',
          evidence: [{ label: '收费', summary: '下降 12%' }],
          confidence: 0.78,
        },
        {
          type: 'timeline',
          title: '执行节点',
          items: [{ id: 'node-1', title: '读取指标', status: 'completed' }],
        },
      ],
    };
    const validated = validateAnalysisExecutionStreamEvent(event);

    let invalidError = '';
    try {
      validateAnalysisExecutionStreamEvent({
        ...event,
        id: 'evt-invalid',
        renderBlocks: [{ type: 'chart', title: '坏图表', chartType: 'line', series: [] }],
      });
    } catch (error) {
      invalidError = error.message;
    }

    console.log(JSON.stringify({
      blockTypes: validated.renderBlocks.map((block) => block.type),
      invalidError,
    }));
  `);

  assert.deepEqual(result.blockTypes, ['evidence-card', 'timeline']);
  assert.match(result.invalidError, /chart\.series 必须至少包含一个序列/);
});

test('renderer registry 支持 register/resolve/render/project/fallback，未知或 surface 不支持必须显式 fallback', async () => {
  const result = await runTsSnippet(`
    ${INTERACTION_IMPORT}
    const registry = createDefaultAnalysisRendererRegistry();
    const knownPart = normalizeExecutionRenderBlock({
      type: 'markdown',
      title: '推理摘要',
      content: '分析收费下降原因。',
    }, ${JSON.stringify(source())});
    const rendered = registry.render(knownPart, { surface: 'workspace' });
    const projected = registry.project(knownPart, { surface: 'mobile' });
    const fallbackUnknown = registry.render({
      ...knownPart,
      id: 'unknown-part',
      kind: 'unknown-kind',
      payload: { raw: true },
      diagnostics: { originalType: 'unknown-kind' },
    }, { surface: 'workspace' });

    registry.register({
      kind: 'workspace-only',
      maturity: 'phase-a',
      supportedSurfaces: ['workspace'],
      render: (part, context) => ({
        kind: part.kind,
        surface: context.surface,
        title: part.title,
        variant: 'custom',
        payload: part.payload,
        diagnostics: part.diagnostics,
      }),
      project: (part, context) => ({ ...part, surfaceHints: { supportedSurfaces: [context.surface] } }),
    });
    const workspaceOnly = {
      ...knownPart,
      id: 'workspace-only-part',
      kind: 'workspace-only',
      surfaceHints: { supportedSurfaces: ['workspace'] },
    };
    const unsupportedSurface = registry.render(workspaceOnly, { surface: 'mobile' });

    console.log(JSON.stringify({
      resolvedKind: registry.resolve('markdown')?.kind ?? null,
      rendered,
      projected: {
        kind: projected.kind,
        surfaceHints: projected.surfaceHints,
        payload: projected.payload,
        source: projected.source,
      },
      fallbackUnknown,
      unsupportedSurface,
    }));
  `);

  assert.equal(result.resolvedKind, 'markdown');
  assert.equal(result.rendered.kind, 'markdown');
  assert.equal(result.rendered.surface, 'workspace');
  assert.equal(result.projected.kind, 'markdown');
  assert.deepEqual(result.projected.source, result.rendered.source);
  assert.ok(result.projected.payload.content.length <= result.rendered.payload.content.length);
  assert.equal(result.fallbackUnknown.kind, 'fallback-block');
  assert.equal(result.fallbackUnknown.payload.originalKind, 'unknown-kind');
  assert.equal(result.unsupportedSurface.kind, 'fallback-block');
  assert.match(result.unsupportedSurface.payload.reason, /surface not supported/);
});

test('renderAnalysisInteractionPart 复用模块级默认 registry，避免流式块渲染时重复创建 Map', async () => {
  const result = await runTsSnippet(`
    ${INTERACTION_IMPORT}
    const first = getDefaultAnalysisRendererRegistry();
    const second = getDefaultAnalysisRendererRegistry();
    const part = normalizeExecutionRenderBlock({
      type: 'markdown',
      title: '推理摘要',
      content: '同一个默认 registry 应复用。',
    }, ${JSON.stringify(source())});
    const rendered = renderAnalysisInteractionPart(part, { surface: 'workspace' });
    console.log(JSON.stringify({
      sameReference: first === second,
      canRender: rendered.kind === 'markdown',
    }));
  `);

  assert.equal(result.sameReference, true);
  assert.equal(result.canRender, true);
});

test('PC 与 mobile 从同一 canonical part 投影，语义来源一致但密度不同', async () => {
  const result = await runTsSnippet(`
    ${INTERACTION_IMPORT}
    const part = normalizeExecutionRenderBlock({
      type: 'table',
      title: '原因排序',
      columns: ['排序', '原因', '关键证据'],
      rows: [
        ['1', '收费下降', '收费率下降 12%'],
        ['2', '投诉上升', '投诉量上升 18%'],
        ['3', '满意度下降', '满意度下降 9%'],
      ],
    }, ${JSON.stringify(source())});
    const workspace = projectAnalysisInteractionPart(part, { surface: 'workspace' });
    const mobile = projectAnalysisInteractionPart(part, { surface: 'mobile' });
    console.log(JSON.stringify({ workspace, mobile }));
  `);

  assert.equal(result.workspace.id, result.mobile.id);
  assert.equal(result.workspace.kind, result.mobile.kind);
  assert.deepEqual(result.workspace.source, result.mobile.source);
  assert.ok(result.workspace.payload.rows.length > result.mobile.payload.rows.length);
  assert.equal(result.mobile.projection.density, 'compact');
  assert.equal(result.workspace.projection.density, 'full');
});

test('工作台流式面板与结论面板不得继续复制页面级 block.type 分支渲染', async () => {
  const streamPanel = await readFile(
    resolve(
      projectRoot,
      'src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-execution-stream-panel.tsx',
    ),
    'utf8',
  );
  const conclusionPanel = await readFile(
    resolve(
      projectRoot,
      'src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-conclusion-panel.tsx',
    ),
    'utf8',
  );

  assert.doesNotMatch(streamPanel, /block\.type\s*===/);
  assert.doesNotMatch(conclusionPanel, /block\.type\s*===/);
  assert.match(streamPanel, /AnalysisInteractionRenderedBlock/);
  assert.match(conclusionPanel, /AnalysisInteractionRenderedBlock/);
  assert.match(streamPanel, /normalizeExecutionRenderBlock/);
  assert.match(conclusionPanel, /normalizeExecutionRenderBlock/);
});

test('AnalysisInteractionRenderedBlock 只委托 app 层 UI renderer registry，不再手写 kind 分支', async () => {
  const renderedBlockComponent = await readFile(
    resolve(
      projectRoot,
      'src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-interaction-rendered-block.tsx',
    ),
    'utf8',
  );
  const uiRegistry = await readFile(
    resolve(
      projectRoot,
      'src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-interaction-ui-renderer-registry.tsx',
    ),
    'utf8',
  );

  assert.doesNotMatch(renderedBlockComponent, /block\.kind\s*===/);
  assert.match(
    renderedBlockComponent,
    /getDefaultAnalysisInteractionUiRendererRegistry/,
  );
  assert.match(uiRegistry, /createDefaultAnalysisInteractionUiRendererRegistry/);
  assert.match(uiRegistry, /kind: 'chart'/);
  assert.match(uiRegistry, /kind: 'fallback-block'/);
});

test('app 层 UI renderer registry 支持 resolve/render/fallback 并复用默认实例', async () => {
  const result = await runTsSnippet(`
    ${UI_RENDERER_IMPORT}
    const first = getDefaultAnalysisInteractionUiRendererRegistry();
    const second = getDefaultAnalysisInteractionUiRendererRegistry();
    const known = first.resolve('chart');
    const fallback = first.resolve('fallback-block');
    const rendered = first.render({
      renderedBlock: {
        kind: 'chart',
        surface: 'workspace',
        title: '趋势',
        variant: 'chart',
        source: { sourceType: 'execution-render-block' },
        payload: {
          series: [{
            name: '投诉量',
            points: [{ label: '周一', value: 12 }],
          }],
        },
        diagnostics: { originalType: 'chart' },
      },
      className: 'mt-4',
    });
    const unknown = first.render({
      renderedBlock: {
        kind: 'unknown-rich-block',
        surface: 'workspace',
        title: '未知',
        variant: 'unknown',
        source: { sourceType: 'execution-render-block' },
        payload: { reason: 'test' },
        diagnostics: { originalType: 'unknown-rich-block' },
      },
    });
    console.log(JSON.stringify({
      sameReference: first === second,
      knownKind: known?.kind ?? null,
      fallbackKind: fallback?.kind ?? null,
      renderedType: typeof rendered,
      unknownType: typeof unknown,
    }));
  `);

  assert.equal(result.sameReference, true);
  assert.equal(result.knownKind, 'chart');
  assert.equal(result.fallbackKind, 'fallback-block');
  assert.equal(result.renderedType, 'object');
  assert.equal(result.unknownType, 'object');
});

test('tool-list renderer 必须把工具状态映射为中文产品文案', async () => {
  const result = await runTsSnippet(`
    ${UI_RENDERER_IMPORT}
    const statuses = ['completed', 'failed', 'running', 'selected'];
    console.log(JSON.stringify({
      labels: statuses.map((status) => getToolStatusLabel(status)),
    }));
  `);

  assert.deepEqual(result.labels, ['已完成', '已失败', '执行中', '已选择']);
});

test('evidence-card 与 skills-state 空数组必须 fail loud，避免渲染无语义空卡片', async () => {
  const result = await runTsSnippet(`
    ${INTERACTION_IMPORT}
    const baseEvent = {
      id: 'evt-empty',
      sessionId: 'session-10-2',
      executionId: 'exec-10-2',
      sequence: 2,
      kind: 'stage-result',
      timestamp: '2026-05-05T00:00:00.000Z',
      renderBlocks: [],
    };
    const errors = {};
    try {
      validateAnalysisExecutionStreamEvent({
        ...baseEvent,
        renderBlocks: [{
          type: 'evidence-card',
          title: '空证据',
          summary: '没有证据项。',
          evidence: [],
        }],
      });
      errors.evidence = 'SILENT-PASS';
    } catch (error) {
      errors.evidence = error.message;
    }
    try {
      validateAnalysisExecutionStreamEvent({
        ...baseEvent,
        renderBlocks: [{
          type: 'skills-state',
          title: '空 Skills',
          items: [],
        }],
      });
      errors.skills = 'SILENT-PASS';
    } catch (error) {
      errors.skills = error.message;
    }
    console.log(JSON.stringify(errors));
  `);

  assert.match(result.evidence, /evidence-card\.evidence 必须至少包含一个证据项/);
  assert.match(result.skills, /skills-state\.items 必须至少包含一个 skill 状态/);
});
