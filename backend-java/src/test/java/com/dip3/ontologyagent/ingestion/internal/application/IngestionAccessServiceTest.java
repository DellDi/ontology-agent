package com.dip3.ontologyagent.ingestion.internal.application;

import com.dip3.ontologyagent.auth.*;
import com.dip3.ontologyagent.support.BackendException;
import org.junit.jupiter.api.Test;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static com.dip3.ontologyagent.ingestion.internal.application.IngestionManagementPort.*;

class IngestionAccessServiceTest {
    final IngestionAccessPort grants = mock(IngestionAccessPort.class);
    final IngestionAccessService access = new IngestionAccessService(grants);
    final AuthSession member = actor("org-a", "PROPERTY_ANALYST");
    final AuthSession admin = actor("platform", "PLATFORM_ADMIN");
    static AuthSession actor(String org, String role) { return new AuthSession("session", "user", "User", new AccessScope(org, List.of(), List.of(), List.of(role)), Instant.now().plusSeconds(60)); }
    void grant() { when(grants.grants("org-a")).thenReturn(List.of(new IngestionAccessPort.Grant("property", "org-a", "admin", Instant.now()))); }
    @Test void organizationCannotDiscoverForeignSourcesOrPartialReleases() {
        grant(); var port = mock(IngestionManagementPort.class);
        var property = new ReleaseProduct("payment", "v", "published", 1, "run", List.of(new SourceVersion("bill", "s", "run")));
        var easyv = new ReleaseProduct("app", "v2", "published", 1, "run2", List.of(new SourceVersion("ai", "s2", "run2")));
        when(port.overview()).thenReturn(new Overview("platform",50,20,
          List.of(new Source("property","postgres","active"),new Source("easyv","postgres","active")),
          List.of(new Dataset("bill","property","active",1),new Dataset("ai","easyv","active",1)),
          List.of(new Product("payment","property","active",List.of("bill")),new Product("app","easyv","active",List.of("ai")),new Product("mixed","property","active",List.of("bill","ai"))),
          List.of(new Run("r","source","easyv","full","completed",null,null,Instant.now(),null,Instant.now())),
          List.of(new Release("allowed","frozen",Instant.now(),List.of(property)),new Release("mixed","frozen",Instant.now(),List.of(property,easyv)))));
        var service = new IngestionManagementService(port, access);
        var result = service.overview(member);
        assertEquals("organization",result.scope());
        assertEquals(List.of("property"), result.sources().stream().map(Source::key).toList());
        assertEquals(List.of("payment"), result.products().stream().map(Product::key).toList());
        assertEquals(List.of("allowed"), result.releases().stream().map(Release::id).toList());
        assertTrue(result.runs().isEmpty());
        assertThrows(BackendException.class, () -> service.overview(actor("org-b","PROPERTY_ANALYST")));
        when(grants.grants("org-a")).thenReturn(List.of());
        assertThrows(BackendException.class, () -> service.overview(member));
    }
    @Test void viewGrantNeverAllowsPublishRetryOrAccessChanges() {
        grant(); var tasks = mock(IngestionReleasePort.class);
        var service = new IngestionReleaseService(tasks,mock(SourceCatalogPort.class),mock(ProductCatalogPort.class),mock(CanonicalProductTransformRegistry.class),access);
        assertThrows(BackendException.class, () -> service.submit("id",null,member,"trace"));
        assertThrows(BackendException.class, () -> service.retry("old","id",member,"trace"));
        assertThrows(BackendException.class, () -> access.setGrant("easyv","org-a",true,member));
        verifyNoInteractions(tasks);
    }
    @Test void taskDetailAndListUseCurrentSourceGrant() {
        grant(); var tasks=mock(IngestionReleasePort.class);
        var foreign=new IngestionReleasePort.Task("task","easyv",List.of("app"),"full","failed",null,"admin","trace","failure",Instant.now(),null,Instant.now());
        when(tasks.find("task")).thenReturn(Optional.of(foreign));when(tasks.recent()).thenReturn(List.of(foreign));
        var service=new IngestionReleaseService(tasks,mock(SourceCatalogPort.class),mock(ProductCatalogPort.class),mock(CanonicalProductTransformRegistry.class),access);
        assertTrue(service.recent(member).items().isEmpty());
        assertEquals("INGESTION_RELEASE_NOT_FOUND",assertThrows(BackendException.class,()->service.find("task",member)).code());
        assertEquals(foreign,service.find("task",admin));
    }
}
