package com.dip3.ontologyagent.ingestion.internal.application;

import com.dip3.ontologyagent.ingestion.api.DataProductDefinition;
import com.dip3.ontologyagent.ingestion.api.DataProductInput;
import com.dip3.ontologyagent.ingestion.api.DatasetDefinition;

import java.util.LinkedHashMap;
import java.util.Map;

/** Loads one governed canonical product and the source contracts for its named inputs. */
public interface ProductCatalogPort {
    ProductCatalog loadActiveProduct(String productKey);

    record ProductCatalog(DataProductDefinition product,
                          Map<String, DatasetDefinition> inputDatasets) {
        public ProductCatalog {
            if (product == null) throw new IllegalArgumentException("product must not be null");
            if (inputDatasets == null) {
                throw new IllegalArgumentException("inputDatasets must not be null");
            }
            Map<String, DatasetDefinition> copy = new LinkedHashMap<>();
            for (DataProductInput input : product.inputs()) {
                DatasetDefinition dataset = inputDatasets.get(input.inputKey());
                if (dataset == null || !input.datasetKey().equals(dataset.datasetKey())) {
                    throw new IllegalArgumentException("product input dataset does not match: "
                            + input.inputKey());
                }
                copy.put(input.inputKey(), dataset);
            }
            if (copy.size() != inputDatasets.size()) {
                throw new IllegalArgumentException("inputDatasets contains unknown product inputs");
            }
            inputDatasets = Map.copyOf(copy);
        }
    }
}
