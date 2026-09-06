package com.dip3.ontologyagent.ingestion.internal.application;

import com.dip3.ontologyagent.ingestion.api.DatasetDefinition;
import com.dip3.ontologyagent.ingestion.api.SourceRow;

import java.util.List;

/** Outbound port for encoding and decoding immutable source staging batches. */
public interface SourceBatchCodec {
    /** Stable storage identifier recorded with each source batch receipt. */
    String codec();

    byte[] encode(DatasetDefinition definition, List<SourceRow> rows);

    List<SourceRow> decode(DatasetDefinition definition, byte[] payload);
}
