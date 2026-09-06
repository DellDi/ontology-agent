package com.dip3.ontologyagent.ingestion.internal.domain;

import com.dip3.ontologyagent.ingestion.api.DataProductDefinition;
import com.dip3.ontologyagent.ingestion.api.DataProductVersion;
import com.dip3.ontologyagent.ingestion.api.DatasetDefinition;
import com.dip3.ontologyagent.ingestion.api.DatasetVersion;
import com.dip3.ontologyagent.ingestion.api.DatasetVersionSet;
import com.dip3.ontologyagent.ingestion.api.IngestionCursor;
import com.dip3.ontologyagent.ingestion.api.IngestionRun;
import com.dip3.ontologyagent.ingestion.api.Lineage;
import com.dip3.ontologyagent.ingestion.api.ProductMaterializationRun;
import com.dip3.ontologyagent.ingestion.api.SourceDefinition;

import java.util.List;

/**
 * In-memory registration boundary for the two ingestion stages. It contains
 * no persistence or connector behavior; the validator checks its references
 * before a future adapter is allowed to load the catalog.
 */
public record IngestionCatalog(List<SourceDefinition> sources,
                               List<DatasetDefinition> datasets,
                               List<DataProductDefinition> products,
                               List<IngestionRun> ingestionRuns,
                               List<DatasetVersion> datasetVersions,
                               List<IngestionCursor> cursors,
                               List<ProductMaterializationRun> materializationRuns,
                               List<DataProductVersion> productVersions,
                               List<Lineage> lineages,
                               List<DatasetVersionSet> versionSets) {
    public IngestionCatalog {
        sources = copy(sources, "sources");
        datasets = copy(datasets, "datasets");
        products = copy(products, "products");
        ingestionRuns = copy(ingestionRuns, "ingestionRuns");
        datasetVersions = copy(datasetVersions, "datasetVersions");
        cursors = copy(cursors, "cursors");
        materializationRuns = copy(materializationRuns, "materializationRuns");
        productVersions = copy(productVersions, "productVersions");
        lineages = copy(lineages, "lineages");
        versionSets = copy(versionSets, "versionSets");
    }

    private static <T> List<T> copy(List<T> values, String field) {
        if (values == null || values.stream().anyMatch(value -> value == null)) {
            throw new IllegalArgumentException(field + " must not contain null");
        }
        return List.copyOf(values);
    }
}
