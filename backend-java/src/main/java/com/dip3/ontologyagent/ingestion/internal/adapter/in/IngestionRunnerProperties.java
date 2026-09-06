package com.dip3.ontologyagent.ingestion.internal.adapter.in;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

import java.util.List;

/** Configuration for the one-shot governed ingestion process. */
@Component
@Profile("ingest")
@ConfigurationProperties("dip3.ingestion")
public class IngestionRunnerProperties {
    private String sourceKey;
    private List<String> productKeys = List.of();
    private String mode = "FULL";
    private String trigger = "MANUAL";
    private String requestedBy = "ingest";
    private String requestId;
    private int pageSize = 2_000;
    private String publicationId;

    public String getSourceKey() {
        return sourceKey;
    }

    public void setSourceKey(String sourceKey) {
        this.sourceKey = sourceKey;
    }

    public List<String> getProductKeys() {
        return productKeys;
    }

    public void setProductKeys(List<String> productKeys) {
        this.productKeys = productKeys == null ? null : List.copyOf(productKeys);
    }

    public String getMode() {
        return mode;
    }

    public void setMode(String mode) {
        this.mode = mode;
    }

    public String getTrigger() {
        return trigger;
    }

    public void setTrigger(String trigger) {
        this.trigger = trigger;
    }

    public String getRequestedBy() {
        return requestedBy;
    }

    public void setRequestedBy(String requestedBy) {
        this.requestedBy = requestedBy;
    }

    public String getRequestId() {
        return requestId;
    }

    public void setRequestId(String requestId) {
        this.requestId = requestId;
    }

    public int getPageSize() {
        return pageSize;
    }

    public void setPageSize(int pageSize) {
        this.pageSize = pageSize;
    }

    public String getPublicationId() {
        return publicationId;
    }

    public void setPublicationId(String publicationId) {
        this.publicationId = publicationId;
    }
}
