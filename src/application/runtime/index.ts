export * from './ports';
export * from './use-cases';

import {
  createRuntimeCapabilityApprovalAuditEvent,
  createRuntimeBridgeUseCases,
  createRuntimeCapabilityApprovalEnvelope,
} from './use-cases';

const runtimeApplicationModule = {
  createRuntimeCapabilityApprovalAuditEvent,
  createRuntimeBridgeUseCases,
  createRuntimeCapabilityApprovalEnvelope,
};

export default runtimeApplicationModule;
