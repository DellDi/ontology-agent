package com.dip3.ontologyagent.agent;

import com.dip3.ontologyagent.config.ProviderCapabilityProperties;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.support.JsonCodec;
import com.dip3.ontologyagent.tooling.ConclusionProvider;
import com.dip3.ontologyagent.tooling.Evidence;
import com.dip3.ontologyagent.tooling.GroundedConclusion;
import com.dip3.ontologyagent.tooling.WorkflowRequest;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.client.advisor.StructuredOutputValidationAdvisor;
import org.springframework.ai.openai.OpenAiChatModel;
import org.springframework.ai.openai.OpenAiChatOptions;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.HashSet;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.math.BigDecimal;

@Component
public final class SpringAiConclusionProvider implements ConclusionProvider {
    private static final Set<String> REQUIRED_KINDS = Set.of(
            "collection-rate", "erp-balance", "charge-structure");
    private final ChatClient chat;
    private final JsonCodec json;
    private final ProviderCapabilityProperties provider;

    @Autowired
    public SpringAiConclusionProvider(ChatClient.Builder builder, JsonCodec json,
                                      ProviderCapabilityProperties provider) {
        this.chat = builder.build();
        this.json = json;
        this.provider = provider;
    }

    SpringAiConclusionProvider(ChatClient.Builder builder, JsonCodec json) {
        this(builder, json, new ProviderCapabilityProperties(
                ProviderCapabilityProperties.Mode.OPENAI_COMPATIBLE, true,
                ProviderCapabilityProperties.StructuredOutput.NATIVE_JSON_SCHEMA));
    }

    @Override
    public GroundedConclusion conclude(WorkflowRequest request, List<Evidence> evidence) {
        try {
            Map<String, Object> providerInput = new LinkedHashMap<>();
            providerInput.put("questionText", request.questionText());
            providerInput.put("entityKey", request.entityKey());
            providerInput.put("metricDefinitionKey", request.metricDefinitionKey());
            providerInput.put("metricVariantKey", request.metricVariantKey());
            providerInput.put("timeSemanticKey", request.timeSemanticKey());
            providerInput.put("projectIds", request.projectIds());
            providerInput.put("from", request.from().toString());
            providerInput.put("to", request.to().toString());
            providerInput.put("evidence", evidence);
            if (!request.referencedConclusion().isEmpty()) {
                providerInput.put("referencedConclusion", request.referencedConclusion());
            }
            ChatClient.ChatClientRequestSpec prompt = chat.prompt().system("""
                    你是分析工作流中的结论生成 Provider，不是 Agent。只能基于输入 evidence 归纳中文结论；
                    必须明确区分事实与推断，不得调用工具、不得补造数据、不得提出 evidence 中没有的数字；
                    Neo4j 证据仅表示收费项目与事实记录的结构关联，不能证明时间范围内的变化或因果关系。
                    只返回 JSON：{"claims":[{"kind":"collection-rate","evidenceRefs":[
                    {"source":"cube","row":0,"field":"value","value":12.3456}]}]}。
                    必须且只能返回 collection-rate、erp-balance、charge-structure 各一条：
                    collection-rate 引用 cube.value；erp-balance 引用同一 ERP 行的 projectName、receivableAmount、
                    paidAmount、arrearsAmount；charge-structure 引用同一 Neo4j 行的 rootLabel、factorLabel、factType、relationType。
                    服务端会基于引用字段生成最终文本。禁止输出 Markdown、额外字段或自由文本结论。
                    referencedConclusion 只用于理解本轮追问承接关系，不是新证据；所有 claim 仍必须完整引用本轮 evidence。
                    """).user(json.write(providerInput));
            if (provider.structuredOutput() == ProviderCapabilityProperties.StructuredOutput.JSON_OBJECT) {
                OpenAiChatOptions.Builder options = OpenAiChatOptions.builder();
                options.responseFormat(OpenAiChatModel.ResponseFormat.builder()
                        .type(OpenAiChatModel.ResponseFormat.Type.JSON_OBJECT).build());
                prompt = prompt.options(options);
            }
            ChatClient.CallResponseSpec response = prompt
                    .advisors(StructuredOutputValidationAdvisor.builder()
                            .outputType(ConclusionDraft.class).maxRepeatAttempts(0).build())
                    .call();
            ConclusionDraft draft = provider.structuredOutput()
                    == ProviderCapabilityProperties.StructuredOutput.NATIVE_JSON_SCHEMA
                    ? response.entity(ConclusionDraft.class, spec -> spec.useProviderStructuredOutput())
                    : response.entity(ConclusionDraft.class);
            if (draft == null) {
                throw new BackendException("PROVIDER_RESPONSE_INVALID", "LLM 返回了空结论。");
            }
            return validate(draft, evidence);
        } catch (BackendException error) {
            throw error;
        } catch (RuntimeException error) {
            throw new BackendException("LLM_CONCLUSION_FAILED", "LLM 结论生成失败。", error);
        }
    }

    private GroundedConclusion validate(ConclusionDraft draft, List<Evidence> evidence) {
        List<ClaimDraft> rows = draft.claims();
        if (rows == null || rows.isEmpty()) {
            throw new BackendException("PROVIDER_RESPONSE_INVALID", "LLM 结论不符合受控输出契约。");
        }
        List<GroundedConclusion.Claim> claims = new ArrayList<>();
        Set<String> referencedSources = new HashSet<>();
        Set<String> kinds = new HashSet<>();
        for (ClaimDraft row : rows) claims.add(claim(row, evidence, referencedSources, kinds));
        Set<String> expectedSources = new HashSet<>(evidence.stream().map(Evidence::source).toList());
        if (rows.size() != REQUIRED_KINDS.size() || !kinds.equals(REQUIRED_KINDS)
                || !referencedSources.equals(expectedSources)) {
            throw new BackendException("PROVIDER_EVIDENCE_UNGROUNDED", "LLM 结论类型或证据源不完整。");
        }
        return new GroundedConclusion(claims);
    }

    private GroundedConclusion.Claim claim(ClaimDraft row, List<Evidence> evidence, Set<String> referencedSources,
                                           Set<String> kinds) {
        if (row == null || row.kind() == null || !REQUIRED_KINDS.contains(row.kind())
                || row.evidenceRefs() == null || row.evidenceRefs().isEmpty()) {
            throw new BackendException("PROVIDER_RESPONSE_INVALID", "LLM claim 不符合受控输出契约。");
        }
        String kind = row.kind();
        if (!kinds.add(kind)) {
            throw new BackendException("PROVIDER_EVIDENCE_UNGROUNDED", "LLM 结论类型重复。");
        }
        List<GroundedConclusion.EvidenceReference> parsedRefs = row.evidenceRefs().stream()
                .map(ref -> reference(ref, evidence, referencedSources)).toList();
        return switch (kind) {
            case "collection-rate" -> canonical(parsedRefs, "cube", Set.of("value"), values ->
                    "授权项目范围收缴率为 " + display(values.get("value")) + "%。");
            case "erp-balance" -> canonical(parsedRefs, "erp-staging",
                    Set.of("projectName", "receivableAmount", "paidAmount", "arrearsAmount"), values ->
                            "ERP 证据显示" + values.get("projectName") + "应收金额为 "
                                    + display(values.get("receivableAmount")) + "，实收金额为 "
                                    + display(values.get("paidAmount")) + "，欠费金额为 "
                                    + display(values.get("arrearsAmount")) + "。");
            case "charge-structure" -> canonical(parsedRefs, "neo4j",
                    Set.of("rootLabel", "factorLabel", "factType", "relationType"), values ->
                            "Neo4j 证据显示" + values.get("rootLabel") + "的 " + values.get("factType")
                                    + " 事实与收费项目" + values.get("factorLabel") + "存在 "
                                    + values.get("relationType") + " 结构关系。");
            default -> throw new IllegalStateException("unsupported kind");
        };
    }

    private static GroundedConclusion.Claim canonical(
            List<GroundedConclusion.EvidenceReference> refs, String source, Set<String> requiredFields,
            java.util.function.Function<Map<String, Object>, String> renderer) {
        if (refs.stream().anyMatch(ref -> !source.equals(ref.source()))
                || refs.stream().map(GroundedConclusion.EvidenceReference::row).distinct().count() != 1) {
            throw new BackendException("PROVIDER_EVIDENCE_UNGROUNDED", "LLM claim 混用了不同证据源或行。");
        }
        Map<String, Object> values = new LinkedHashMap<>();
        for (GroundedConclusion.EvidenceReference ref : refs) {
            if (values.put(ref.field(), ref.value()) != null) {
                throw new BackendException("PROVIDER_EVIDENCE_UNGROUNDED", "LLM claim 重复引用同一字段。");
            }
        }
        if (!values.keySet().equals(requiredFields)) {
            throw new BackendException("PROVIDER_EVIDENCE_UNGROUNDED", "LLM claim 未引用规定的事实字段。");
        }
        return new GroundedConclusion.Claim(renderer.apply(values), refs);
    }

    private static GroundedConclusion.EvidenceReference reference(EvidenceReferenceDraft ref, List<Evidence> evidence,
                                                                   Set<String> referencedSources) {
        if (ref == null || ref.source() == null || ref.source().isBlank()
                || ref.field() == null || ref.field().isBlank()) {
            throw new BackendException("PROVIDER_RESPONSE_INVALID", "LLM evidenceRef 不符合受控输出契约。");
        }
        String source = ref.source();
        int row = ref.row();
        String field = ref.field();
        Evidence selected = evidence.stream().filter(item -> item.source().equals(source)).findFirst()
                .orElseThrow(() -> new BackendException("PROVIDER_EVIDENCE_UNGROUNDED", "LLM 引用了不存在的证据源。"));
        if (row < 0 || row >= selected.rows().size()
                || !selected.rows().get(row).containsKey(field)) {
            throw new BackendException("PROVIDER_EVIDENCE_UNGROUNDED", "LLM 引用了不存在的证据行或字段。");
        }
        Object actual = selected.rows().get(row).get(field);
        if (actual == null || !sameValue(actual, ref.value())) {
            throw new BackendException("PROVIDER_EVIDENCE_UNGROUNDED", "LLM evidenceRef 的值与真实证据不一致。");
        }
        referencedSources.add(source);
        return new GroundedConclusion.EvidenceReference(source, row, field, actual);
    }

    private static boolean sameValue(Object actual, Object claimed) {
        if (actual instanceof Number left && claimed instanceof Number right) {
            return new BigDecimal(left.toString()).compareTo(new BigDecimal(right.toString())) == 0;
        }
        return java.util.Objects.equals(actual, claimed);
    }

    private static String display(Object value) {
        return value instanceof Number number
                ? new BigDecimal(number.toString()).stripTrailingZeros().toPlainString()
                : String.valueOf(value);
    }

    public record ConclusionDraft(List<ClaimDraft> claims) {}

    public record ClaimDraft(String kind, List<EvidenceReferenceDraft> evidenceRefs) {}

    public record EvidenceReferenceDraft(String source, int row, String field, Object value) {}
}
