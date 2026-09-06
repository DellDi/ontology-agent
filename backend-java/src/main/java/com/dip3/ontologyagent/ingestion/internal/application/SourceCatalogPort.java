package com.dip3.ontologyagent.ingestion.internal.application;

import com.dip3.ontologyagent.ingestion.api.DatasetDefinition;
import com.dip3.ontologyagent.ingestion.api.IngestionCursor;
import com.dip3.ontologyagent.ingestion.api.SourceDefinition;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Loads one governed source and its active dataset contracts from the platform catalog. */
public interface SourceCatalogPort {
    SourceCatalog loadActiveSource(String sourceKey);

    record SourceCatalog(SourceDefinition source, List<DatasetDefinition> datasets,
                         List<IngestionCursor> committedCursors) {
        public SourceCatalog {
            if (source == null) throw new IllegalArgumentException("source must not be null");
            if (datasets == null || datasets.isEmpty() || datasets.stream().anyMatch(item -> item == null)) {
                throw new IllegalArgumentException("datasets must not be null or empty");
            }
            if (committedCursors == null || committedCursors.stream().anyMatch(item -> item == null)) {
                throw new IllegalArgumentException("committedCursors must not contain null");
            }
            datasets = List.copyOf(datasets);
            committedCursors = List.copyOf(committedCursors);

            Set<String> datasetKeys = new HashSet<>();
            for (DatasetDefinition dataset : datasets) {
                if (!source.sourceKey().equals(dataset.sourceKey())) {
                    throw new IllegalArgumentException("dataset belongs to another source: "
                            + dataset.datasetKey());
                }
                if (!datasetKeys.add(dataset.datasetKey())) {
                    throw new IllegalArgumentException("duplicate dataset: " + dataset.datasetKey());
                }
            }
            Set<String> cursorKeys = new HashSet<>();
            for (IngestionCursor cursor : committedCursors) {
                if (!datasetKeys.contains(cursor.datasetKey())) {
                    throw new IllegalArgumentException("cursor belongs to an unknown dataset: "
                            + cursor.datasetKey());
                }
                if (!cursorKeys.add(cursor.datasetKey())) {
                    throw new IllegalArgumentException("duplicate cursor: " + cursor.datasetKey());
                }
            }
        }
    }
}
