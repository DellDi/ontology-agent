package com.dip3.ontologyagent.ontology;

import com.dip3.ontologyagent.support.BackendException;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public class OntologyRepository {
    private final OntologyMapper mapper;

    public OntologyRepository(OntologyMapper mapper) {
        this.mapper = mapper;
    }

    public OntologyCatalog currentPublished() {
        OntologyVersionEntity version = mapper.currentPublished();
        if (version == null) {
            throw new BackendException("ONTOLOGY_NOT_PUBLISHED", "没有可用于运行时的已发布本体版本。");
        }
        return catalog(version);
    }

    public OntologyCatalog published(String versionId) {
        OntologyVersionEntity version = mapper.publishedById(versionId);
        if (version == null) {
            OntologyVersionEntity known = mapper.versionById(versionId);
            if (known != null && "retired".equals(known.status)) {
                throw new BackendException("ONTOLOGY_PIN_RETIRED", "执行绑定的本体版本已退役，禁止继续运行。");
            }
            if (known != null) {
                throw new BackendException("ONTOLOGY_PIN_NOT_PUBLISHED", "执行绑定的本体版本尚未发布为可运行版本。");
            }
            throw new BackendException("ONTOLOGY_PIN_NOT_FOUND", "执行绑定的本体版本不存在。");
        }
        return catalog(version);
    }

    public OntologyCatalog approvedCandidate(String versionId) {
        OntologyVersionEntity version = mapper.versionById(versionId);
        if (version == null || !"approved".equals(version.status) || version.publishedAt != null) {
            throw new BackendException("ONTOLOGY_PUBLISH_CONFLICT",
                    "发布校验只能读取尚未发布的 approved 本体版本。");
        }
        return catalog(version);
    }

    private OntologyCatalog catalog(OntologyVersionEntity version) {
        return new OntologyCatalog(version.id, version.semver, items(mapper.entities(version.id)),
                items(mapper.metrics(version.id)), items(mapper.metricVariants(version.id)),
                items(mapper.factors(version.id)), items(mapper.timeSemantics(version.id)),
                items(mapper.planSteps(version.id)),
                mapper.toolBindings(version.id).stream().map(row -> new OntologyCatalog.ToolBinding(row.id,
                        row.toolName, row.stepTemplateKey, row.capabilityTag, row.activationConditions,
                        row.priority)).toList());
    }

    private static List<OntologyCatalog.Item> items(List<OntologyDefinitionEntity> rows) {
        return rows.stream().map(row -> new OntologyCatalog.Item(row.businessKey, row.displayName, row.metadata)).toList();
    }
}
