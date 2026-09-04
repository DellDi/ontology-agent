package com.dip3.ontologyagent.property.internal.adapter.out.cube;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.config.BackendProperties;
import com.dip3.ontologyagent.integration.cube.OntologyMetricVariantMapper;
import com.dip3.ontologyagent.integration.cube.OntologyMetricVariantEntity;
import com.dip3.ontologyagent.integration.cube.OntologyTimeSemanticMapper;
import com.dip3.ontologyagent.integration.cube.OntologyTimeSemanticEntity;
import com.dip3.ontologyagent.integration.erp.ScopedProjectResolver;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.support.JsonCodec;
import com.dip3.ontologyagent.tooling.Evidence;
import com.dip3.ontologyagent.property.internal.application.EvidenceProvider;
import com.dip3.ontologyagent.property.internal.domain.AnalysisRuntimeCapability;
import com.dip3.ontologyagent.property.internal.domain.WorkflowRequest;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Component("cubeEvidenceProvider")
public final class CubeEvidenceAdapter implements EvidenceProvider {
    private final OntologyMetricVariantMapper metrics;
    private final OntologyTimeSemanticMapper times;
    private final JsonCodec json;
    private final ScopedProjectResolver scopedProjects;
    private final RestClient http;
    private final String loadUrl;
    private final String secret;

    public CubeEvidenceAdapter(OntologyMetricVariantMapper metrics, OntologyTimeSemanticMapper times,
                               JsonCodec json, ScopedProjectResolver scopedProjects, BackendProperties properties) {
        this.metrics = metrics;
        this.times = times;
        this.json = json;
        this.scopedProjects = scopedProjects;
        var config = properties.cube();
        var requestFactory = new SimpleClientHttpRequestFactory();
        requestFactory.setConnectTimeout(config.timeout());
        requestFactory.setReadTimeout(config.timeout());
        this.http = RestClient.builder().requestFactory(requestFactory).build();
        this.loadUrl = config.apiUrl().replaceAll("/+$", "") + "/load";
        this.secret = config.apiSecret();
    }

    @Override
    public Evidence collect(AuthSession owner, WorkflowRequest request) {
        AnalysisRuntimeCapability.validateKeys(request);
        MetricMapping mapping = metric(request.ontologyVersionId(), request.metricVariantKey());
        if (mapping.numeratorMetricKey() != null && mapping.denominatorMetricKey() != null) {
            MetricMapping numeratorMetric = metric(request.ontologyVersionId(), mapping.numeratorMetricKey());
            MetricMapping denominatorMetric = metric(request.ontologyVersionId(), mapping.denominatorMetricKey());
            TimeMapping cohort = time(request.ontologyVersionId(), request.timeSemanticKey());
            TimeMapping payment = time(request.ontologyVersionId(), "payment-date");
            List<Map<String, Object>> numerator = load(owner, request, numeratorMetric, List.of(cohort, payment), true);
            List<Map<String, Object>> denominator = load(owner, request, denominatorMetric, List.of(cohort), false);
            double numeratorTotal = total(numerator, numeratorMetric.cubeMeasure());
            double denominatorTotal = total(denominator, denominatorMetric.cubeMeasure());
            if (denominatorTotal <= 0) {
                throw new BackendException("CUBE_RATIO_DENOMINATOR_INVALID", "Cube 比率指标分母必须大于零，不能生成归因结论。");
            }
            return new Evidence("cube", "Cube 受治理语义指标", List.of(Map.of(
                    "metricDefinition", request.metricDefinitionKey(), "metricVariant", request.metricVariantKey(),
                    "value", ratio(numeratorTotal, denominatorTotal),
                    "numerator", numeratorTotal, "denominator", denominatorTotal,
                    "numeratorRowCount", numerator.size(), "denominatorRowCount", denominator.size(),
                    "from", request.from().toString(), "to", request.to().toString())));
        }
        return new Evidence("cube", "Cube 受治理语义指标",
                load(owner, request, mapping,
                        List.of(time(request.ontologyVersionId(), request.timeSemanticKey())), false));
    }

    private List<Map<String, Object>> load(AuthSession owner, WorkflowRequest request, MetricMapping metric,
                                           List<TimeMapping> timeMappings, boolean allowEmpty) {
        if (metric.cubeMeasure() == null || metric.cubeMeasure().indexOf('.') < 1) {
            throw new BackendException("CUBE_MAPPING_INVALID", "指标 " + metric.businessKey() + " 缺少 cubeMeasure。");
        }
        String cubeName = metric.cubeMeasure().substring(0, metric.cubeMeasure().indexOf('.'));
        String scopeMember = cubeName + ".projectId";
        List<String> scopeValues = scopedProjects.resolve(owner, request.projectIds());
        Map<String, Object> query = new LinkedHashMap<>();
        query.put("measures", List.of(metric.cubeMeasure()));
        query.put("dimensions", List.of(cubeName + ".projectId", cubeName + ".projectName"));
        query.put("filters", List.of(Map.of("member", scopeMember, "operator", "equals", "values", scopeValues)));
        query.put("timeDimensions", timeMappings.stream().map(time -> Map.of(
                "dimension", replaceCube(time.cubeDimension(), cubeName),
                "dateRange", List.of(request.from().toString(), request.to().toString()),
                "granularity", time.granularity())).toList());
        query.put("timezone", "Asia/Taipei");
        query.put("limit", 5000);
        try {
            String response = http.post().uri(loadUrl).contentType(MediaType.APPLICATION_JSON)
                    .header("Authorization", token()).body(Map.of("query", query)).retrieve().body(String.class);
            if (response == null || response.isBlank()) {
                throw new BackendException("CUBE_RESPONSE_INVALID", "Cube 返回空响应。");
            }
            Object data = json.map(response).get("data");
            if (!(data instanceof List<?> list)) {
                throw new BackendException("CUBE_RESPONSE_INVALID", "Cube 响应缺少 data 数组。");
            }
            if (list.isEmpty()) {
                if (allowEmpty) return List.of();
                throw new BackendException("CUBE_EVIDENCE_EMPTY", "Cube 指标查询没有返回证据行。");
            }
            if (list.size() >= 5000) {
                throw new BackendException("CUBE_RESULT_TRUNCATED", "Cube 查询达到 5000 行上限，禁止截断后生成结论。");
            }
            return list.stream().map(item -> {
                if (!(item instanceof Map<?, ?> row)) {
                    throw new BackendException("CUBE_RESPONSE_INVALID", "Cube data 中存在非对象记录。");
                }
                Map<String, Object> copy = new LinkedHashMap<>();
                row.forEach((key, value) -> copy.put(String.valueOf(key), value));
                requireValue(copy, metric.cubeMeasure());
                requireScopedProject(copy, cubeName + ".projectId", scopeValues);
                requireValue(copy, cubeName + ".projectName");
                return copy;
            }).toList();
        } catch (RestClientResponseException error) {
            throw new BackendException("CUBE_RESPONSE_ERROR",
                    "Cube 请求失败，HTTP " + error.getStatusCode().value() + "。", error);
        } catch (RestClientException error) {
            throw new BackendException("CUBE_UNAVAILABLE", "Cube 语义查询不可用。", error);
        }
    }

    private MetricMapping metric(String versionId, String key) {
        OntologyMetricVariantEntity row = metrics.selectOne(new QueryWrapper<OntologyMetricVariantEntity>()
                .eq("ontology_version_id", versionId).eq("business_key", key)
                .eq("status", "approved").orderByDesc("updated_at").last("limit 1"));
        if (row == null) {
            throw new BackendException("CUBE_MAPPING_NOT_APPROVED", "指标 " + key + " 没有已批准的 Cube 映射。");
        }
        Map<String, Object> mapping = row.cubeViewMapping;
        if (mapping == null || !"project-scope".equals(row.semanticDiscriminator)
                || row.filterTemplate != null && !row.filterTemplate.isEmpty()) {
            throw new BackendException("CUBE_MAPPING_INVALID", "指标 " + key + " 不符合固定项目口径语义。");
        }
        MetricMapping result = new MetricMapping(row.businessKey, text(mapping, "cubeMeasure"),
                text(mapping, "numeratorMetricKey"), text(mapping, "denominatorMetricKey"),
                text(mapping, "formula"));
        validateMetricMapping(row, result);
        return result;
    }

    private TimeMapping time(String versionId, String key) {
        OntologyTimeSemanticEntity row = times.selectOne(new QueryWrapper<OntologyTimeSemanticEntity>()
                .eq("ontology_version_id", versionId).eq("business_key", key)
                .eq("status", "approved").orderByDesc("updated_at").last("limit 1"));
        TimeMapping mapping = row == null ? null
                : new TimeMapping(row.businessKey, text(row.cubeTimeDimensionMapping, "cubeDimension"),
                row.defaultGranularity);
        if (mapping == null || mapping.cubeDimension() == null || mapping.granularity() == null
                || !validTimeMapping(row, mapping)) {
            throw new BackendException("CUBE_TIME_MAPPING_NOT_APPROVED",
                    "时间语义 " + key + " 没有完整的 Cube 映射。");
        }
        return mapping;
    }

    private static void validateMetricMapping(OntologyMetricVariantEntity row, MetricMapping mapping) {
        boolean valid = "collection-rate".equals(row.parentMetricDefinitionId) && switch (mapping.businessKey()) {
            case "project-collection-rate" -> mapping.cubeMeasure() == null
                    && "project-paid-amount".equals(mapping.numeratorMetricKey())
                    && "project-receivable-amount".equals(mapping.denominatorMetricKey())
                    && "project-paid-amount / project-receivable-amount * 100".equals(mapping.formula());
            case "project-paid-amount" -> "FinancePayments.paidAmount".equals(mapping.cubeMeasure())
                    && mapping.numeratorMetricKey() == null && mapping.denominatorMetricKey() == null
                    && mapping.formula() == null;
            case "project-receivable-amount" -> "FinanceReceivables.receivableAmount".equals(mapping.cubeMeasure())
                    && mapping.numeratorMetricKey() == null && mapping.denominatorMetricKey() == null
                    && mapping.formula() == null;
            default -> false;
        };
        if (!valid) {
            throw new BackendException("CUBE_MAPPING_INVALID",
                    "指标 " + mapping.businessKey() + " 不符合固定项目收缴率映射。");
        }
    }

    private static boolean validTimeMapping(OntologyTimeSemanticEntity row, TimeMapping mapping) {
        if (row.calculationRule != null && !row.calculationRule.isEmpty()) return false;
        return switch (mapping.businessKey()) {
            case "receivable-accounting-period" -> "accounting-period".equals(row.semanticType)
                    && Map.of("receivable", "shouldAccountBook").equals(row.entityDateFieldMapping)
                    && "FinanceReceivables.receivableAccountingPeriod".equals(mapping.cubeDimension())
                    && "year".equals(mapping.granularity());
            case "payment-date" -> "transaction-date".equals(row.semanticType)
                    && Map.of("payment", "operatorDate").equals(row.entityDateFieldMapping)
                    && "FinancePayments.paymentDate".equals(mapping.cubeDimension())
                    && "month".equals(mapping.granularity());
            default -> false;
        };
    }

    private String token() {
        try {
            long issuedAt = Instant.now().getEpochSecond();
            String header = base64(json.write(Map.of("alg", "HS256", "typ", "JWT")));
            String payload = base64(json.write(Map.of("iat", issuedAt, "exp", issuedAt + 2592000)));
            String unsigned = header + "." + payload;
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return unsigned + "." + Base64.getUrlEncoder().withoutPadding()
                    .encodeToString(mac.doFinal(unsigned.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception error) {
            throw new BackendException("CUBE_TOKEN_FAILED", "Cube API token 生成失败。", error);
        }
    }

    private static String base64(String value) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(value.getBytes(StandardCharsets.UTF_8));
    }

    private static String replaceCube(String member, String cubeName) {
        int dot = member.indexOf('.');
        if (dot < 1) throw new BackendException("CUBE_TIME_MAPPING_INVALID", "Cube 时间维度必须包含视图名。");
        return cubeName + member.substring(dot);
    }

    private static String text(Map<String, Object> source, String key) {
        if (source == null) return null;
        Object value = source.get(key);
        return value instanceof String string && !string.isBlank() ? string : null;
    }

    static double total(List<Map<String, Object>> rows, String measure) {
        double total = 0;
        for (Map<String, Object> row : rows) {
            Object value = requireValue(row, measure);
            try {
                double numeric = value instanceof Number number ? number.doubleValue() : Double.parseDouble(value.toString());
                if (!Double.isFinite(numeric)) throw new NumberFormatException("non-finite");
                total += numeric;
            } catch (NumberFormatException error) {
                throw new BackendException("CUBE_RESPONSE_INVALID",
                        "Cube 指标 " + measure + " 返回了非数值结果。", error);
            }
        }
        return total;
    }

    static double ratio(double numerator, double denominator) {
        if (!Double.isFinite(numerator) || !Double.isFinite(denominator) || denominator <= 0) {
            throw new BackendException("CUBE_RATIO_DENOMINATOR_INVALID", "Cube 比率指标分母必须大于零，不能生成归因结论。");
        }
        return BigDecimal.valueOf(numerator).multiply(BigDecimal.valueOf(100))
                .divide(BigDecimal.valueOf(denominator), 4, RoundingMode.HALF_UP).doubleValue();
    }

    private static Object requireValue(Map<String, Object> row, String key) {
        Object value = row.get(key);
        if (value == null || value.toString().isBlank()) {
            throw new BackendException("CUBE_RESPONSE_INVALID", "Cube 响应缺少字段 " + key + "。");
        }
        return value;
    }

    static void requireScopedProject(Map<String, Object> row, String key, List<String> allowedProjectIds) {
        Object projectId = requireValue(row, key);
        if (!allowedProjectIds.contains(projectId.toString())) {
            throw new BackendException("CUBE_SCOPE_VIOLATION", "Cube 返回了请求授权范围外的项目。");
        }
    }

    private record MetricMapping(String businessKey, String cubeMeasure,
                                 String numeratorMetricKey, String denominatorMetricKey, String formula) {}
    private record TimeMapping(String businessKey, String cubeDimension, String granularity) {}
}
