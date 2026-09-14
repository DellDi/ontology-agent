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
    void catalog() { when(grants.sourceKeys()).thenReturn(List.of("property", "easyv")); }
    @Test void authenticatedUsersViewTheWholeCatalogWithoutGrants() {
        catalog(); var port = mock(IngestionManagementPort.class);
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
        assertEquals("platform",result.scope());
        assertEquals(List.of("property","easyv"), result.sources().stream().map(Source::key).toList());
        assertEquals(3, result.products().size());
        assertEquals(2, result.releases().size());
        assertFalse(result.runs().isEmpty());
        assertDoesNotThrow(() -> service.overview(actor("org-b","PROPERTY_ANALYST")));
        var view = access.access(member);
        assertTrue(view.canView());
        assertFalse(view.canManage());
        assertEquals(List.of("property","easyv"), view.sourceKeys());
        assertTrue(view.grants().isEmpty());
    }
    @Test void viewAccessNeverAllowsPublishRetryOrAccessChanges() {
        catalog(); var tasks = mock(IngestionReleasePort.class);
        var service = new IngestionReleaseService(tasks,mock(SourceCatalogPort.class),mock(ProductCatalogPort.class),mock(CanonicalProductTransformRegistry.class),access);
        assertThrows(BackendException.class, () -> service.submit("id",null,member,"trace"));
        assertThrows(BackendException.class, () -> service.retry("old","id",member,"trace"));
        assertThrows(BackendException.class, () -> access.setGrant("easyv","org-a",true,member));
        verifyNoInteractions(tasks);
    }
    @Test void taskDetailAndListVisibleToAllAuthenticatedUsers() {
        catalog(); var tasks=mock(IngestionReleasePort.class);
        var foreign=new IngestionReleasePort.Task("task","easyv",List.of("app"),"full","failed",null,"admin","trace","failure",Instant.now(),null,Instant.now());
        when(tasks.find("task")).thenReturn(Optional.of(foreign));when(tasks.recent()).thenReturn(List.of(foreign));
        var service=new IngestionReleaseService(tasks,mock(SourceCatalogPort.class),mock(ProductCatalogPort.class),mock(CanonicalProductTransformRegistry.class),access);
        assertEquals(1, service.recent(member).items().size());
        assertEquals(foreign,service.find("task",member));
        assertEquals(foreign,service.find("task",admin));
    }
    @Test void adminSeesAllGrantsWhileMembersSeeNone() {
        catalog();
        when(grants.grants(null)).thenReturn(List.of(new IngestionAccessPort.Grant("easyv", "org-a", "admin", Instant.now())));
        var adminView = access.access(admin);
        assertTrue(adminView.canManage());
        assertEquals(1, adminView.grants().size());
        assertTrue(access.access(member).grants().isEmpty());
    }
}
