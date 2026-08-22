package com.dip3.ontologyagent.followup;

import com.dip3.ontologyagent.analysis.AnalysisService;
import com.dip3.ontologyagent.analysis.AnalysisSession;
import com.dip3.ontologyagent.analysis.AnalysisCapabilityPolicy;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.execution.ExecutionSnapshotEntity;
import com.dip3.ontologyagent.execution.ExecutionRepository;
import com.dip3.ontologyagent.execution.ExecutionSubmission;
import com.dip3.ontologyagent.execution.WakeupPublisher;
import com.dip3.ontologyagent.integration.erp.ScopedProjectResolver;
import com.dip3.ontologyagent.integration.erp.ScopedProjectTarget;
import com.dip3.ontologyagent.ontology.OntologyRepository;
import com.dip3.ontologyagent.support.BackendException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.text.Normalizer;
import java.time.Instant;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
public class AnalysisFollowUpService {
    private static final Logger log = LoggerFactory.getLogger(AnalysisFollowUpService.class);
    private static final List<String> CONTEXT_FIELDS = List.of("targetMetric", "entity", "timeRange", "comparison");
    private static final Map<String, String> FIELD_LABELS = Map.of(
            "targetMetric", "目标指标", "entity", "实体对象", "timeRange", "时间范围", "comparison", "比较方式");
    private static final Pattern FULL_MONTH = Pattern.compile("(?<!\\d)(\\d{4})\\s*年\\s*(\\d{1,2})\\s*月份?");
    private static final Pattern CONTEXT_MONTH = Pattern.compile(
            "(?<![\\d年])(\\d{1,2}|[一二三四五六七八九十]+)\\s*月份?(?=$|呢|[?？,，。])");
    private static final Pattern ISO_DATE = Pattern.compile("(?<!\\d)(\\d{4}-\\d{2}-\\d{2})(?!\\d)");
    private static final Pattern TIME_REFERENCE = Pattern.compile(
            "\\d{4}\\s*年|(?:\\d{1,2}|[一二三四五六七八九十]+)\\s*月份?(?=$|呢|[?？,，。])|"
                    + "本月|上月|上个月|今年|去年|\\d{4}-\\d{2}-\\d{2}");
    private static final Pattern PROJECT_ID_REFERENCE = Pattern.compile(
            "(?i)(?<![a-z0-9_-])project[-_][a-z0-9_-]+(?![a-z0-9_-])");
    private static final Pattern PROJECT_NAME_REFERENCE = Pattern.compile(
            "[\\p{IsHan}a-zA-Z0-9_-]{1,40}(?:项目|小区|花园|园区)");
    private static final List<String> GENERIC_PROJECT_REFERENCES = List.of(
            "所有项目", "全部项目", "当前项目", "这个项目", "该项目", "项目整体", "各项目");
    private static final List<String> FULL_SCOPE_REFERENCES = List.of(
            "所有项目", "全部项目", "全体项目", "各项目", "项目整体", "全范围");
    private final AnalysisService analyses;
    private final AnalysisFollowUpRepository followUps;
    private final OntologyRepository ontologies;
    private final ExecutionRepository executions;
    private final WakeupPublisher wakeups;
    private final ScopedProjectResolver scopedProjects;

    @Autowired
    public AnalysisFollowUpService(AnalysisService analyses, AnalysisFollowUpRepository followUps,
                                   OntologyRepository ontologies, ExecutionRepository executions,
                                   WakeupPublisher wakeups, ScopedProjectResolver scopedProjects) {
        this.analyses = analyses;
        this.followUps = followUps;
        this.ontologies = ontologies;
        this.executions = executions;
        this.wakeups = wakeups;
        this.scopedProjects = scopedProjects;
    }

    AnalysisFollowUpService(AnalysisService analyses, AnalysisFollowUpRepository followUps,
                            OntologyRepository ontologies) {
        this(analyses, followUps, ontologies, null, null, null);
    }

    AnalysisFollowUpService(AnalysisService analyses, AnalysisFollowUpRepository followUps,
                            OntologyRepository ontologies, ScopedProjectResolver scopedProjects) {
        this(analyses, followUps, ontologies, null, null, scopedProjects);
    }

    AnalysisFollowUpService(AnalysisService analyses, AnalysisFollowUpRepository followUps,
                            OntologyRepository ontologies, ExecutionRepository executions,
                            WakeupPublisher wakeups) {
        this(analyses, followUps, ontologies, executions, wakeups, null);
    }

    @Transactional
    public AnalysisFollowUp create(String sessionId, AuthSession owner, String rawQuestion, String parentFollowUpId) {
        AnalysisSession session = analyses.ownedSession(sessionId, owner);
        String question = normalize(rawQuestion);
        if (question.isEmpty()) throw new BackendException("INVALID_FOLLOW_UP_QUESTION", "请输入追问内容。");
        if (question.length() > 300) {
            throw new BackendException("INVALID_FOLLOW_UP_QUESTION", "追问长度不能超过 300 个字符。");
        }
        if (!AnalysisCapabilityPolicy.supportsFollowUp(question)) {
            throw new BackendException("FOLLOW_UP_CAPABILITY_UNSUPPORTED",
                    "当前追问仍只支持项目收缴率及应收账期口径，不能切换指标、尾欠口径或实收日期语义。");
        }

        AnalysisFollowUp parent = blank(parentFollowUpId) ? null : owned(parentFollowUpId, sessionId, owner);
        ExecutionSnapshotEntity source = parent == null
                ? followUps.latestCompletedRootSnapshot(sessionId, owner.userId())
                .orElseThrow(() -> new BackendException("FOLLOW_UP_SOURCE_NOT_FOUND", "当前会话没有可承接的已完成根结论。"))
                : parentResult(parent);
        Map<String, Object> context = resolvedContext(source);
        Map<String, Object> mergedContext = questionContext(question, context, owner);
        Conclusion conclusion = conclusion(source);
        String ontologyVersionId = required(source.ontologyVersionId, "FOLLOW_UP_ONTOLOGY_MISSING",
                "来源执行没有绑定本体版本，无法发起追问。");
        ontologies.published(ontologyVersionId);
        Instant now = Instant.now();
        return followUps.create(new AnalysisFollowUp(UUID.randomUUID().toString(), session.id(), owner.userId(),
                question, parent == null ? null : parent.id(), source.executionId, conclusion.title(),
                conclusion.summary(), null, ontologyVersionId, binding(ontologyVersionId, "inherited"),
                context, mergedContext, null, null, null, null, now, now));
    }

    public List<AnalysisFollowUp> list(String sessionId, AuthSession owner) {
        analyses.ownedSession(sessionId, owner);
        return followUps.listOwned(sessionId, owner.userId());
    }

    public AnalysisFollowUp get(String sessionId, String followUpId, AuthSession owner) {
        analyses.ownedSession(sessionId, owner);
        return owned(followUpId, sessionId, owner);
    }

    @Transactional
    public AdjustmentResult adjust(String sessionId, String followUpId, AuthSession owner,
                                   Map<String, String> draft, boolean confirmConflicts) {
        AnalysisFollowUp current = get(sessionId, followUpId, owner);
        rejectSubmittedMutation(current);
        Map<String, String> changes = new LinkedHashMap<>();
        for (String field : CONTEXT_FIELDS) {
            String value = normalize(draft.get(field));
            validateAdjustmentValue(value);
            if (!value.isEmpty()) changes.put(field, value);
        }
        String factor = normalize(draft.get("factor"));
        validateAdjustmentValue(factor);
        if (changes.isEmpty() && factor.isEmpty()) {
            throw new BackendException("INVALID_FOLLOW_UP_ADJUSTMENT", "至少需要补充一个因素或范围条件。");
        }

        List<Map<String, Object>> conflicts = conflicts(current.mergedContext(), changes);
        if (!conflicts.isEmpty() && !confirmConflicts) {
            throw new FollowUpConflictException(conflicts);
        }
        Map<String, Object> merged = mutableContext(current.mergedContext());
        changes.forEach((key, value) -> merged.put(key, field(FIELD_LABELS.get(key), value, "confirmed")));
        if (!factor.isEmpty()) addFactor(merged, factor);
        boolean changed = !Objects.equals(merged, current.mergedContext());
        Instant now = Instant.now();
        AnalysisFollowUp next = new AnalysisFollowUp(current.id(), current.sessionId(), current.ownerUserId(),
                current.questionText(), current.parentFollowUpId(), current.referencedExecutionId(),
                current.referencedConclusionTitle(), current.referencedConclusionSummary(), current.resultExecutionId(),
                current.ontologyVersionId(), current.ontologyVersionBinding(), current.inheritedContext(), merged,
                changed ? null : current.planVersion(), changed ? null : current.currentPlanSnapshot(),
                changed ? null : current.previousPlanSnapshot(),
                changed ? null : current.currentPlanDiff(), current.createdAt(), now);
        return new AdjustmentResult(followUps.replace(current, next), contextDiff(next.inheritedContext(), merged));
    }

    @Transactional
    public AnalysisFollowUp replan(String sessionId, String followUpId, AuthSession owner) {
        AnalysisFollowUp current = get(sessionId, followUpId, owner);
        rejectSubmittedMutation(current);
        ExecutionSnapshotEntity source = followUps.completedSourceSnapshot(current)
                .orElseThrow(() -> new BackendException("FOLLOW_UP_SOURCE_NOT_FOUND", "来源执行已失效或不再是已完成状态。"));
        if (source.planSnapshot == null || source.planSnapshot.isEmpty()) {
            throw new BackendException("FOLLOW_UP_REPLAN_INVALID", "缺少上一轮计划快照，无法重规划。");
        }
        ontologies.published(current.ontologyVersionId());
        Map<String, Object> previous = current.currentPlanSnapshot() == null
                ? Map.copyOf(source.planSnapshot) : current.currentPlanSnapshot();
        if (scopedProjects == null) {
            throw new BackendException("FOLLOW_UP_SCOPE_RESOLVER_UNAVAILABLE", "追问项目范围解析组件未配置。");
        }
        Map<String, Object> nextPlan = replanFrom(previous, current.inheritedContext(), current.mergedContext(),
                scopedProjects.resolve(owner),
                current.id(), current.referencedExecutionId());
        Map<String, Object> diff = planDiff(previous, nextPlan);
        int version = current.planVersion() == null ? 2 : current.planVersion() + 1;
        AnalysisFollowUp next = new AnalysisFollowUp(current.id(), current.sessionId(), current.ownerUserId(),
                current.questionText(), current.parentFollowUpId(), current.referencedExecutionId(),
                current.referencedConclusionTitle(), current.referencedConclusionSummary(), current.resultExecutionId(),
                current.ontologyVersionId(), current.ontologyVersionBinding(), current.inheritedContext(),
                current.mergedContext(), version, nextPlan, previous, diff, current.createdAt(), Instant.now());
        return followUps.replace(current, next);
    }

    @Transactional
    public AnalysisFollowUp attachResultExecution(String sessionId, String followUpId, AuthSession owner,
                                                   String executionId, String ontologyVersionId) {
        AnalysisFollowUp current = get(sessionId, followUpId, owner);
        return attach(current, executionId, ontologyVersionId);
    }

    private AnalysisFollowUp attach(AnalysisFollowUp current, String executionId, String ontologyVersionId) {
        if (!current.ontologyVersionId().equals(ontologyVersionId)) {
            throw new BackendException("FOLLOW_UP_ONTOLOGY_MISMATCH",
                    "追问执行绑定的本体版本与当前计划不一致。");
        }
        if (current.resultExecutionId() != null) {
            if (current.resultExecutionId().equals(executionId)) return current;
            throw new BackendException("FOLLOW_UP_EXECUTION_CONFLICT", "该追问已绑定其他执行。");
        }
        AnalysisFollowUp next = new AnalysisFollowUp(current.id(), current.sessionId(), current.ownerUserId(),
                current.questionText(), current.parentFollowUpId(), current.referencedExecutionId(),
                current.referencedConclusionTitle(), current.referencedConclusionSummary(), executionId,
                current.ontologyVersionId(), current.ontologyVersionBinding(), current.inheritedContext(),
                current.mergedContext(), current.planVersion(), current.currentPlanSnapshot(),
                current.previousPlanSnapshot(), current.currentPlanDiff(), current.createdAt(), Instant.now());
        return followUps.replace(current, next);
    }

    @Transactional
    public String submit(String sessionId, String followUpId, AuthSession owner, String idempotencyKey,
                         String traceId) {
        if (executions == null || wakeups == null) {
            throw new BackendException("FOLLOW_UP_EXECUTION_UNAVAILABLE", "追问执行组件未配置。");
        }
        AnalysisSession session = analyses.ownedSession(sessionId, owner);
        AnalysisFollowUp followUp = followUps.lockOwned(followUpId, sessionId, owner.userId())
                .orElseThrow(() -> new BackendException("FOLLOW_UP_NOT_FOUND", "追问不存在或无权访问。"));
        ontologies.published(followUp.ontologyVersionId());
        if (followUp.resultExecutionId() != null) return followUp.resultExecutionId();
        if (!followUp.mergedContext().equals(followUp.inheritedContext())
                && followUp.currentPlanSnapshot() == null) {
            throw new BackendException("FOLLOW_UP_REPLAN_REQUIRED", "追问上下文已变更，请先完成重规划再执行。");
        }
        Map<String, Object> effectiveContext = executableContext(followUp);
        String key = idempotencyKey == null || idempotencyKey.isBlank() ? "follow-up" : idempotencyKey.trim();
        if (key.length() > 128) {
            throw new BackendException("INVALID_IDEMPOTENCY_KEY", "Idempotency-Key 不能超过 128 个字符。");
        }
        ExecutionSubmission submission = executions.submitFollowUp(session, followUp.id(),
                followUp.referencedExecutionId(), followUp.questionText(), Map.of(
                        "title", followUp.referencedConclusionTitle() == null ? "" : followUp.referencedConclusionTitle(),
                        "summary", followUp.referencedConclusionSummary() == null ? "" : followUp.referencedConclusionSummary()),
                effectiveContext, key, traceId,
                followUp.ontologyVersionId());
        attach(followUp, submission.executionId(), followUp.ontologyVersionId());
        if (submission.created()) publishAfterCommit(submission.executionId(), traceId);
        return submission.executionId();
    }

    private void publishAfterCommit(String executionId, String traceId) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            throw new BackendException("FOLLOW_UP_TRANSACTION_REQUIRED", "追问提交必须运行在事务中。");
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                try {
                    wakeups.publish(executionId);
                    executions.markDispatchPublished(executionId);
                } catch (RuntimeException error) {
                    try {
                        executions.markDispatchFailed(executionId);
                    } catch (RuntimeException persistenceError) {
                        error.addSuppressed(persistenceError);
                    }
                    log.error("follow_up_wakeup_failed executionId={} traceId={} message={}",
                            executionId, traceId, error.getMessage(), error);
                }
            }
        });
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> executableContext(AnalysisFollowUp followUp) {
        Map<String, Object> source = followUp.currentPlanSnapshot() != null
                ? followUp.currentPlanSnapshot() : Map.of();
        Object resolved = source.get("_resolvedContext");
        Map<String, Object> context = new LinkedHashMap<>(followUp.mergedContext());
        if (resolved instanceof Map<?, ?> map) {
            context.putAll((Map<String, Object>) map);
            return Map.copyOf(context);
        }
        Object constraints = context.get("constraints");
        if (!(constraints instanceof List<?> list)) {
            throw new BackendException("FOLLOW_UP_CONTEXT_INVALID", "追问上下文缺少受控约束。");
        }
        for (Object item : list) {
            if (!(item instanceof Map<?, ?> entry)) continue;
            String label = text(entry.get("label"));
            Object value = entry.get("value");
            if ("实体 business key".equals(label)) context.put("entityKey", value);
            else if ("指标定义 business key".equals(label)) context.put("metricDefinitionKey", value);
            else if ("指标口径 business key".equals(label)) context.put("metricVariantKey", value);
            else if ("时间语义 business key".equals(label)) context.put("timeSemanticKey", value);
        }
        String[] range = fieldValue(context, "timeRange").split("/", -1);
        if (range.length != 2) {
            throw new BackendException("FOLLOW_UP_CONTEXT_INVALID", "追问时间范围必须使用 yyyy-MM-dd/yyyy-MM-dd。");
        }
        context.put("from", range[0]);
        context.put("to", range[1]);
        context.put("projectIds", list.stream().filter(Map.class::isInstance).map(Map.class::cast)
                .filter(entry -> "项目 ID".equals(entry.get("label"))).map(entry -> text(entry.get("value")))
                .filter(value -> !blank(value)).toList());
        if (List.of("entityKey", "metricDefinitionKey", "metricVariantKey", "timeSemanticKey")
                .stream().anyMatch(key -> blank(text(context.get(key))))) {
            throw new BackendException("FOLLOW_UP_CONTEXT_INVALID", "追问上下文缺少受控本体键。");
        }
        return Map.copyOf(context);
    }

    private ExecutionSnapshotEntity parentResult(AnalysisFollowUp parent) {
        String executionId = required(parent.resultExecutionId(), "FOLLOW_UP_PARENT_NOT_COMPLETED",
                "父追问还没有已完成结果，无法继续承接。");
        return followUps.completedFollowUpSnapshot(executionId, parent.sessionId(), parent.ownerUserId(), parent.id())
                .orElseThrow(() -> new BackendException("FOLLOW_UP_PARENT_NOT_COMPLETED",
                        "父追问结果不存在或尚未完成，无法继续承接。"));
    }

    private AnalysisFollowUp owned(String followUpId, String sessionId, AuthSession owner) {
        AnalysisFollowUp followUp = followUps.findOwned(followUpId, owner.userId())
                .orElseThrow(() -> new BackendException("FOLLOW_UP_NOT_FOUND", "追问不存在或无权访问。"));
        if (!sessionId.equals(followUp.sessionId())) {
            throw new BackendException("FOLLOW_UP_NOT_FOUND", "追问不存在或无权访问。");
        }
        return followUp;
    }

    private Map<String, Object> questionContext(String question, Map<String, Object> inherited, AuthSession owner) {
        Map<String, Object> merged = inherited;
        DateRange dateRange = dateRange(question, inherited);
        if (dateRange != null) merged = withTimeRange(merged, dateRange);

        if (scopedProjects == null) {
            if (hasExplicitProjectReference(question)) {
                throw new BackendException("FOLLOW_UP_SCOPE_RESOLVER_UNAVAILABLE", "追问项目范围解析组件未配置。");
            }
            return merged;
        }
        List<ScopedProjectTarget> targets = scopedProjects.targets(owner);
        boolean fullScope = FULL_SCOPE_REFERENCES.stream().anyMatch(question::contains);
        List<ScopedProjectTarget> matches = targets.stream()
                .filter(target -> containsTarget(question, target)).toList();
        LinkedHashSet<String> ids = new LinkedHashSet<>();
        matches.forEach(target -> ids.add(target.id()));
        if (ids.size() > 1) {
            throw new BackendException("FOLLOW_UP_SCOPE_INVALID", "追问中的项目名称或 ID 不唯一，请明确一个授权项目。");
        }
        if (fullScope && (!ids.isEmpty() || hasExplicitProjectReference(question))) {
            throw new BackendException("FOLLOW_UP_SCOPE_INVALID", "追问同时指定了全部项目和单个项目，范围不唯一。");
        }
        if (fullScope) return withProjects(merged, targets.stream().map(ScopedProjectTarget::id).toList());
        if (ids.size() == 1) return withProject(merged, ids.getFirst());
        if (hasExplicitProjectReference(question)) {
            throw new BackendException("FOLLOW_UP_SCOPE_INVALID", "追问中的项目未唯一匹配当前账号授权范围。");
        }
        return merged;
    }

    private static DateRange dateRange(String question, Map<String, Object> inherited) {
        List<String> isoDates = matches(ISO_DATE, question, 1);
        List<String> fullMonths = matches(FULL_MONTH, question, 0);
        List<String> contextMonths = matches(CONTEXT_MONTH, FULL_MONTH.matcher(question).replaceAll(" "), 1);
        int categories = (isoDates.isEmpty() ? 0 : 1) + (fullMonths.isEmpty() ? 0 : 1)
                + (contextMonths.isEmpty() ? 0 : 1);
        if (categories > 1 || !isoDates.isEmpty() && isoDates.size() != 2
                || !fullMonths.isEmpty() && fullMonths.size() != 1
                || !contextMonths.isEmpty() && contextMonths.size() != 1) {
            throw new BackendException("FOLLOW_UP_TIME_RANGE_INVALID", "追问中的时间范围不唯一或格式无效。");
        }
        try {
            if (!isoDates.isEmpty()) {
                LocalDate from = LocalDate.parse(isoDates.get(0));
                LocalDate to = LocalDate.parse(isoDates.get(1));
                if (from.isAfter(to)) throw new DateTimeParseException("from > to", question, 0);
                return new DateRange(from, to);
            }
            if (!fullMonths.isEmpty()) {
                Matcher matcher = FULL_MONTH.matcher(fullMonths.getFirst());
                if (!matcher.find()) throw new DateTimeParseException("month", question, 0);
                return month(YearMonth.of(Integer.parseInt(matcher.group(1)), Integer.parseInt(matcher.group(2))));
            }
            if (!contextMonths.isEmpty()) {
                String[] boundaries = fieldValue(inherited, "timeRange").split("/", -1);
                if (boundaries.length != 2) {
                    throw new BackendException("FOLLOW_UP_TIME_RANGE_INVALID", "来源时间范围格式无效。");
                }
                LocalDate from = LocalDate.parse(boundaries[0]);
                LocalDate to = LocalDate.parse(boundaries[1]);
                if (from.getYear() != to.getYear()) {
                    throw new BackendException("FOLLOW_UP_TIME_RANGE_INVALID", "省略年份的月份无法从跨年来源范围唯一确定年份。");
                }
                return month(YearMonth.of(from.getYear(), monthNumber(contextMonths.getFirst())));
            }
        } catch (BackendException error) {
            throw error;
        } catch (NumberFormatException | java.time.DateTimeException error) {
            throw new BackendException("FOLLOW_UP_TIME_RANGE_INVALID", "追问中的时间范围格式无效。", error);
        }
        if (TIME_REFERENCE.matcher(question).find()) {
            throw new BackendException("FOLLOW_UP_TIME_RANGE_INVALID",
                    "追问时间范围必须提供完整年月、可从来源年份确定的单月，或两个 ISO 日期。");
        }
        return null;
    }

    private static List<String> matches(Pattern pattern, String value, int group) {
        List<String> matches = new ArrayList<>();
        Matcher matcher = pattern.matcher(value);
        while (matcher.find()) matches.add(matcher.group(group));
        return matches;
    }

    private static DateRange month(YearMonth month) {
        return new DateRange(month.atDay(1), month.atEndOfMonth());
    }

    private static int monthNumber(String value) {
        if (value.chars().allMatch(Character::isDigit)) return Integer.parseInt(value);
        return switch (value) {
            case "一" -> 1;
            case "二" -> 2;
            case "三" -> 3;
            case "四" -> 4;
            case "五" -> 5;
            case "六" -> 6;
            case "七" -> 7;
            case "八" -> 8;
            case "九" -> 9;
            case "十" -> 10;
            case "十一" -> 11;
            case "十二" -> 12;
            default -> throw new BackendException("FOLLOW_UP_TIME_RANGE_INVALID", "追问月份格式无效。");
        };
    }

    private static boolean containsTarget(String question, ScopedProjectTarget target) {
        return !blank(target.id()) && containsIdentifier(question, target.id())
                || !blank(target.name()) && containsProjectName(question, target.name());
    }

    private static boolean containsIdentifier(String question, String id) {
        return Pattern.compile("(?i)(?<![a-z0-9_-])" + Pattern.quote(id) + "(?![a-z0-9_-])")
                .matcher(question).find();
    }

    private static boolean containsProjectName(String question, String name) {
        if (!question.contains(name)) return false;
        return Pattern.compile("(?:^|(?:改看|看|分析|换成|那|查|对比|比较))\\s*" + Pattern.quote(name)
                        + "(?=$|呢|[?？,，。])")
                .matcher(question).find();
    }

    private static boolean hasExplicitProjectReference(String question) {
        if (PROJECT_ID_REFERENCE.matcher(question).find()) return true;
        String withoutGeneric = question;
        for (String generic : GENERIC_PROJECT_REFERENCES) withoutGeneric = withoutGeneric.replace(generic, "");
        return PROJECT_NAME_REFERENCE.matcher(withoutGeneric).find()
                || Pattern.compile("项目(?:\\d+|[一二三四五六七八九十]+|[a-zA-Z][a-zA-Z0-9_-]*)")
                .matcher(withoutGeneric).find();
    }

    private static Map<String, Object> withProject(Map<String, Object> context, String projectId) {
        return withProjects(context, List.of(projectId));
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> withProjects(Map<String, Object> context, List<String> projectIds) {
        Map<String, Object> next = mutableContext(context);
        next.put("entity", field("实体对象", String.join(",", projectIds), "confirmed"));
        List<Map<String, Object>> constraints = (List<Map<String, Object>>) next.get("constraints");
        constraints.removeIf(item -> "项目 ID".equals(item.get("label")));
        projectIds.forEach(projectId -> constraints.add(Map.of("label", "项目 ID", "value", projectId)));
        next.put("constraints", List.copyOf(constraints));
        return immutableContext(next);
    }

    private static Map<String, Object> withTimeRange(Map<String, Object> context, DateRange range) {
        Map<String, Object> next = new LinkedHashMap<>(context);
        next.put("timeRange", field("时间范围", range.from() + "/" + range.to(), "confirmed"));
        return immutableContext(next);
    }

    private static void rejectSubmittedMutation(AnalysisFollowUp followUp) {
        if (followUp.resultExecutionId() != null) {
            throw new BackendException("FOLLOW_UP_ALREADY_SUBMITTED",
                    "该追问已提交执行，不能改写历史输入；请基于完成结果创建下一轮追问。");
        }
    }

    private static void validateAdjustmentValue(String value) {
        if (value.length() > 200) {
            throw new BackendException("INVALID_FOLLOW_UP_ADJUSTMENT", "追问上下文单个字段不能超过 200 个字符。");
        }
    }

    private static Map<String, Object> resolvedContext(ExecutionSnapshotEntity snapshot) {
        Object raw = snapshot.planSnapshot == null ? null : snapshot.planSnapshot.get("_resolvedContext");
        if (!(raw instanceof Map<?, ?> source)) {
            throw new BackendException("FOLLOW_UP_CONTEXT_MISSING", "来源执行缺少 _resolvedContext，无法安全承接追问。");
        }
        String entityKey = resolvedText(source, "entityKey");
        String metricDefinitionKey = resolvedText(source, "metricDefinitionKey");
        String metricVariantKey = resolvedText(source, "metricVariantKey");
        String timeSemanticKey = resolvedText(source, "timeSemanticKey");
        String from = resolvedText(source, "from");
        String to = resolvedText(source, "to");
        Object rawProjectIds = source.get("projectIds");
        if (!(rawProjectIds instanceof List<?> values)
                || values.stream().anyMatch(value -> !(value instanceof String id) || id.isBlank())) {
            throw new BackendException("FOLLOW_UP_CONTEXT_INVALID", "来源执行的 _resolvedContext.projectIds 无效。");
        }
        List<String> projectIds = values.stream().map(String.class::cast).toList();
        Map<String, Object> context = new LinkedHashMap<>();
        context.put("targetMetric", field("目标指标", metricVariantKey, "confirmed"));
        context.put("entity", field("实体对象", projectIds.isEmpty() ? entityKey : String.join(",", projectIds),
                "confirmed"));
        context.put("timeRange", field("时间范围", from + "/" + to, "confirmed"));
        context.put("comparison", field("比较方式", "无需比较", "confirmed"));
        List<Map<String, Object>> constraints = new ArrayList<>();
        constraints.add(Map.of("label", "实体 business key", "value", entityKey));
        constraints.add(Map.of("label", "指标定义 business key", "value", metricDefinitionKey));
        constraints.add(Map.of("label", "指标口径 business key", "value", metricVariantKey));
        constraints.add(Map.of("label", "时间语义 business key", "value", timeSemanticKey));
        projectIds.forEach(id -> constraints.add(Map.of("label", "项目 ID", "value", id)));
        context.put("constraints", List.copyOf(constraints));
        return immutableContext(context);
    }

    @SuppressWarnings("unchecked")
    private static Conclusion conclusion(ExecutionSnapshotEntity snapshot) {
        Object causes = snapshot.conclusionState == null ? null : snapshot.conclusionState.get("causes");
        if (!(causes instanceof List<?> list) || list.isEmpty() || !(list.getFirst() instanceof Map<?, ?> cause)) {
            throw new BackendException("FOLLOW_UP_CONCLUSION_MISSING", "来源执行缺少可承接结论。");
        }
        String title = text(cause.get("title"));
        String summary = text(cause.get("summary"));
        if (blank(title) && blank(summary)) {
            throw new BackendException("FOLLOW_UP_CONCLUSION_MISSING", "来源执行缺少可承接结论。");
        }
        return new Conclusion(title, summary);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> mutableContext(Map<String, Object> source) {
        Map<String, Object> copy = new LinkedHashMap<>(source);
        Object constraints = source.get("constraints");
        copy.put("constraints", constraints instanceof List<?> list
                ? new ArrayList<>(list.stream().map(item -> new LinkedHashMap<>((Map<String, Object>) item)).toList())
                : new ArrayList<>());
        return copy;
    }

    @SuppressWarnings("unchecked")
    private static void addFactor(Map<String, Object> context, String factor) {
        List<Map<String, Object>> constraints = (List<Map<String, Object>>) context.get("constraints");
        boolean exists = constraints.stream().anyMatch(item -> "候选因素".equals(item.get("label"))
                && factor.equals(item.get("value")));
        if (!exists) constraints.add(Map.of("label", "候选因素", "value", factor));
    }

    private static List<Map<String, Object>> conflicts(Map<String, Object> context, Map<String, String> changes) {
        List<Map<String, Object>> conflicts = new ArrayList<>();
        changes.forEach((key, value) -> {
            Map<?, ?> current = context.get(key) instanceof Map<?, ?> map ? map : Map.of();
            String previous = text(current.get("value"));
            if ("confirmed".equals(current.get("state")) && !Objects.equals(previous, value)) {
                conflicts.add(change("field", key, FIELD_LABELS.get(key), previous, value));
            }
        });
        return List.copyOf(conflicts);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> contextDiff(Map<String, Object> inherited, Map<String, Object> merged) {
        List<Map<String, Object>> added = new ArrayList<>();
        List<Map<String, Object>> overridden = new ArrayList<>();
        for (String key : CONTEXT_FIELDS) {
            Map<String, Object> before = (Map<String, Object>) inherited.get(key);
            Map<String, Object> after = (Map<String, Object>) merged.get(key);
            if (!Objects.equals(before.get("value"), after.get("value"))) {
                overridden.add(change("field", key, FIELD_LABELS.get(key), text(before.get("value")),
                        text(after.get("value"))));
            }
        }
        List<Map<String, Object>> beforeConstraints = (List<Map<String, Object>>) inherited.get("constraints");
        List<Map<String, Object>> afterConstraints = (List<Map<String, Object>>) merged.get("constraints");
        afterConstraints.stream().filter(item -> !beforeConstraints.contains(item)).forEach(item -> added.add(Map.of(
                "type", "constraint", "key", item.get("label") + ":" + item.get("value"),
                "label", item.get("label"), "nextValue", item.get("value"))));
        return Map.of("added", added, "overridden", overridden);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> replanFrom(Map<String, Object> previous,
                                                   Map<String, Object> inheritedContext,
                                                   Map<String, Object> context,
                                                   List<String> authorizedProjectIds,
                                                   String followUpId,
                                                   String referencedExecutionId) {
        if (!(previous.get("steps") instanceof List<?> steps)) {
            throw new BackendException("FOLLOW_UP_REPLAN_INVALID", "上一轮计划步骤无效，无法重规划。");
        }
        Object raw = previous.get("_resolvedContext");
        if (!(raw instanceof Map<?, ?> resolvedRaw)) {
            throw new BackendException("FOLLOW_UP_CONTEXT_MISSING", "上一轮计划缺少 _resolvedContext，无法安全重规划。");
        }
        Map<String, Object> resolved = new LinkedHashMap<>((Map<String, Object>) resolvedRaw);
        String targetMetric = fieldValue(context, "targetMetric");
        String inheritedMetric = fieldValue(inheritedContext, "targetMetric");
        if (!targetMetric.equals(inheritedMetric)) {
            throw new BackendException("FOLLOW_UP_REPLAN_UNSUPPORTED", "当前 Workflow 尚不支持改变目标指标。");
        }
        String entity = fieldValue(context, "entity");
        String inheritedEntity = fieldValue(inheritedContext, "entity");
        if (!entity.equals(inheritedEntity)) {
            List<String> requestedProjects = List.of(entity.split(",")).stream().map(String::trim)
                    .filter(value -> !value.isEmpty()).toList();
            if (requestedProjects.isEmpty() || !authorizedProjectIds.containsAll(requestedProjects)) {
                throw new BackendException("FOLLOW_UP_REPLAN_UNSUPPORTED",
                        "当前 Workflow 仅支持切换到账号已授权的项目 ID 子集。");
            }
            resolved.put("projectIds", requestedProjects);
        }
        String timeRange = fieldValue(context, "timeRange");
        String inheritedTimeRange = fieldValue(inheritedContext, "timeRange");
        if (!timeRange.equals(inheritedTimeRange)) {
            String[] boundaries = timeRange.split("/", -1);
            if (boundaries.length != 2) {
                throw new BackendException("FOLLOW_UP_REPLAN_INVALID", "时间范围必须使用 yyyy-MM-dd/yyyy-MM-dd。" );
            }
            try {
                java.time.LocalDate from = java.time.LocalDate.parse(boundaries[0].trim());
                java.time.LocalDate to = java.time.LocalDate.parse(boundaries[1].trim());
                if (from.isAfter(to)) throw new java.time.format.DateTimeParseException("from > to", timeRange, 0);
                resolved.put("from", from.toString());
                resolved.put("to", to.toString());
            } catch (java.time.format.DateTimeParseException error) {
                throw new BackendException("FOLLOW_UP_REPLAN_INVALID", "时间范围必须使用有效的 yyyy-MM-dd/yyyy-MM-dd。", error);
            }
        }
        if (!fieldValue(context, "comparison").equals(fieldValue(inheritedContext, "comparison"))) {
            throw new BackendException("FOLLOW_UP_REPLAN_UNSUPPORTED", "当前 Workflow 尚不支持改变比较方式。");
        }
        Map<String, Object> next = new LinkedHashMap<>(previous);
        next.put("summary", "追问重规划：基于本轮确认上下文重新执行，不复用上一轮步骤结果。");
        next.put("steps", steps.stream().map(item -> new LinkedHashMap<>((Map<String, Object>) item)).toList());
        next.put("_executionContract", ExecutionRepository.FOLLOW_UP_EXECUTION_CONTRACT);
        next.put("_followUpId", followUpId);
        next.put("_referencedExecutionId", referencedExecutionId);
        next.put("_resolvedContext", Map.copyOf(resolved));
        return Map.copyOf(next);
    }

    private static String fieldValue(Map<String, Object> context, String key) {
        if (!(context.get(key) instanceof Map<?, ?> field) || blank(text(field.get("value")))) {
            throw new BackendException("FOLLOW_UP_CONTEXT_INVALID", "追问上下文字段 " + key + " 无效。");
        }
        return text(field.get("value"));
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> planDiff(Map<String, Object> previous, Map<String, Object> next) {
        List<Map<String, Object>> invalidated = ((List<Map<String, Object>>) previous.get("steps")).stream()
                .map(step -> Map.<String, Object>of("stepId", required(text(step.get("id")),
                                "FOLLOW_UP_REPLAN_INVALID", "上一轮计划步骤缺少 id。"),
                        "title", required(text(step.get("title")), "FOLLOW_UP_REPLAN_INVALID",
                                "上一轮计划步骤缺少 title。"),
                        "reason", "追问上下文已变更，需要重新执行。"))
                .toList();
        return Map.of("reason", "用户追问或纠正后的上下文触发计划重算。", "reusedSteps", List.of(),
                "invalidatedSteps", invalidated, "addedSteps", List.of());
    }

    private static Map<String, Object> immutableContext(Map<String, Object> context) {
        return Map.copyOf(context);
    }

    private static Map<String, Object> field(String label, String value, String state) {
        return Map.of("label", label, "value", value, "state", state);
    }

    private static Map<String, Object> change(String type, String key, String label,
                                               String previousValue, String nextValue) {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("type", type);
        item.put("key", key);
        item.put("label", label);
        item.put("previousValue", previousValue);
        item.put("nextValue", nextValue);
        return item;
    }

    private static Map<String, Object> binding(String ontologyVersionId, String source) {
        return Map.of("ontologyVersionId", ontologyVersionId, "source", source);
    }

    private static String normalize(String value) {
        return value == null ? "" : Normalizer.normalize(value, Normalizer.Form.NFKC)
                .replaceAll("[\\s\\u3000]+", " ").trim();
    }

    private static String text(Object value) {
        return value == null ? null : value.toString();
    }

    private static String resolvedText(Map<?, ?> source, String key) {
        return required(text(source.get(key)), "FOLLOW_UP_CONTEXT_INVALID",
                "来源执行的 _resolvedContext." + key + " 无效。");
    }

    private static boolean blank(String value) {
        return value == null || value.isBlank();
    }

    private static String required(String value, String code, String message) {
        if (blank(value)) throw new BackendException(code, message);
        return value;
    }

    public record AdjustmentResult(AnalysisFollowUp followUp, Map<String, Object> diff) {}

    private record DateRange(LocalDate from, LocalDate to) {}

    private record Conclusion(String title, String summary) {}

    public static final class FollowUpConflictException extends RuntimeException {
        private final List<Map<String, Object>> conflicts;

        public FollowUpConflictException(List<Map<String, Object>> conflicts) {
            super("发现冲突条件，确认后才会覆盖当前轮次上下文。");
            this.conflicts = List.copyOf(conflicts);
        }

        public List<Map<String, Object>> conflicts() {
            return conflicts;
        }
    }
}
