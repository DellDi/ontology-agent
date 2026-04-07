export const ANALYSIS_TOOL_NAMES = [
  'llm.structured-analysis',
  'erp.read-model',
  'cube.semantic-query',
  'neo4j.graph-query',
  'platform.capability-status',
] as const;

export type AnalysisToolName = (typeof ANALYSIS_TOOL_NAMES)[number];

export type AnalysisToolRuntime = 'application' | 'worker' | 'shared';

export type AnalysisToolDefinition = {
  name: AnalysisToolName;
  title: string;
  description: string;
  runtime: AnalysisToolRuntime;
  availability: 'ready' | 'degraded';
  availabilityReason?: string;
  inputSchemaLabel: string;
  outputSchemaLabel: string;
};

export const ANALYSIS_TOOL_ERROR_CODES = [
  'tool-unavailable',
  'tool-validation-failed',
  'tool-timeout',
  'tool-permission-denied',
  'tool-provider-failed',
  'tool-empty-result',
] as const;

export type AnalysisToolErrorCode = (typeof ANALYSIS_TOOL_ERROR_CODES)[number];

export type AnalysisToolInvocationContext = {
  correlationId: string;
  source: 'application' | 'worker';
  sessionId?: string;
  userId?: string;
  organizationId?: string;
};

export type AnalysisToolInvocationError = {
  code: AnalysisToolErrorCode;
  message: string;
  toolName: AnalysisToolName;
  correlationId: string;
  retryable: boolean;
};

export type AnalysisToolInvocationSuccess = {
  ok: true;
  toolName: AnalysisToolName;
  correlationId: string;
  startedAt: string;
  finishedAt: string;
  output: unknown;
};

export type AnalysisToolInvocationFailure = {
  ok: false;
  toolName: AnalysisToolName;
  correlationId: string;
  startedAt: string;
  finishedAt: string;
  error: AnalysisToolInvocationError;
};

export type AnalysisToolInvocationResult =
  | AnalysisToolInvocationSuccess
  | AnalysisToolInvocationFailure;

export type ToolSelectionDecision = {
  toolName: AnalysisToolName;
  objective: string;
  confidence: number;
};

export type ToolSelectionResult = {
  strategy: string;
  tools: ToolSelectionDecision[];
};

export type OrchestrationStepSelection = {
  strategy: string;
  tools: ToolSelectionDecision[];
};

export type OrchestrationStepExecutionResult = {
  status: 'completed' | 'failed';
  strategy: string;
  tools: ToolSelectionDecision[];
  events: AnalysisToolInvocationResult[];
  error?: AnalysisToolInvocationError;
};
