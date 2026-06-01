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
  return JSON.parse(stdout.trim().split('\n').pop());
}

test('Phase 1b | translateEdgeKind translates all 9 edge kinds', async () => {
  const result = await runTsSnippet(`
    import m from './src/application/factor-expansion/graph-edge-translations.ts';
    const { translateEdgeKind } = m;
    console.log(JSON.stringify({
      contains: translateEdgeKind('contains'),
      belongsTo: translateEdgeKind('belongs-to'),
      hasOwner: translateEdgeKind('has-owner'),
      hasReceivable: translateEdgeKind('has-receivable'),
      hasPayment: translateEdgeKind('has-payment'),
      hasServiceOrder: translateEdgeKind('has-service-order'),
      hasComplaint: translateEdgeKind('has-complaint'),
      hasSatisfaction: translateEdgeKind('has-satisfaction'),
      causal: translateEdgeKind('causal'),
    }));
  `);
  assert.equal(result.contains, '包含');
  assert.equal(result.belongsTo, '所属');
  assert.equal(result.hasServiceOrder, '工单关联');
  assert.equal(result.causal, '因果关系');
});

test('Phase 1b | translateDirection translates all 3 directions', async () => {
  const result = await runTsSnippet(`
    import m from './src/application/factor-expansion/graph-edge-translations.ts';
    const { translateDirection } = m;
    console.log(JSON.stringify({
      outbound: translateDirection('outbound'),
      inbound: translateDirection('inbound'),
      undirected: translateDirection('undirected'),
    }));
  `);
  assert.equal(result.outbound, '外向');
  assert.equal(result.inbound, '内向');
  assert.equal(result.undirected, '无方向');
});

test('Phase 1b | translateEvidenceSource translates all 3 sources', async () => {
  const result = await runTsSnippet(`
    import m from './src/application/factor-expansion/graph-edge-translations.ts';
    const { translateEvidenceSource } = m;
    console.log(JSON.stringify({
      erpMaster: translateEvidenceSource('erp-master-data'),
      erpDerived: translateEvidenceSource('erp-derived'),
      governedRule: translateEvidenceSource('governed-rule'),
    }));
  `);
  assert.equal(result.erpMaster, 'ERP 主数据');
  assert.equal(result.erpDerived, 'ERP 派生');
  assert.equal(result.governedRule, '治理规则');
});

test('Phase 1b | unknown keys fall back to raw value', async () => {
  const result = await runTsSnippet(`
    import m from './src/application/factor-expansion/graph-edge-translations.ts';
    const { translateEdgeKind, translateDirection } = m;
    console.log(JSON.stringify({
      unknownEdge: translateEdgeKind('unknown-edge'),
      unknownDir: translateDirection('diagonal'),
    }));
  `);
  assert.equal(result.unknownEdge, 'unknown-edge');
  assert.equal(result.unknownDir, 'diagonal');
});
