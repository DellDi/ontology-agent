export * from './use-cases';

import {
  MOBILE_ANALYSIS_ALLOWED_RENDER_BLOCK_KINDS,
  MOBILE_ANALYSIS_ALLOWED_RUNTIME_PART_KINDS,
  MOBILE_ANALYSIS_PROJECTION_VERSION,
  MOBILE_LIGHTWEIGHT_FOLLOW_UP_MAX_LENGTH,
  buildMobileAnalysisProjection,
  evaluateMobileLightweightFollowUp,
} from './use-cases';

const mobileAnalysisModule = {
  MOBILE_ANALYSIS_ALLOWED_RENDER_BLOCK_KINDS,
  MOBILE_ANALYSIS_ALLOWED_RUNTIME_PART_KINDS,
  MOBILE_ANALYSIS_PROJECTION_VERSION,
  MOBILE_LIGHTWEIGHT_FOLLOW_UP_MAX_LENGTH,
  buildMobileAnalysisProjection,
  evaluateMobileLightweightFollowUp,
};

export default mobileAnalysisModule;
