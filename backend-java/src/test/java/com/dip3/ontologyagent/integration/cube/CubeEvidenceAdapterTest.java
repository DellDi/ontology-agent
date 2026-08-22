package com.dip3.ontologyagent.integration.cube;

import com.dip3.ontologyagent.support.BackendException;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class CubeEvidenceAdapterTest {
    @Test
    void sumsTheNumericStringsReturnedByCube() {
        assertEquals(125.5, CubeEvidenceAdapter.total(List.of(
                Map.of("FinancePayments.paidAmount", "100.25"),
                Map.of("FinancePayments.paidAmount", 25.25)), "FinancePayments.paidAmount"));
    }

    @Test
    void rejectsNonNumericMeasureValues() {
        BackendException error = assertThrows(BackendException.class, () -> CubeEvidenceAdapter.total(
                List.of(Map.of("FinancePayments.paidAmount", "not-a-number")),
                "FinancePayments.paidAmount"));
        assertEquals("CUBE_RESPONSE_INVALID", error.code());
    }

    @Test
    void roundsGovernedRatioToFourDecimalPlaces() {
        assertEquals(33.3333, CubeEvidenceAdapter.ratio(1, 3));
        assertEquals(0, CubeEvidenceAdapter.ratio(CubeEvidenceAdapter.total(List.of(), "unused"), 100));
    }

    @Test
    void rejectsZeroAndNegativeDenominators() {
        for (double denominator : List.of(0d, -1d)) {
            BackendException error = assertThrows(BackendException.class,
                    () -> CubeEvidenceAdapter.ratio(1, denominator));
            assertEquals("CUBE_RATIO_DENOMINATOR_INVALID", error.code());
        }
    }

    @Test
    void rejectsRowsForProjectsOutsideTheRequestedScope() {
        BackendException error = assertThrows(BackendException.class,
                () -> CubeEvidenceAdapter.requireScopedProject(
                        Map.of("FinanceReceivables.projectId", "project-2"),
                        "FinanceReceivables.projectId", List.of("project-1")));
        assertEquals("CUBE_SCOPE_VIOLATION", error.code());
    }
}
