package com.dip3.ontologyagent.ingestion.internal.application;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.ingestion.api.DatasetDefinition;
import com.dip3.ontologyagent.support.BackendException;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.UUID;

@Service
public class IngestionReleaseService {
    private final IngestionReleasePort tasks;
    private final IngestionAccessService access;
    private final SourceCatalogPort sources;
    private final ProductCatalogPort products;
    private final CanonicalProductTransformRegistry transforms;

    public IngestionReleaseService(IngestionReleasePort tasks, SourceCatalogPort sources,
                                    ProductCatalogPort products, CanonicalProductTransformRegistry transforms, IngestionAccessService access) {
        this.tasks = tasks;
        this.access = access;
        this.sources = sources;
        this.products = products;
        this.transforms = transforms;
    }

    public record Command(String sourceKey, List<String> productKeys, String mode) {}
    public record TaskList(List<IngestionReleasePort.Task> items) {}

    public TaskList recent(AuthSession actor) {
        var permission = access.requireView(actor);
        return new TaskList(tasks.recent().stream().filter(t -> permission.canManage() || permission.sourceKeys().contains(t.sourceKey())).toList());
    }

    public IngestionReleasePort.Task find(String id, AuthSession actor) {
        var permission = access.requireView(actor);
        return tasks.find(id).filter(t -> permission.canManage() || permission.sourceKeys().contains(t.sourceKey())).orElseThrow(() -> new BackendException(
                "INGESTION_RELEASE_NOT_FOUND", "发布任务不存在。"));
    }

    public IngestionReleasePort.Task submit(String id, Command command, AuthSession actor, String traceId) {
        IngestionManagementService.requireAdmin(actor);
        return submit(id, command, null, actor, traceId);
    }

    public IngestionReleasePort.Task retry(String previousId, String id, AuthSession actor, String traceId) {
        IngestionManagementService.requireAdmin(actor);
        var previous = find(previousId, actor);
        if (!"failed".equals(previous.status())) {
            throw new BackendException("INGESTION_RELEASE_CONFLICT", "只有失败的发布任务可以重新执行。");
        }
        return submit(id, new Command(previous.sourceKey(), previous.productKeys(), previous.mode()),
                previous.id(), actor, traceId);
    }

    private IngestionReleasePort.Task submit(String id, Command command, String retryOf,
                                             AuthSession actor, String traceId) {
        try {
            if (id == null || !UUID.fromString(id).toString().equals(id)) throw new IllegalArgumentException();
        } catch (IllegalArgumentException error) {
            throw new BackendException("INGESTION_REQUEST_INVALID", "Idempotency-Key 必须是标准 UUID。");
        }
        if (command == null || command.sourceKey() == null || !command.sourceKey().matches("[a-z][a-z0-9_-]*")
                || command.productKeys() == null || command.productKeys().isEmpty()
                || command.productKeys().size() > 100 || command.productKeys().stream().anyMatch(key ->
                key == null || !key.matches("[a-z][a-z0-9_-]*"))
                || !("full".equals(command.mode()) || "incremental".equals(command.mode()) || "reconcile".equals(command.mode()))) {
            throw new BackendException("INGESTION_REQUEST_INVALID", "请选择数据源、数据产品和全量、增量或对账模式。");
        }
        List<String> keys = command.productKeys().stream().distinct().sorted().toList();
        // A repeated request keeps its original outcome even if the catalog was later disabled.
        if (tasks.find(id).isEmpty()) {
            var source = sources.loadActiveSource(command.sourceKey());
            if ("incremental".equals(command.mode()) && source.datasets().stream().noneMatch(dataset ->
                    dataset.cursorSpec().strategy() == DatasetDefinition.CursorSpec.Strategy.WATERMARK)) {
                throw new BackendException("INGESTION_REQUEST_INVALID", "此数据源没有可增量采集的数据集。");
            }
            for (String key : keys) {
                var product = products.loadActiveProduct(key);
                try {
                    transforms.require(product.product().transformRef());
                } catch (IllegalArgumentException error) {
                    throw new BackendException("INGESTION_PRODUCT_UNAVAILABLE", "数据产品未启用：" + key, error);
                }
                if (product.inputDatasets().values().stream().anyMatch(dataset ->
                        !dataset.sourceKey().equals(command.sourceKey()))) {
                    throw new BackendException("INGESTION_REQUEST_INVALID", "所选产品包含其他数据源的输入，请分开发布。");
                }
            }
        }
        return tasks.submit(id, command.sourceKey(), keys, command.mode(), retryOf, actor, traceId);
    }
}
