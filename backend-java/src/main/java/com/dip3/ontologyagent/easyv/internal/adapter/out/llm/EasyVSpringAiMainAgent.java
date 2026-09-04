package com.dip3.ontologyagent.easyv.internal.adapter.out.llm;

import com.dip3.ontologyagent.agent.AgentTurn;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.easyv.internal.application.EasyVGenerationRequest;
import com.dip3.ontologyagent.easyv.internal.application.EasyVGenerationWorkflow;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVDateRange;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVGenerationOntology;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVInvocationContract;
import com.dip3.ontologyagent.execution.ExecutionRepository;
import com.dip3.ontologyagent.execution.InvocationEventRecorder;
import com.dip3.ontologyagent.ontology.OntologyCatalog;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.support.JsonCodec;
import com.dip3.ontologyagent.support.OpenCodeSessionHeader;
import com.dip3.ontologyagent.tooling.WorkflowResult;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.openai.OpenAiChatOptions;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/** Spring AI adapter; domain facts and conclusions remain deterministic in the application layer. */
@Component
@ConditionalOnProperty(prefix = "dip3.easyv", name = "enabled", havingValue = "true")
public final class EasyVSpringAiMainAgent implements com.dip3.ontologyagent.easyv.internal.application.EasyVMainAgent {
  private static final String SYSTEM_PROMPT =
      """
      你是 EasyV 大屏生成质量分析 Agent。必须且只能调用一次 %s，禁止直接编造数字、结论或因果。
      工具参数只能逐字使用已发布本体 keys 和服务器给出的日期范围；不得提交用户 ID、space/team、原始输入、原始输出或其他未声明字段。
      工具返回后禁止再次调用工具或自行改写数字。
      """.formatted(EasyVInvocationContract.TOOL_NAME);
  private final ChatClient chat;
  private final EasyVGenerationWorkflow workflow;
  private final InvocationEventRecorder recorder;
  private final JsonCodec json;

  public EasyVSpringAiMainAgent(
      ChatClient.Builder builder,
      EasyVGenerationWorkflow workflow,
      InvocationEventRecorder recorder,
      JsonCodec json) {
    this.chat = builder.build();
    this.workflow = workflow;
    this.recorder = recorder;
    this.json = json;
  }

  @Override
  public WorkflowResult execute(
      AuthSession principal,
      AgentTurn turn,
      String executionId,
      OntologyCatalog ontology,
      String traceId,
      String leaseOwner) {
    if (blank(leaseOwner)) {
      throw new BackendException("JOB_LEASE_REQUIRED", "EasyV Main Agent 必须绑定当前执行租约。");
    }
    EasyVDateRange allowedRange = allowedRange(turn);
    BoundTool tool = new BoundTool(principal, turn, executionId, ontology, traceId, leaseOwner, allowedRange);
    Map<String, Object> promptInput =
        Map.of(
            "question", turn.questionText(),
            "ontologyVersionId", ontology.versionId(),
            "ontologyKeys",
                Map.of(
                    "entity", EasyVGenerationOntology.ENTITY_KEY,
                    "metric", EasyVGenerationOntology.METRIC_KEY,
                    "time", EasyVGenerationOntology.TIME_KEY),
            "allowedDateRange", Map.of("from", allowedRange.from().toString(), "to", allowedRange.to().toString()),
            "allowedTool", EasyVInvocationContract.TOOL_NAME);
    try {
      chat.prompt()
          .options(OpenAiChatOptions.builder()
              .customHeaders(OpenCodeSessionHeader.forConversation(turn.sessionId())))
          .system(SYSTEM_PROMPT)
          .user(json.write(promptInput))
          .tools(tool)
          .call()
          .content();
    } catch (BackendException error) {
      throw error;
    } catch (RuntimeException error) {
      BackendException cause = backendCause(error);
      if (cause != null) throw cause;
      throw new BackendException("AGENT_PROVIDER_FAILURE", "EasyV Main Agent 模型调用失败。", error);
    }
    WorkflowResult result = tool.result.get();
    if (result == null) {
      throw new BackendException("AGENT_TOOL_NOT_CALLED", "Main Agent 未调用 " + EasyVInvocationContract.TOOL_NAME + "。");
    }
    return result;
  }

  public final class BoundTool {
    private final AuthSession principal;
    private final AgentTurn turn;
    private final String executionId;
    private final OntologyCatalog ontology;
    private final String traceId;
    private final String leaseOwner;
    private final EasyVDateRange allowedRange;
    private final AtomicBoolean called = new AtomicBoolean();
    private final AtomicReference<WorkflowResult> result = new AtomicReference<>();

    private BoundTool(
        AuthSession principal,
        AgentTurn turn,
        String executionId,
        OntologyCatalog ontology,
        String traceId,
        String leaseOwner,
        EasyVDateRange allowedRange) {
      this.principal = principal;
      this.turn = turn;
      this.executionId = executionId;
      this.ontology = ontology;
      this.traceId = traceId;
      this.leaseOwner = leaseOwner;
      this.allowedRange = allowedRange;
    }

    @Tool(
        name = EasyVInvocationContract.TOOL_NAME,
        returnDirect = true,
        description = "执行一次 EasyV 生成质量确定性分析并返回受证据约束的结论。")
    public String run(EasyVToolInput input) {
      if (!called.compareAndSet(false, true)) {
        throw new BackendException(
            "AGENT_TOOL_CONTRACT_VIOLATION", EasyVInvocationContract.TOOL_NAME + " 禁止重复调用。");
      }
      Map<String, Object> auditInput = new LinkedHashMap<>();
      auditInput.put("ontologyVersionId", ontology.versionId());
      auditInput.put("entityKey", input == null ? null : input.entityKey());
      auditInput.put("metricKey", input == null ? null : input.metricKey());
      auditInput.put("timeKey", input == null ? null : input.timeKey());
      auditInput.put("from", input == null || input.from() == null ? null : input.from().toString());
      auditInput.put("to", input == null || input.to() == null ? null : input.to().toString());
      String invocationId =
          recorder.start(
              turn.sessionId(),
              executionId,
              principal.userId(),
              "easyv-main-agent",
              EasyVInvocationContract.TOOL_NAME,
              EasyVInvocationContract.CONTRACT.invocationType(),
              null,
              auditInput,
              traceId,
              leaseOwner);
      try {
        validate(input);
        WorkflowResult value =
            workflow.execute(
                new EasyVGenerationRequest(
                    turn.contract(),
                    executionId,
                    turn.sessionId(),
                    turn.questionText(),
                    ontology.versionId(),
                    input.entityKey(),
                    input.metricKey(),
                    input.timeKey(),
                    ontology,
                    input.from(),
                    input.to(),
                    principal.userId(),
                    "creator-owned",
                    turn.effectiveContext(),
                    Instant.now()));
        recorder.succeedWhileLeased(
            invocationId,
            Map.of("evidenceCount", value.evidence().size(), "claimCount", value.claims().size()),
            executionId,
            leaseOwner);
        result.set(value);
        return json.write(Map.of("status", "completed", "executionId", executionId, "claimCount", value.claims().size()));
      } catch (RuntimeException error) {
        String code = error instanceof BackendException known ? known.code() : "WORKFLOW_FAILED";
        try {
          recorder.failWhileLeased(
              invocationId,
              code,
              error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage(),
              executionId,
              leaseOwner);
        } catch (RuntimeException auditError) {
          if (auditError instanceof BackendException known && "JOB_LEASE_LOST".equals(known.code())) {
            known.addSuppressed(error);
            throw known;
          }
          BackendException failure =
              new BackendException("INVOCATION_AUDIT_FAILURE", "EasyV 调用失败后审计写入失败。", auditError);
          failure.addSuppressed(error);
          throw failure;
        }
        throw error;
      }
    }

    private void validate(EasyVToolInput input) {
      if (input == null
          || !EasyVGenerationOntology.ENTITY_KEY.equals(input.entityKey())
          || !EasyVGenerationOntology.METRIC_KEY.equals(input.metricKey())
          || !EasyVGenerationOntology.TIME_KEY.equals(input.timeKey())
          || input.from() == null
          || input.to() == null
          || !allowedRange.from().equals(input.from())
          || !allowedRange.to().equals(input.to())) {
        throw new BackendException("AGENT_TOOL_INPUT_INVALID", "EasyV 工具只能接收已发布 ontology keys 和服务器确定的日期范围。");
      }
    }
  }

  private static EasyVDateRange allowedRange(AgentTurn turn) {
    if (!turn.followUp()) return EasyVDateRange.resolve(turn.questionText(), turn.anchoredAt());
    Object from = turn.effectiveContext().get("from");
    Object to = turn.effectiveContext().get("to");
    if (!(from instanceof String fromText) || !(to instanceof String toText)) {
      throw new BackendException("FOLLOW_UP_CONTEXT_INVALID", "EasyV 追问缺少已冻结的 EasyV 日期范围。");
    }
    return new EasyVDateRange(java.time.LocalDate.parse(fromText), java.time.LocalDate.parse(toText));
  }

  private static BackendException backendCause(Throwable error) {
    Throwable current = error;
    while (current != null) {
      if (current instanceof BackendException known) return known;
      current = current.getCause();
    }
    return null;
  }

  private static boolean blank(String value) {
    return value == null || value.isBlank();
  }
}
