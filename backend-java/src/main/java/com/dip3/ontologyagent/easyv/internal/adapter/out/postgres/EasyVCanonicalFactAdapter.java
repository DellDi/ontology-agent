package com.dip3.ontologyagent.easyv.internal.adapter.out.postgres;

import com.dip3.ontologyagent.easyv.internal.application.EasyVGenerationFacts;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVGenerationOntology;
import com.dip3.ontologyagent.ingestion.api.DatasetVersionSet;
import com.dip3.ontologyagent.ingestion.api.DatasetVersionSetRegistry;
import com.dip3.ontologyagent.support.BackendException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/** Creator-scoped EasyV analysis over immutable, execution-pinned canonical facts. */
public final class EasyVCanonicalFactAdapter implements EasyVGenerationFacts {
    public static final ZoneId BUSINESS_ZONE = ZoneId.of("Asia/Shanghai");
    public static final String ACCESS_MODE = "creator-owned";
    public static final Set<String> REQUIRED_PRODUCTS =
            EasyVGenerationOntology.REQUIRED_DATA_PRODUCT_KEYS;
    public static final Map<String, String> TIME_SEMANTICS = Map.of(
            "application", "cohort=facts.easyv_ai_application.created_at",
            "pipeline", "cohort=application.created_at;event=facts.easyv_pipeline_node.created_at",
            "forge", "cohort=application.created_at;event=facts.easyv_forge_generation_task.created_at",
            "feedback", "cohort=application.created_at;event=facts.easyv_generation_feedback.operated_at");
    private static final String USER_ID_PATTERN = "[1-9][0-9]*";

    private final JdbcTemplate jdbc;
    private final TransactionTemplate readOnlyTransaction;
    private final DatasetVersionSetRegistry versionSets;

    public EasyVCanonicalFactAdapter(
            JdbcTemplate jdbc,
            PlatformTransactionManager transactionManager,
            DatasetVersionSetRegistry versionSets) {
        this.jdbc = jdbc;
        this.readOnlyTransaction = new TransactionTemplate(transactionManager);
        this.readOnlyTransaction.setReadOnly(true);
        this.readOnlyTransaction.setIsolationLevel(TransactionDefinition.ISOLATION_REPEATABLE_READ);
        this.versionSets = versionSets;
    }

    @Override
    public Snapshot collect(Query query) {
        validateQuery(query);
        try {
            DatasetVersionSet set = versionSets.requireFrozen(
                    query.datasetVersionSetId(), REQUIRED_PRODUCTS);
            Snapshot result = readOnlyTransaction.execute(status -> collectReadOnly(query, set));
            if (result == null) {
                throw new BackendException("EASYV_FACTS_EMPTY", "EasyV canonical facts 未返回分析事实。");
            }
            return result;
        } catch (BackendException error) {
            throw error;
        } catch (RuntimeException error) {
            throw new BackendException("EASYV_FACTS_READ_FAILED",
                    "EasyV canonical facts 读取失败（" + error.getClass().getSimpleName() + "）。", error);
        }
    }

    private Snapshot collectReadOnly(Query query, DatasetVersionSet set) {
        Boolean readOnly = jdbc.queryForObject(
                "select current_setting('transaction_read_only')='on'", Boolean.class);
        if (!Boolean.TRUE.equals(readOnly)) {
            throw new BackendException("EASYV_READ_ONLY_TRANSACTION_REQUIRED",
                    "EasyV canonical facts 读取未处于 PostgreSQL READ ONLY 事务。");
        }
        Versions versions = Versions.from(set);
        Bounds bounds = Bounds.of(query);
        assertNoFutureFacts(query, versions, bounds, set.capturedAt());
        assertNoOrphanFeedback(query, versions, bounds);
        ApplicationFacts application = applicationFacts(query, versions, bounds, set.capturedAt());
        PipelineFacts pipeline = pipelineFacts(query, versions, bounds, set.capturedAt());
        ForgeFacts forge = forgeFacts(query, versions, bounds, set.capturedAt());
        FeedbackFacts feedback = feedbackFacts(query, versions, bounds, set.capturedAt());
        if (application.applicationCount() == 0 || pipeline.taskCount() == 0
                || forge.taskCount() == 0 || feedback.operationCount() == 0) {
            throw new BackendException("EASYV_FACTS_EMPTY",
                    "EasyV 授权范围内缺少可分析的四类 canonical facts。");
        }
        return new Snapshot(application, pipeline, forge, feedback);
    }

    private ApplicationFacts applicationFacts(
            Query query, Versions versions, Bounds bounds, Instant freshnessAt) {
        Map<String, Object> row = jdbc.queryForMap("""
                select count(distinct a.app_id) as application_count,
                       count(distinct p.app_id) as prototype_count
                from facts.easyv_ai_application a
                left join facts.easyv_prototype_task p
                  on p.product_version_id=? and p.app_id=a.app_id
                where a.product_version_id=? and a.user_id=?
                  and a.created_at>=? and a.created_at<?
                """, versions.prototype(), versions.application(), dbUserId(query),
                bounds.from(), bounds.to());
        return new ApplicationFacts(window(query, freshnessAt),
                number(row, "application_count"), number(row, "prototype_count"));
    }

    private PipelineFacts pipelineFacts(
            Query query, Versions versions, Bounds bounds, Instant freshnessAt) {
        Map<String, Object> counts = jdbc.queryForMap("""
                with task_ids as (
                  select distinct a.generation_task_id as task_id
                  from facts.easyv_ai_application a
                  where a.product_version_id=? and a.user_id=?
                    and a.created_at>=? and a.created_at<?
                    and a.generation_task_id is not null
                ), summary as (
                  select t.task_id,
                    bool_or(upper(n.branch)='MAIN' and upper(n.step_name)='PIPELINECOMPLETED'
                      and upper(n.status)='SUCCESS') as completed,
                    bool_or(upper(n.branch)='MAIN' and upper(n.status)='FAILED') as failed
                  from task_ids t left join facts.easyv_pipeline_node n
                    on n.product_version_id=? and n.task_id=t.task_id
                   and n.created_at>=? and n.created_at<?
                  group by t.task_id
                )
                select count(*) as task_count,
                  count(*) filter (where completed and not failed) as completed_count,
                  count(*) filter (where failed and not completed) as failed_count,
                  count(*) filter (where not completed and not failed) as incomplete_count,
                  count(*) filter (where completed and failed) as conflict_count
                from summary
                """, versions.application(), dbUserId(query), bounds.from(), bounds.to(),
                versions.pipeline(), bounds.from(), bounds.to());
        if (number(counts, "conflict_count") > 0) {
            throw new BackendException("EASYV_FACTS_TASK_CONFLICT",
                    "EasyV 原型任务同时出现成功和失败终态，无法确定归并结果。");
        }
        if (number(counts, "task_count") == 0) {
            throw new BackendException("EASYV_FACTS_EMPTY", "EasyV 授权范围内没有原型流水线任务事实。");
        }
        Map<String, Object> coverage = jdbc.queryForMap("""
                with scoped as (
                  select distinct a.generation_task_id
                  from facts.easyv_ai_application a
                  where a.product_version_id=? and a.user_id=?
                    and a.created_at>=? and a.created_at<?
                    and a.generation_task_id is not null
                )
                select count(*) filter (where upper(n.branch)='MAIN') as main_node_count,
                  count(*) filter (where upper(n.branch)='MAIN' and n.duration_ms is not null)
                    as timed_node_count
                from scoped s join facts.easyv_pipeline_node n
                  on n.product_version_id=? and n.task_id=s.generation_task_id
                where n.created_at>=? and n.created_at<?
                """, versions.application(), dbUserId(query), bounds.from(), bounds.to(),
                versions.pipeline(), bounds.from(), bounds.to());
        long timedNodeCount = number(coverage, "timed_node_count");
        if (timedNodeCount == 0) {
            throw new BackendException("EASYV_FACTS_DURATION_MISSING",
                    "EasyV 原型阶段没有可计算耗时的主链节点记录。");
        }
        Map<String, Object> bottleneck = jdbc.queryForList("""
                select n.step_name,
                  ceil(percentile_cont(0.95) within group (order by n.duration_ms))::bigint as p95
                from facts.easyv_ai_application a join facts.easyv_pipeline_node n
                  on n.product_version_id=? and n.task_id=a.generation_task_id
                where a.product_version_id=? and a.user_id=?
                  and a.created_at>=? and a.created_at<?
                  and n.created_at>=? and n.created_at<?
                  and upper(n.branch)='MAIN' and n.duration_ms is not null
                group by n.step_name order by p95 desc,n.step_name asc limit 1
                """, versions.pipeline(), versions.application(), dbUserId(query),
                bounds.from(), bounds.to(), bounds.from(), bounds.to())
                .stream().findFirst().orElseThrow(() -> new BackendException(
                        "EASYV_FACTS_INCOMPLETE", "EasyV 原型阶段缺少可计算耗时的主链节点记录。"));
        String step = String.valueOf(bottleneck.get("step_name"));
        if (step.isBlank() || "null".equals(step)) {
            throw new BackendException("EASYV_FACTS_INCOMPLETE", "EasyV 原型阶段未返回稳定阶段名称。");
        }
        return new PipelineFacts(window(query, freshnessAt), number(counts, "task_count"),
                number(counts, "completed_count"), number(counts, "failed_count"),
                number(counts, "incomplete_count"), number(coverage, "main_node_count"),
                timedNodeCount, step, number(bottleneck, "p95"));
    }

    private ForgeFacts forgeFacts(
            Query query, Versions versions, Bounds bounds, Instant freshnessAt) {
        Map<String, Object> counts = jdbc.queryForMap("""
                with scoped as (
                  select distinct a.app_id from facts.easyv_ai_application a
                  where a.product_version_id=? and a.user_id=?
                    and a.created_at>=? and a.created_at<?
                )
                select count(distinct g.task_id) as task_count,
                  count(distinct g.task_id) filter (where lower(g.status)='completed') as completed_count,
                  count(distinct g.task_id) filter (where lower(g.status)='failed') as failed_count,
                  count(distinct g.task_id) filter (where lower(g.status)='cancelled') as cancelled_count,
                  count(distinct g.task_id) filter (where lower(g.status) in ('completed','failed','cancelled'))
                    as terminal_task_count,
                  count(distinct g.task_id) filter (where lower(g.status) not in ('completed','failed','cancelled'))
                    as incomplete_count
                from scoped s join facts.easyv_forge_generation_task g
                  on g.product_version_id=? and g.app_id=s.app_id
                where g.created_at>=? and g.created_at<?
                """, versions.application(), dbUserId(query), bounds.from(), bounds.to(),
                versions.forge(), bounds.from(), bounds.to());
        if (number(counts, "incomplete_count") > 0) {
            throw new BackendException("EASYV_FACTS_INCOMPLETE", "EasyV Forge 存在未终态或未知状态任务。");
        }
        if (number(counts, "task_count") == 0) {
            throw new BackendException("EASYV_FACTS_EMPTY", "EasyV 授权范围内没有 Forge 任务事实。");
        }
        Map<String, Object> duration = jdbc.queryForMap("""
                with scoped as (
                  select distinct a.app_id from facts.easyv_ai_application a
                  where a.product_version_id=? and a.user_id=?
                    and a.created_at>=? and a.created_at<?
                )
                select count(distinct g.task_id) filter (
                    where lower(g.status) in ('completed','failed','cancelled')) as terminal_task_count,
                  count(distinct g.task_id) filter (
                    where lower(g.status) in ('completed','failed','cancelled')
                      and g.started_at is not null and g.finished_at is not null)
                    as timed_terminal_task_count,
                  ceil(percentile_cont(0.50) within group (
                    order by extract(epoch from (g.finished_at-g.started_at))*1000)
                    filter (where lower(g.status) in ('completed','failed','cancelled')
                      and g.started_at is not null and g.finished_at is not null))::bigint as p50,
                  ceil(percentile_cont(0.95) within group (
                    order by extract(epoch from (g.finished_at-g.started_at))*1000)
                    filter (where lower(g.status) in ('completed','failed','cancelled')
                      and g.started_at is not null and g.finished_at is not null))::bigint as p95
                from facts.easyv_forge_generation_task g join scoped s on s.app_id=g.app_id
                where g.product_version_id=? and g.created_at>=? and g.created_at<?
                """, versions.application(), dbUserId(query), bounds.from(), bounds.to(),
                versions.forge(), bounds.from(), bounds.to());
        long timed = number(duration, "timed_terminal_task_count");
        if (timed == 0) {
            throw new BackendException("EASYV_FACTS_DURATION_MISSING",
                    "EasyV Forge 没有可计算耗时的终态任务记录。");
        }
        Map<String, Long> failureReasons = new LinkedHashMap<>();
        jdbc.query("""
                with scoped as (
                  select distinct a.app_id from facts.easyv_ai_application a
                  where a.product_version_id=? and a.user_id=?
                    and a.created_at>=? and a.created_at<?
                )
                select g.failure_reason_hash as bucket,count(*) as count
                from facts.easyv_forge_generation_task g join scoped s on s.app_id=g.app_id
                where g.product_version_id=? and g.created_at>=? and g.created_at<?
                  and lower(g.status)='failed'
                group by g.failure_reason_hash order by g.failure_reason_hash
                """, (RowCallbackHandler) result -> failureReasons.put(
                        "md5:" + result.getString("bucket"), result.getLong("count")),
                versions.application(), dbUserId(query), bounds.from(), bounds.to(),
                versions.forge(), bounds.from(), bounds.to());
        return new ForgeFacts(window(query, freshnessAt), number(counts, "task_count"),
                number(counts, "completed_count"), number(counts, "failed_count"),
                number(counts, "cancelled_count"), number(counts, "terminal_task_count"),
                timed, number(duration, "p50"), number(duration, "p95"), failureReasons);
    }

    private FeedbackFacts feedbackFacts(
            Query query, Versions versions, Bounds bounds, Instant freshnessAt) {
        Map<String, Object> values = jdbc.queryForMap("""
                select count(*) as operation_count,
                  count(*) filter (where l.rating between 1 and 5) as rated_count,
                  avg(l.rating) filter (where l.rating between 1 and 5) as average_rating,
                  count(*) filter (where l.is_save_as_edit is true) as save_as_edit_count,
                  count(*) filter (where l.execute_result=1) as combined_success_count,
                  count(*) filter (where l.execute_result=0) as combined_failure_count,
                  count(*) filter (where l.execute_result not in (0,1)) as unknown_result_count
                from facts.easyv_generation_feedback l join facts.easyv_ai_application a
                  on a.product_version_id=? and a.app_id=l.app_id
                where l.product_version_id=? and a.user_id=? and l.user_id=?
                  and a.created_at>=? and a.created_at<?
                  and l.operated_at>=? and l.operated_at<?
                """, versions.application(), versions.feedback(), dbUserId(query), dbUserId(query),
                bounds.from(), bounds.to(), bounds.from(), bounds.to());
        if (number(values, "unknown_result_count") > 0) {
            throw new BackendException("EASYV_FACTS_INCOMPLETE",
                    "EasyV 操作日志存在未知 execute_result 值。");
        }
        if (number(values, "operation_count") == 0) {
            throw new BackendException("EASYV_FACTS_EMPTY", "EasyV 授权范围内没有操作与反馈事实。");
        }
        if (number(values, "rated_count") == 0) {
            throw new BackendException("EASYV_FACTS_INCOMPLETE",
                    "EasyV 操作日志没有有效评分，不能把平均评分默认为 0。");
        }
        Object average = values.get("average_rating");
        return new FeedbackFacts(window(query, freshnessAt), number(values, "operation_count"),
                number(values, "rated_count"), average instanceof Number n ? n.doubleValue() : Double.NaN,
                number(values, "save_as_edit_count"), number(values, "combined_success_count"),
                number(values, "combined_failure_count"));
    }

    private void assertNoFutureFacts(
            Query query, Versions versions, Bounds bounds, Instant capturedAt) {
        long futureApp = jdbc.queryForObject("""
                select count(*) from facts.easyv_ai_application
                where product_version_id=? and user_id=? and created_at>=? and created_at<?
                  and created_at>?
                """, Long.class, versions.application(), dbUserId(query), bounds.from(), bounds.to(),
                Timestamp.from(capturedAt));
        long futureNode = jdbc.queryForObject("""
                select count(*) from facts.easyv_ai_application a
                join facts.easyv_pipeline_node n
                  on n.product_version_id=? and n.task_id=a.generation_task_id
                where a.product_version_id=? and a.user_id=?
                  and a.created_at>=? and a.created_at<?
                  and n.created_at>=? and n.created_at<? and n.created_at>?
                """, Long.class, versions.pipeline(), versions.application(), dbUserId(query),
                bounds.from(), bounds.to(), bounds.from(), bounds.to(), Timestamp.from(capturedAt));
        long futureForge = jdbc.queryForObject("""
                select count(*) from facts.easyv_ai_application a
                join facts.easyv_forge_generation_task g
                  on g.product_version_id=? and g.app_id=a.app_id
                where a.product_version_id=? and a.user_id=?
                  and a.created_at>=? and a.created_at<?
                  and g.created_at>=? and g.created_at<?
                  and (g.created_at>? or g.started_at>? or g.finished_at>?)
                """, Long.class, versions.forge(), versions.application(), dbUserId(query),
                bounds.from(), bounds.to(), bounds.from(), bounds.to(), Timestamp.from(capturedAt),
                Timestamp.from(capturedAt), Timestamp.from(capturedAt));
        long futureFeedback = jdbc.queryForObject("""
                select count(*) from facts.easyv_generation_feedback l
                join facts.easyv_ai_application a
                  on a.product_version_id=? and a.app_id=l.app_id
                where l.product_version_id=? and l.user_id=? and a.user_id=?
                  and a.created_at>=? and a.created_at<?
                  and l.operated_at>=? and l.operated_at<? and l.operated_at>?
                """, Long.class, versions.application(), versions.feedback(), dbUserId(query),
                dbUserId(query), bounds.from(), bounds.to(), bounds.from(), bounds.to(),
                Timestamp.from(capturedAt));
        if (futureApp + futureNode + futureForge + futureFeedback > 0) {
            throw new BackendException("EASYV_FACTS_FUTURE_DATA",
                    "EasyV canonical facts 包含晚于冻结集合观测时间的事件。");
        }
    }

    private void assertNoOrphanFeedback(Query query, Versions versions, Bounds bounds) {
        long orphaned = jdbc.queryForObject("""
                select count(*) from facts.easyv_generation_feedback l
                left join facts.easyv_ai_application a
                  on a.product_version_id=? and a.app_id=l.app_id and a.user_id=?
                 and a.created_at>=? and a.created_at<?
                where l.product_version_id=? and l.user_id=?
                  and l.operated_at>=? and l.operated_at<? and a.app_id is null
                """, Long.class, versions.application(), dbUserId(query), bounds.from(), bounds.to(),
                versions.feedback(), dbUserId(query), bounds.from(), bounds.to());
        if (orphaned > 0) {
            throw new BackendException("EASYV_FACTS_INCOMPLETE",
                    "EasyV 操作日志存在无法按应用 cohort 归属的记录。");
        }
    }

    private static FactWindow window(Query query, Instant freshnessAt) {
        return new FactWindow(query.userId(), ACCESS_MODE, query.from(), query.to(), freshnessAt);
    }

    private static void validateQuery(Query query) {
        if (query == null || query.userId() == null || !query.userId().matches(USER_ID_PATTERN)
                || !ACCESS_MODE.equals(query.accessMode())
                || query.datasetVersionSetId() == null || query.datasetVersionSetId().isBlank()
                || query.from() == null || query.to() == null || query.from().isAfter(query.to())
                || query.requestedAt() == null) {
            throw new BackendException("EASYV_FACTS_QUERY_INVALID",
                    "EasyV 事实查询必须使用冻结数据版本、可信数字用户 ID 和有效时间窗口。");
        }
    }

    private static long dbUserId(Query query) {
        return Long.parseLong(query.userId());
    }

    private static long number(Map<String, Object> row, String key) {
        Object value = row.get(key);
        return value instanceof Number number ? number.longValue() : 0L;
    }

    private record Bounds(Timestamp from, Timestamp to) {
        static Bounds of(Query query) {
            Instant from = query.from().atStartOfDay(BUSINESS_ZONE).toInstant();
            Instant to = query.to().plusDays(1).atStartOfDay(BUSINESS_ZONE).toInstant();
            return new Bounds(Timestamp.from(from), Timestamp.from(to));
        }
    }

    private record Versions(String application, String prototype, String pipeline,
                            String forge, String feedback) {
        static Versions from(DatasetVersionSet set) {
            Map<String, String> versions = set.productVersionIds();
            return new Versions(
                    versions.get("easyv-ai-application"),
                    versions.get("easyv-prototype-task"),
                    versions.get("easyv-pipeline-node"),
                    versions.get("easyv-forge-task"),
                    versions.get("easyv-generation-feedback"));
        }
    }
}
