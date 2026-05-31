import type {
  LlmContextExtractionInput,
  LlmContextExtractionOutput,
} from './schemas';

/**
 * 上下文抽取端口 — 由基础设施层（LLM 适配器）实现。
 */
export type ContextExtractionPort = {
  extract(
    input: LlmContextExtractionInput,
  ): Promise<LlmContextExtractionOutput>;
};
