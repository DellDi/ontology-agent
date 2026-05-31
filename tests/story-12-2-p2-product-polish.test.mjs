import test from 'node:test';
import assert from 'node:assert/strict';

const GATE_IMPORT = `
  import gateModule from './src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-auto-execute-gate.tsx';
  const {
    buildAnalysisAutoExecuteScopeKey,
    buildAnalysisAutoExecuteAttemptStorageKey,
    resolveAnalysisAutoExecuteAttempt,
    submitAnalysisAutoExecuteForm,
  } = gateModule;
`;

async function runTsSnippet(code) {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);

  const { stdout } = await execFileAsync(
    process.execPath,
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
  return JSON.parse(trimmed.split('\n').pop() ?? 'null');
}

// ---------------------------------------------------------------------------
// buildAnalysisAutoExecuteScopeKey
// ---------------------------------------------------------------------------

test('buildAnalysisAutoExecuteScopeKey — with followUpId', async () => {
  const result = await runTsSnippet(`
    ${GATE_IMPORT}
    console.log(JSON.stringify(buildAnalysisAutoExecuteScopeKey('session-1', 'followup-1')));
  `);
  assert.equal(result, 'session-1:followup-1');
});

test('buildAnalysisAutoExecuteScopeKey — without followUpId uses root', async () => {
  const result = await runTsSnippet(`
    ${GATE_IMPORT}
    console.log(JSON.stringify(buildAnalysisAutoExecuteScopeKey('session-1')));
  `);
  assert.equal(result, 'session-1:root');
});

test('buildAnalysisAutoExecuteScopeKey — undefined followUpId uses root', async () => {
  const result = await runTsSnippet(`
    ${GATE_IMPORT}
    console.log(JSON.stringify(buildAnalysisAutoExecuteScopeKey('session-1', undefined)));
  `);
  assert.equal(result, 'session-1:root');
});

// ---------------------------------------------------------------------------
// buildAnalysisAutoExecuteAttemptStorageKey
// ---------------------------------------------------------------------------

test('buildAnalysisAutoExecuteAttemptStorageKey — correct format', async () => {
  const result = await runTsSnippet(`
    ${GATE_IMPORT}
    console.log(JSON.stringify(buildAnalysisAutoExecuteAttemptStorageKey('session-1:root')));
  `);
  assert.equal(result, 'analysis-auto-execute-attempted:session-1:root');
});

// ---------------------------------------------------------------------------
// resolveAnalysisAutoExecuteAttempt
// ---------------------------------------------------------------------------

test('resolveAnalysisAutoExecuteAttempt — disabled returns skip-disabled', async () => {
  const result = await runTsSnippet(`
    ${GATE_IMPORT}
    console.log(JSON.stringify(resolveAnalysisAutoExecuteAttempt({
      enabled: false,
      lastSubmittedScope: null,
      executionScopeKey: 'session-1:root',
      sessionAttemptedValue: null,
    })));
  `);
  assert.equal(result, 'skip-disabled');
});

test('resolveAnalysisAutoExecuteAttempt — memory dedup returns skip-memory-dedup', async () => {
  const result = await runTsSnippet(`
    ${GATE_IMPORT}
    console.log(JSON.stringify(resolveAnalysisAutoExecuteAttempt({
      enabled: true,
      lastSubmittedScope: 'session-1:root',
      executionScopeKey: 'session-1:root',
      sessionAttemptedValue: null,
    })));
  `);
  assert.equal(result, 'skip-memory-dedup');
});

test('resolveAnalysisAutoExecuteAttempt — session dedup returns skip-session-dedup', async () => {
  const result = await runTsSnippet(`
    ${GATE_IMPORT}
    console.log(JSON.stringify(resolveAnalysisAutoExecuteAttempt({
      enabled: true,
      lastSubmittedScope: null,
      executionScopeKey: 'session-1:root',
      sessionAttemptedValue: '1',
    })));
  `);
  assert.equal(result, 'skip-session-dedup');
});

test('resolveAnalysisAutoExecuteAttempt — enabled with no dedup returns submit', async () => {
  const result = await runTsSnippet(`
    ${GATE_IMPORT}
    console.log(JSON.stringify(resolveAnalysisAutoExecuteAttempt({
      enabled: true,
      lastSubmittedScope: null,
      executionScopeKey: 'session-1:root',
      sessionAttemptedValue: null,
    })));
  `);
  assert.equal(result, 'submit');
});

test('resolveAnalysisAutoExecuteAttempt — different scope still submits', async () => {
  const result = await runTsSnippet(`
    ${GATE_IMPORT}
    console.log(JSON.stringify(resolveAnalysisAutoExecuteAttempt({
      enabled: true,
      lastSubmittedScope: 'session-1:root',
      executionScopeKey: 'session-1:followup-2',
      sessionAttemptedValue: null,
    })));
  `);
  assert.equal(result, 'submit');
});

test('resolveAnalysisAutoExecuteAttempt — disabled takes precedence over dedup', async () => {
  const result = await runTsSnippet(`
    ${GATE_IMPORT}
    console.log(JSON.stringify(resolveAnalysisAutoExecuteAttempt({
      enabled: false,
      lastSubmittedScope: 'session-1:root',
      executionScopeKey: 'session-1:root',
      sessionAttemptedValue: '1',
    })));
  `);
  assert.equal(result, 'skip-disabled');
});

// ---------------------------------------------------------------------------
// submitAnalysisAutoExecuteForm
// ---------------------------------------------------------------------------

test('submitAnalysisAutoExecuteForm — uses requestSubmit when available', async () => {
  const result = await runTsSnippet(`
    ${GATE_IMPORT}
    let called = '';
    const mock = {
      requestSubmit: () => { called = 'requestSubmit'; },
      submit: () => { called = 'submit'; },
    };
    submitAnalysisAutoExecuteForm(mock);
    console.log(JSON.stringify(called));
  `);
  assert.equal(result, 'requestSubmit');
});

test('submitAnalysisAutoExecuteForm — falls back to submit when requestSubmit missing', async () => {
  const result = await runTsSnippet(`
    ${GATE_IMPORT}
    let called = '';
    const mock = {
      submit: () => { called = 'submit'; },
    };
    submitAnalysisAutoExecuteForm(mock);
    console.log(JSON.stringify(called));
  `);
  assert.equal(result, 'submit');
});

// ---------------------------------------------------------------------------
// Module export surface
// ---------------------------------------------------------------------------

test('auto-execute gate module exports all required functions', async () => {
  const result = await runTsSnippet(`
    ${GATE_IMPORT}
    const fns = [
      typeof buildAnalysisAutoExecuteScopeKey,
      typeof buildAnalysisAutoExecuteAttemptStorageKey,
      typeof resolveAnalysisAutoExecuteAttempt,
      typeof submitAnalysisAutoExecuteForm,
    ];
    console.log(JSON.stringify(fns));
  `);
  assert.deepEqual(result, ['function', 'function', 'function', 'function']);
});
