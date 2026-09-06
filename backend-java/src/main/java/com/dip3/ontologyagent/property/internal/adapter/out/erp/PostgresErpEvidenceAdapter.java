package com.dip3.ontologyagent.property.internal.adapter.out.erp;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.property.internal.adapter.out.postgres.PropertyCanonicalScope;
import com.dip3.ontologyagent.property.internal.application.PropertyDataProducts;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.tooling.Evidence;
import com.dip3.ontologyagent.property.internal.application.EvidenceProvider;
import com.dip3.ontologyagent.property.internal.domain.AnalysisRuntimeCapability;
import com.dip3.ontologyagent.property.internal.domain.WorkflowRequest;
import org.springframework.stereotype.Component;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

@Component("erpEvidenceProvider")
public final class PostgresErpEvidenceAdapter implements EvidenceProvider {
    private static final List<String> PAYMENT_SUBJECTS = List.of(
            "已缴款", "红冲", "退款", "押金类转", "押金类转红冲", "临时缴款",
            "预收款结转", "预收款结转红冲", "退款转预收");
    private final JdbcTemplate jdbc;
    private final PropertyCanonicalScope scopes;
    private final TransactionTemplate readOnly;

    public PostgresErpEvidenceAdapter(JdbcTemplate jdbc, PropertyCanonicalScope scopes,
                                      PlatformTransactionManager transactionManager) {
        this.jdbc = jdbc;
        this.scopes = scopes;
        this.readOnly = new TransactionTemplate(transactionManager);
        this.readOnly.setReadOnly(true);
        this.readOnly.setIsolationLevel(TransactionDefinition.ISOLATION_REPEATABLE_READ);
    }

    @Override
    public Evidence collect(AuthSession owner, WorkflowRequest request) {
        AnalysisRuntimeCapability.validateKeys(request);
        PropertyCanonicalScope.Resolved scope = scopes.resolve(owner, request);
        List<Map<String, Object>> rows;
        try {
            rows = readOnly.execute(status -> query(scope, request.from(), request.to()));
        } catch (BackendException error) {
            throw error;
        } catch (RuntimeException error) {
            throw new BackendException("PROPERTY_FACTS_READ_FAILED",
                    "物业 canonical facts 读取失败（" + error.getClass().getSimpleName() + "）。", error);
        }
        if (rows == null) {
            throw new BackendException("PROPERTY_FACTS_READ_FAILED", "物业 canonical facts 未返回查询结果。");
        }
        return new Evidence("erp-staging", "ERP 范围内收费事实", rows,
                scope.provenance(request.ontologyVersionId(),
                        PropertyDataProducts.RECEIVABLE, PropertyDataProducts.PAYMENT));
    }

    private List<Map<String, Object>> query(PropertyCanonicalScope.Resolved scope,
                                             LocalDate from, LocalDate to) {
        Boolean transactionReadOnly = jdbc.queryForObject(
                "select current_setting('transaction_read_only')='on'", Boolean.class);
        if (!Boolean.TRUE.equals(transactionReadOnly)) {
            throw new BackendException("PROPERTY_READ_ONLY_TRANSACTION_REQUIRED",
                    "物业 canonical facts 读取未处于 PostgreSQL READ ONLY 事务。");
        }
        String projects = placeholders(scope.projectIds().size());
        String subjects = placeholders(PAYMENT_SUBJECTS.size());
        List<Object> arguments = new ArrayList<>();
        arguments.add(scope.version(PropertyDataProducts.RECEIVABLE));
        arguments.addAll(scope.projectIds());
        arguments.add(from.withDayOfMonth(1));
        arguments.add(to.withDayOfMonth(1));
        arguments.add(scope.version(PropertyDataProducts.PAYMENT));
        arguments.addAll(scope.projectIds());
        arguments.addAll(PAYMENT_SUBJECTS);
        arguments.add(from.withDayOfMonth(1));
        arguments.add(to.withDayOfMonth(1));
        arguments.add(from);
        arguments.add(to);
        return jdbc.queryForList("""
                with receivables as (
                  select r.project_id,max(r.project_name) as project_name,
                         coalesce(sum(r.receivable_amount),0) as receivable_amount,
                         coalesce(sum(r.arrears_amount),0) as arrears_amount
                  from facts.property_receivable r
                  where r.product_version_id=? and r.project_id in (%s)
                    and not r.is_deleted and r.is_checked and r.charge_item_type='1'
                    and r.receivable_accounting_period between ? and ?
                  group by r.project_id
                ), payments as (
                  select p.project_id,coalesce(sum(p.paid_amount),0) as paid_amount
                  from facts.property_payment p
                  where p.product_version_id=? and p.project_id in (%s)
                    and not p.is_deleted and p.is_entered_account
                    and (p.refund_status is null or p.refund_status!='待退款')
                    and coalesce(p.collection_type,0)!=1
                    and p.subject_code in (%s)
                    and p.is_charge_deleted=false and p.is_charge_checked=true
                    and p.charge_item_type='1'
                    and p.receivable_accounting_period between ? and ?
                    and (p.payment_date at time zone 'Asia/Taipei')::date between ? and ?
                  group by p.project_id
                )
                select r.project_id as "projectId",r.project_name as "projectName",
                       r.receivable_amount as "receivableAmount",
                       coalesce(p.paid_amount,0) as "paidAmount",
                       r.arrears_amount as "arrearsAmount"
                from receivables r left join payments p on p.project_id=r.project_id
                order by r.project_id
                """.formatted(projects, projects, subjects), arguments.toArray());
    }

    private static String placeholders(int count) {
        return String.join(",", Collections.nCopies(count, "?"));
    }
}
