package com.dip3.ontologyagent.ontology.bootstrap;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.ontology.OntologyCatalog;
import com.dip3.ontologyagent.ontology.OntologyRepository;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.tooling.AnalysisWorkflow;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import static com.dip3.ontologyagent.ontology.bootstrap.OntologyBootstrapResponses.Result;
import static com.dip3.ontologyagent.ontology.bootstrap.OntologyBootstrapResponses.Status;

@Service
public class OntologyBootstrapService {
    private final OntologyBootstrapRepository repository;
    private final OntologyRepository ontologies;

    public OntologyBootstrapService(OntologyBootstrapRepository repository, OntologyRepository ontologies) {
        this.repository = repository;
        this.ontologies = ontologies;
    }

    @Transactional(readOnly = true)
    public Status status(AuthSession actor) {
        requireAdmin(actor);
        return inspect();
    }

    @Transactional
    public Result bootstrap(AuthSession actor, String correlationId) {
        requireAdmin(actor);
        repository.lock();
        Status current = inspect();
        if (current.ready()) return new Result(false, current, correlationId);

        Instant now = Instant.now();
        repository.insertBaseline(actor.userId(), now);
        Status created = inspect();
        if (!created.ready()) {
            throw new BackendException("ONTOLOGY_BOOTSTRAP_WRITE_FAILED", "固定本体基线写入后仍未达到可运行状态。");
        }
        repository.audit(actor, correlationId, now);
        return new Result(true, created, correlationId);
    }

    private Status inspect() {
        OntologyBootstrapRepository.RegistrySnapshot snapshot = repository.snapshot();
        List<OntologyBootstrapRepository.CurrentVersion> current = repository.currentVersions();
        if (current.size() > 1) {
            throw new BackendException("ONTOLOGY_BOOTSTRAP_MULTIPLE_CURRENT",
                    "数据库存在多个当前发布本体版本，必须先修复事实源。");
        }
        if (current.isEmpty()) {
            if (!snapshot.empty()) {
                throw new BackendException("ONTOLOGY_BOOTSTRAP_PARTIAL_STATE",
                        "数据库已有本体相关数据但没有当前发布版本，禁止覆盖半成品状态。");
            }
            return new Status("empty", false, null, null, Map.of());
        }

        OntologyBootstrapRepository.CurrentVersion version = current.getFirst();
        Map<String, Long> counts = repository.definitionCounts(version.id());
        List<String> issues = repository.integrityIssues(version.id());
        if (!issues.isEmpty() || repository.publishRecordCount(version.id()) != 1) {
            throw incomplete(version.id(), issues.isEmpty() ? "missing:publish_record" : String.join(", ", issues), null);
        }
        for (Map.Entry<String, Long> required : CanonicalOntologyBaseline.minimumCounts().entrySet()) {
            if (counts.getOrDefault(required.getKey(), 0L) < required.getValue()) {
                throw incomplete(version.id(), "missing-runtime-count:" + required.getKey(), null);
            }
        }
        try {
            OntologyCatalog catalog = ontologies.published(version.id());
            AnalysisWorkflow.validateCatalog(catalog);
        } catch (BackendException error) {
            throw incomplete(version.id(), error.code() + ": " + error.getMessage(), error);
        }
        return new Status("ready", true, version.id(), version.semver(), counts);
    }

    private static BackendException incomplete(String versionId, String issue, Throwable cause) {
        return new BackendException("ONTOLOGY_BOOTSTRAP_INCOMPLETE_CURRENT",
                "当前本体版本 " + versionId + " 不满足 Java 运行时完整性：" + issue, cause);
    }

    private static void requireAdmin(AuthSession actor) {
        if (!actor.scope().roleCodes().contains("PLATFORM_ADMIN")) {
            throw new BackendException("ONTOLOGY_BOOTSTRAP_FORBIDDEN", "只有 PLATFORM_ADMIN 可以初始化本体基线。");
        }
    }
}
