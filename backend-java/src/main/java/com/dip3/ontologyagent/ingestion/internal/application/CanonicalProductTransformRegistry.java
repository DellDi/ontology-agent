package com.dip3.ontologyagent.ingestion.internal.application;

import com.dip3.ontologyagent.ingestion.api.CanonicalProductTransform;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Fixed registry for reviewed product transforms; definitions cannot execute arbitrary code. */
public final class CanonicalProductTransformRegistry {
    private final Map<String, CanonicalProductTransform> transforms;

    public CanonicalProductTransformRegistry(List<CanonicalProductTransform> transforms) {
        if (transforms == null || transforms.stream().anyMatch(transform -> transform == null)) {
            throw new IllegalArgumentException("transforms must not contain null");
        }
        Map<String, CanonicalProductTransform> indexed = new LinkedHashMap<>();
        for (CanonicalProductTransform transform : transforms) {
            String ref = transform.transformRef();
            if (ref == null || !ref.matches("[a-z][a-z0-9_-]*")) {
                throw new IllegalArgumentException("transformRef must be a restricted catalog key");
            }
            if (indexed.putIfAbsent(ref, transform) != null) {
                throw new IllegalArgumentException("duplicate canonical transform: " + ref);
            }
        }
        this.transforms = Map.copyOf(indexed);
    }

    public CanonicalProductTransform require(String transformRef) {
        CanonicalProductTransform transform = transforms.get(transformRef);
        if (transform == null) {
            throw new IllegalArgumentException("no trusted transform is registered for " + transformRef);
        }
        return transform;
    }
}
