package com.dip3.ontologyagent.ontology.bootstrap;

import java.util.List;

/**
 * Stable catalog keys for the EasyV generation-quality analysis baseline.
 *
 * <p>This is catalog metadata only. It intentionally does not register a runtime capability or
 * claim implementation.</p>
 */
final class EasyvCatalogBaseline {
    static final String DOMAIN_KEY = "easyv";
    static final String CAPABILITY_KEY = "generation-quality-analysis";

    static final List<String> ENTITY_KEYS = List.of(
            "easyv-ai-application",
            "prototype-generation-task",
            "pipeline-node-execution",
            "application-generation-task",
            "generation-feedback");

    static final List<String> METRIC_KEYS = List.of(
            "easyv-generation-quality",
            "forge-task-completion-rate",
            "forge-task-failure-rate",
            "forge-task-terminal-duration",
            "pipeline-stage-duration",
            "pipeline-stage-failure-count",
            "rating-coverage",
            "rating-average",
            "save-as-behavior-rate",
            "operation-settlement-success-rate");

    static final List<String> METRIC_VARIANT_KEYS = List.of(
            "forge-task-completed-count",
            "forge-task-terminal-count",
            "forge-task-failed-count",
            "forge-task-duration-p50",
            "forge-task-duration-p95",
            "pipeline-stage-duration-p50",
            "pipeline-stage-duration-p95",
            "pipeline-stage-failure-total",
            "rating-covered-operation-count",
            "rating-eligible-operation-count",
            "rating-average-score",
            "save-as-edit-count",
            "save-as-eligible-application-count",
            "operation-success-count",
            "operation-attempt-count");

    static final List<String> PLAN_KEYS = List.of(
            "easyv-validate-scope-and-time",
            "easyv-read-generation-quality-facts",
            "easyv-validate-fact-completeness",
            "easyv-render-evidence-grounded-result");

    static final List<String> TOOL_KEYS = List.of(
            "easyv-scope-resolver",
            "easyv-generation-facts-read",
            "easyv-evidence-validator",
            "easyv-structured-analysis");

    static final List<String> TIME_KEYS = List.of("easyv-generation-time");

    static final List<String> EVIDENCE_KEYS = List.of(
            "easyv-ai-application",
            "easyv-prototype-task",
            "easyv-pipeline-node",
            "easyv-forge-task",
            "easyv-generated-artifact",
            "easyv-generation-feedback");

    private EasyvCatalogBaseline() {}
}
