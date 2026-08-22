package com.dip3.ontologyagent.ontology;

import com.dip3.ontologyagent.support.BackendException;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class OntologyRepositoryTest {
    private final OntologyMapper mapper = mock(OntologyMapper.class);
    private final OntologyRepository repository = new OntologyRepository(mapper);

    @Test
    void reportsARetiredPinnedVersionInsteadOfPretendingItDoesNotExist() {
        OntologyVersionEntity retired = new OntologyVersionEntity();
        retired.id = "ontology-1";
        retired.status = "retired";
        when(mapper.versionById("ontology-1")).thenReturn(retired);

        BackendException error = assertThrows(BackendException.class,
                () -> repository.published("ontology-1"));

        assertEquals("ONTOLOGY_PIN_RETIRED", error.code());
    }

    @Test
    void keepsAMissingPinnedVersionDistinctFromAnUnpublishedVersion() {
        BackendException missing = assertThrows(BackendException.class,
                () -> repository.published("missing"));
        assertEquals("ONTOLOGY_PIN_NOT_FOUND", missing.code());

        OntologyVersionEntity draft = new OntologyVersionEntity();
        draft.id = "draft";
        draft.status = "draft";
        when(mapper.versionById("draft")).thenReturn(draft);
        BackendException unpublished = assertThrows(BackendException.class,
                () -> repository.published("draft"));
        assertEquals("ONTOLOGY_PIN_NOT_PUBLISHED", unpublished.code());
    }
}
