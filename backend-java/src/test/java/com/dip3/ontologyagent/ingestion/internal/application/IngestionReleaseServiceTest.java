package com.dip3.ontologyagent.ingestion.internal.application;

import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.ingestion.api.DataProductDefinition;
import com.dip3.ontologyagent.ingestion.api.DatasetDefinition;
import com.dip3.ontologyagent.support.BackendException;
import org.junit.jupiter.api.Test;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class IngestionReleaseServiceTest {
    final IngestionReleasePort tasks = mock(IngestionReleasePort.class);
    final SourceCatalogPort sources = mock(SourceCatalogPort.class);
    final ProductCatalogPort products = mock(ProductCatalogPort.class);
    final CanonicalProductTransformRegistry transforms = mock(CanonicalProductTransformRegistry.class);
    final IngestionReleaseService service = new IngestionReleaseService(tasks, sources, products, transforms, new IngestionAccessService(org.mockito.Mockito.mock(IngestionAccessPort.class)));
    final AuthSession admin = actor("PLATFORM_ADMIN");
    final String id = UUID.randomUUID().toString();
    final IngestionReleaseService.Command command = new IngestionReleaseService.Command("property", List.of("payment"), "full");

    @Test
    void forbidsWritesForNonAdminRolesWhileReadsStayOpen() {
        for (String role : List.of("PROPERTY_ANALYST", "ONTOLOGY_PUBLISHER", "EASYV_ANALYST")) {
            assertEquals("INGESTION_MANAGEMENT_FORBIDDEN", assertThrows(BackendException.class,
                    () -> service.submit(id, command, actor(role), "trace")).code());
            assertTrue(service.recent(actor(role)).items().isEmpty());
            assertThrows(BackendException.class, () -> service.retry("old", id, actor(role), "trace"));
        }
        verifyNoInteractions(sources, products);
    }

    @Test
    void rejectsUnsupportedModeAndMissingIdempotencyKey() {
        assertThrows(BackendException.class, () -> service.submit(null, command, admin, "trace"));
        assertThrows(BackendException.class, () -> service.submit(id,
                new IngestionReleaseService.Command("property", List.of("payment"), "unknown"), admin, "trace"));
        verifyNoInteractions(sources, products);
    }

    @Test
    void validatesProductSourceBeforeEnqueueing() {
        var source = mock(SourceCatalogPort.SourceCatalog.class);
        when(sources.loadActiveSource("property")).thenReturn(source);
        var product = mock(ProductCatalogPort.ProductCatalog.class);
        var definition = mock(DataProductDefinition.class);
        when(definition.transformRef()).thenReturn("payment-v1");
        when(product.product()).thenReturn(definition);
        var dataset = mock(DatasetDefinition.class);
        when(dataset.sourceKey()).thenReturn("easyv");
        when(product.inputDatasets()).thenReturn(Map.of("source", dataset));
        when(products.loadActiveProduct("payment")).thenReturn(product);
        assertEquals("INGESTION_REQUEST_INVALID", assertThrows(BackendException.class,
                () -> service.submit(id, command, admin, "trace")).code());
        verify(tasks, never()).submit(any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void requestReplayDoesNotRevalidateChangedCatalogAndRetryCopiesOriginalCommand() {
        var failed = new IngestionReleasePort.Task("old", "property", List.of("payment"), "full", "failed",
                null, "admin", "trace", "SOURCE_FAILED", Instant.now(), Instant.now(), Instant.now());
        when(tasks.find("old")).thenReturn(Optional.of(failed));
        when(tasks.find(id)).thenReturn(Optional.of(failed));
        service.retry("old", id, admin, "trace-2");
        verify(tasks).submit(id, "property", List.of("payment"), "full", "old", admin, "trace-2");
        verifyNoInteractions(sources, products);
    }

    static AuthSession actor(String role) {
        return new AuthSession("session", "admin", "Admin", new AccessScope("org", List.of(), List.of(), List.of(role)), Instant.MAX);
    }
}
