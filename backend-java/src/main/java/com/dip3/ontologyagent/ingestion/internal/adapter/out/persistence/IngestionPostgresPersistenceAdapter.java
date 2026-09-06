package com.dip3.ontologyagent.ingestion.internal.adapter.out.persistence;

import com.dip3.ontologyagent.ingestion.api.DataProductVersion;
import com.dip3.ontologyagent.ingestion.api.CanonicalProductTransform;
import com.dip3.ontologyagent.ingestion.api.DatasetVersion;
import com.dip3.ontologyagent.ingestion.api.DatasetVersionSet;
import com.dip3.ontologyagent.ingestion.api.IngestionRun;
import com.dip3.ontologyagent.ingestion.api.ProductMaterializationRun;
import com.dip3.ontologyagent.ingestion.internal.application.IngestionPersistencePort;
import com.dip3.ontologyagent.ingestion.internal.application.SourceBatchManifest;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.support.JsonCodec;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.SqlParameterValue;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.sql.Types;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.function.Supplier;

/** PostgreSQL implementation of the ingestion control-plane transaction boundary. */
@Repository
public class IngestionPostgresPersistenceAdapter implements IngestionPersistencePort {
    private final JdbcTemplate jdbc;
    private final JsonCodec json;
    private final TransactionTemplate transactions;
    private final TransactionTemplate requiresNew;

    public IngestionPostgresPersistenceAdapter(JdbcTemplate jdbc, JsonCodec json,
                                               PlatformTransactionManager transactionManager) {
        this.jdbc = jdbc;
        this.json = json;
        this.transactions = new TransactionTemplate(transactionManager);
        this.requiresNew = new TransactionTemplate(transactionManager);
        this.requiresNew.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    @Override
    public IngestionRun createSourceRun(SourceRunRequest request) {
        requireRequest(request, "source run request");
        return execute(transactions, () -> {
            lock("source", request.sourceKey(), "INGESTION_SOURCE_CONFLICT");
            IngestionRun existing = sourceRun(request.id(), false);
            if (existing != null) {
                if (sameSourceRequest(existing, request)) return existing;
                throw conflict("INGESTION_RUN_ID_CONFLICT", "source run id 已被不同请求使用");
            }
            requireActiveSource(request.sourceKey());
            Integer active = jdbc.queryForObject("""
                    select count(*) from ingestion.source_ingestion_runs
                    where source_key=? and status in ('pending','running')
                    """, Integer.class, request.sourceKey());
            if (active != null && active > 0) {
                throw conflict("INGESTION_SOURCE_CONFLICT", "该 source 已有运行中的 ingestion");
            }
            Instant now = Instant.now();
            int changed = jdbc.update("""
                    insert into ingestion.source_ingestion_runs
                      (id,source_key,mode,status,trigger_type,triggered_by,correlation_id,
                       snapshot_context,row_counts,error_code,error_detail,started_at,finished_at,
                       created_at,updated_at)
                    values (?,?,?,'pending',?,?,?,cast(? as jsonb),'{}'::jsonb,null,null,null,null,?,?)
                    """, text(request.id(), "id"), text(request.sourceKey(), "sourceKey"),
                    db(request.mode()), db(request.triggerType()), nullableText(request.triggeredBy()),
                    nullableText(request.correlationId()), json.write(request.snapshotContext()),
                    at(now), at(now));
            requireChanged(changed, "INGESTION_RUN_CREATE_FAILED", "source run 创建失败");
            return sourceRun(request.id(), false);
        });
    }

    @Override
    public IngestionRun startSourceRun(String runId) {
        return execute(transactions, () -> {
            IngestionRun current = requireSourceRun(runId, false);
            lock("source", current.sourceKey(), "INGESTION_SOURCE_CONFLICT");
            current = requireSourceRun(runId, true);
            if (current.status() == IngestionRun.Status.RUNNING) return current;
            if (current.status() != IngestionRun.Status.PENDING) {
                throw stateConflict("source run", runId, current.status().name());
            }
            Instant now = Instant.now();
            requireChanged(jdbc.update("""
                    update ingestion.source_ingestion_runs
                    set status='running',started_at=?,updated_at=?
                    where id=? and status='pending'
                    """, at(now), at(now), runId), "INGESTION_STATE_CONFLICT",
                    "source run 状态已被并发修改");
            return requireSourceRun(runId, false);
        });
    }

    @Override
    public IngestionRun recordSourceSnapshotContext(String runId,
                                                     Map<String, Object> snapshotContext) {
        String id = text(runId, "runId");
        Map<String, Object> context = requireSnapshotContext(snapshotContext);
        return execute(requiresNew, () -> {
            IngestionRun current = requireSourceRun(id, false);
            lock("source", current.sourceKey(), "INGESTION_SOURCE_CONFLICT");
            current = requireSourceRun(id, true);
            if (current.status() != IngestionRun.Status.RUNNING) {
                throw stateConflict("source run", id, current.status().name());
            }
            if (current.snapshotContext().equals(context)) return current;
            if (!IngestionPersistencePort.PLANNED_SOURCE_SNAPSHOT_CONTEXT.equals(
                    current.snapshotContext())) {
                throw conflict("INGESTION_SNAPSHOT_CONTEXT_CONFLICT",
                        "source run 已记录不同的 snapshot context：" + id);
            }
            Instant now = Instant.now();
            requireChanged(jdbc.update("""
                    update ingestion.source_ingestion_runs
                    set snapshot_context=cast(? as jsonb),updated_at=?
                    where id=? and status='running'
                      and snapshot_context=cast(? as jsonb)
                    """, json.write(context), at(now), id,
                    json.write(IngestionPersistencePort.PLANNED_SOURCE_SNAPSHOT_CONTEXT)),
                    "INGESTION_SNAPSHOT_CONTEXT_CONFLICT",
                    "source run snapshot context 已被并发修改：" + id);
            return requireSourceRun(id, false);
        });
    }

    @Override
    public List<DatasetVersion> reserveSourceVersions(SourceVersionReservation reservation) {
        validateSourceVersionReservation(reservation);
        return execute(transactions, () -> reserveSourceVersionsLocked(reservation));
    }

    private List<DatasetVersion> reserveSourceVersionsLocked(SourceVersionReservation reservation) {
        IngestionRun initial = requireSourceRun(reservation.runId(), false);
        lock("source", initial.sourceKey(), "INGESTION_SOURCE_CONFLICT");
        IngestionRun run = requireSourceRun(reservation.runId(), true);
        if (run.status() == IngestionRun.Status.COMPLETED) {
            return requireSameSourceReservation(reservation);
        }
        if (run.status() != IngestionRun.Status.RUNNING) {
            throw stateConflict("source run", run.id(), run.status().name());
        }

        List<DatasetVersion> reserved = new ArrayList<>();
        for (SourceDatasetReservation requested : reservation.datasets().stream()
                .sorted((left, right) -> left.datasetKey().compareTo(right.datasetKey())).toList()) {
            DatasetDefinitionRow definition = requireDataset(requested.datasetKey());
            if (!run.sourceKey().equals(definition.sourceKey())) {
                throw conflict("INGESTION_DATASET_SOURCE_MISMATCH",
                        "dataset 与 source run 不属于同一 source");
            }
            if (!"active".equals(definition.status())) {
                throw conflict("INGESTION_DATASET_DISABLED", "dataset 已禁用：" + requested.datasetKey());
            }
            if (requested.schemaVersion() != definition.schemaVersion()) {
                throw conflict("INGESTION_SCHEMA_VERSION_MISMATCH",
                        "source dataset reservation schema version 与 dataset 定义不一致");
            }
            DatasetVersion existing = sourceVersionForRunDataset(run.id(), requested.datasetKey(), true);
            if (existing != null) {
                requireSameReservation(existing, requested);
                if (existing.status() == DatasetVersion.Status.FAILED
                        || existing.status() == DatasetVersion.Status.REVOKED) {
                    throw stateConflict("source dataset version", existing.id(), existing.status().name());
                }
                reserved.add(existing);
                continue;
            }
            long versionNumber = nextSourceVersion(requested.datasetKey());
            String parentVersionId = sourceParentVersion(run.mode(), requested);
            String storageRef = sourceStorageRef(requested.id());
            Instant now = Instant.now();
            requireChanged(jdbc.update("""
                    insert into ingestion.source_dataset_versions
                      (id,source_key,dataset_key,source_ingestion_run_id,parent_version_id,
                       version_number,storage_ref,
                       source_watermark,committed_cursor,row_count,content_hash,schema_version,
                       status,published_at,created_at)
                    values (?,?,?,?,?,?,?,cast(? as jsonb),'{}'::jsonb,0,null,?,'building',null,?)
                    """, requested.id(), run.sourceKey(), requested.datasetKey(), run.id(),
                    parentVersionId, versionNumber, storageRef,
                    json.write(requested.sourceWatermark()), requested.schemaVersion(), at(now)),
                    "INGESTION_SOURCE_VERSION_WRITE_FAILED", "source dataset version reservation 写入失败");
            reserved.add(requireSourceDatasetVersion(requested.id(), false));
        }
        return reserved.stream().sorted((left, right) -> left.datasetKey().compareTo(right.datasetKey())).toList();
    }

    @Override
    public SourceBatchReceipt appendSourceBatch(SourceBatchAppend batch) {
        requireRequest(batch, "source batch");
        return execute(transactions, () -> appendSourceBatchLocked(batch));
    }

    private SourceBatchReceipt appendSourceBatchLocked(SourceBatchAppend batch) {
        DatasetVersion version = requireSourceDatasetVersion(batch.versionId(), true);
        SourceBatchRow existing = sourceBatchForVersionAndNumber(version.id(), batch.batchNumber(), true);
        String contentHash = SourceBatchManifest.contentHash(batch.payload());
        if (existing != null) {
            if (existing.rowCount() != batch.rowCount()
                    || !existing.contentHash().equals(contentHash)
                    || !Arrays.equals(existing.payload(), batch.payload())) {
                throw conflict("INGESTION_BATCH_ID_CONFLICT",
                        "同一 source dataset version 的 batch number 对应不同内容");
            }
            return existing.receipt();
        }
        if (version.status() != DatasetVersion.Status.BUILDING) {
            throw stateConflict("source dataset version", version.id(), version.status().name());
        }

        String batchId = UUID.randomUUID().toString();
        Instant now = Instant.now();
        requireChanged(jdbc.update("""
                insert into ingestion.source_dataset_batches
                  (id,source_key,dataset_key,source_dataset_version_id,batch_number,codec,
                   row_count,content_hash,payload,created_at)
                values (?,?,?,?,?,'row-pack-v1',?,?,?,?)
                """, batchId, sourceKey(version.id()), version.datasetKey(), version.id(),
                batch.batchNumber(), batch.rowCount(), contentHash,
                new SqlParameterValue(Types.BINARY, batch.payload()), at(now)),
                "INGESTION_BATCH_WRITE_FAILED", "source dataset batch 写入失败");
        return sourceBatchForVersionAndNumber(version.id(), batch.batchNumber(), false).receipt();
    }

    @Override
    public List<SourceBatch> readPublishedSourceBatches(String versionId) {
        return execute(transactions, () -> readPublishedSourceBatchesLocked(versionId));
    }

    @Override
    public List<SourceVersionArtifact> readPublishedSourceVersionChain(String versionId) {
        return execute(transactions, () -> {
            List<SourceVersionArtifact> reversed = new ArrayList<>();
            Set<String> visited = new HashSet<>();
            String currentId = text(versionId, "versionId");
            String datasetKey = null;
            long childVersionNumber = Long.MAX_VALUE;
            while (currentId != null) {
                if (!visited.add(currentId)) {
                    throw conflict("INGESTION_SOURCE_VERSION_CHAIN_INVALID",
                            "source dataset version ancestry contains a cycle");
                }
                DatasetVersion current = requireSourceDatasetVersion(currentId, false);
                if (current.status() != DatasetVersion.Status.PUBLISHED) {
                    throw stateConflict("source dataset version", current.id(),
                            current.status().name());
                }
                if (datasetKey == null) datasetKey = current.datasetKey();
                if (!datasetKey.equals(current.datasetKey())
                        || current.versionNumber() >= childVersionNumber) {
                    throw conflict("INGESTION_SOURCE_VERSION_CHAIN_INVALID",
                            "source dataset version ancestry is not strictly ordered");
                }
                IngestionRun run = requireSourceRun(current.ingestionRunId(), false);
                if (run.status() != IngestionRun.Status.COMPLETED) {
                    throw conflict("INGESTION_SOURCE_VERSION_CHAIN_INVALID",
                            "published source dataset version belongs to an incomplete run");
                }
                if (run.mode() == IngestionRun.Mode.INCREMENTAL
                        && current.parentVersionId() == null) {
                    throw conflict("INGESTION_SOURCE_VERSION_CHAIN_INVALID",
                            "incremental source dataset version has no parent");
                }
                if (run.mode() != IngestionRun.Mode.INCREMENTAL
                        && current.parentVersionId() != null) {
                    throw conflict("INGESTION_SOURCE_VERSION_CHAIN_INVALID",
                            "full or reconcile source dataset version has a parent");
                }
                reversed.add(new SourceVersionArtifact(current, run.mode(),
                        readPublishedSourceBatchesLocked(current.id())));
                childVersionNumber = current.versionNumber();
                currentId = current.parentVersionId();
            }
            java.util.Collections.reverse(reversed);
            if (reversed.isEmpty()
                    || reversed.getFirst().mode() == IngestionRun.Mode.INCREMENTAL) {
                throw conflict("INGESTION_SOURCE_VERSION_CHAIN_INVALID",
                        "source dataset version ancestry has no full or reconcile base");
            }
            return List.copyOf(reversed);
        });
    }

    private List<SourceBatch> readPublishedSourceBatchesLocked(String versionId) {
        DatasetVersion version = requireSourceDatasetVersion(versionId, false);
        if (version.status() != DatasetVersion.Status.PUBLISHED) {
            throw stateConflict("source dataset version", version.id(), version.status().name());
        }
        if (!sourceStorageRef(version.id()).equals(version.storageRef())) {
            throw conflict("INGESTION_SOURCE_VERSION_INVALID",
                    "published source dataset version 的 storage_ref 不匹配：" + version.id());
        }

        List<SourceBatchRow> batches = sourceBatches(version.id());
        for (SourceBatchRow batch : batches) {
            if (!IngestionPersistencePort.ROW_PACK_CODEC.equals(batch.receipt().codec())) {
                throw conflict("INGESTION_BATCH_CODEC_INVALID",
                        "source dataset batch codec 不受支持：" + batch.id());
            }
            byte[] payload = batch.payload();
            if (payload == null || payload.length == 0) {
                throw conflict("INGESTION_BATCH_PAYLOAD_INVALID",
                        "source dataset batch payload 为空：" + batch.id());
            }
            if (!SourceBatchManifest.contentHash(payload).equals(batch.contentHash())) {
                throw conflict("INGESTION_BATCH_CONTENT_MISMATCH",
                        "source dataset batch payload hash 不匹配：" + batch.id());
            }
            if (!version.id().equals(batch.receipt().versionId())) {
                throw conflict("INGESTION_BATCH_VERSION_MISMATCH",
                        "source dataset batch 不属于请求的 source dataset version：" + batch.id());
            }
        }

        SourceBatchManifest.Aggregate aggregate = aggregate(batches);
        if (aggregate.rowCount() != version.rowCount()
                || !aggregate.contentHash().equals(version.contentHash())) {
            throw conflict("INGESTION_BATCH_MISMATCH",
                    "published source dataset version 的 batch row_count 或聚合 hash 不匹配："
                            + version.id());
        }
        return batches.stream().map(batch -> new SourceBatch(batch.receipt(), batch.payload())).toList();
    }

    @Override
    public List<DatasetVersion> publishSourceSnapshot(SourcePublication publication) {
        validateSourcePublication(publication);
        return execute(transactions, () -> publishSourceSnapshotLocked(publication));
    }

    private List<DatasetVersion> publishSourceSnapshotLocked(SourcePublication publication) {
        IngestionRun initial = requireSourceRun(publication.runId(), false);
        lock("source", initial.sourceKey(), "INGESTION_SOURCE_CONFLICT");
        IngestionRun run = requireSourceRun(publication.runId(), true);
        if (run.status() == IngestionRun.Status.COMPLETED) {
            return requireSameSourcePublication(publication);
        }
        if (run.status() != IngestionRun.Status.RUNNING) {
            throw stateConflict("source run", run.id(), run.status().name());
        }

        List<DatasetVersion> versions = sourceVersions(run.id(), true);
        Map<String, SourceDatasetPublication> requested = publication.datasets().stream()
                .collect(java.util.stream.Collectors.toMap(SourceDatasetPublication::datasetKey,
                        item -> item, (left, right) -> left, LinkedHashMap::new));
        if (requested.size() != publication.datasets().size()
                || versions.size() != requested.size()) {
            throw conflict("INGESTION_SOURCE_PUBLICATION_INCOMPLETE",
                    "source publication 必须覆盖本次 run 预留的全部 dataset version");
        }

        Instant now = Instant.now();
        Map<String, Long> rowCounts = new LinkedHashMap<>();
        for (DatasetVersion version : versions.stream()
                .sorted((left, right) -> left.datasetKey().compareTo(right.datasetKey())).toList()) {
            SourceDatasetPublication publicationForDataset = requested.get(version.datasetKey());
            if (publicationForDataset == null) {
                throw conflict("INGESTION_SOURCE_PUBLICATION_INCOMPLETE",
                        "缺少 dataset publication：" + version.datasetKey());
            }
            if (version.status() != DatasetVersion.Status.BUILDING) {
                throw stateConflict("source dataset version", version.id(), version.status().name());
            }
            List<SourceBatchRow> batches = sourceBatches(version.id());
            SourceBatchManifest.Aggregate aggregate = aggregate(batches);
            if (aggregate.batchCount() != publicationForDataset.expectedBatchCount()
                    || aggregate.rowCount() != publicationForDataset.expectedRowCount()
                    || !aggregate.contentHash().equals(publicationForDataset.contentHash())) {
                throw conflict("INGESTION_BATCH_MISMATCH",
                        "source dataset batch count、row_count 或聚合 hash 不匹配：" + version.datasetKey());
            }
            requireChanged(jdbc.update("""
                    update ingestion.source_dataset_versions
                    set committed_cursor=cast(? as jsonb),row_count=?,content_hash=?,status='published',
                        published_at=?,storage_ref=?,
                        created_at=created_at
                    where id=? and status='building'
                    """, json.write(publicationForDataset.committedCursor()), aggregate.rowCount(),
                    aggregate.contentHash(), at(now), sourceStorageRef(version.id()), version.id()),
                    "INGESTION_SOURCE_VERSION_WRITE_FAILED", "source dataset version publish 更新失败");
            requireChanged(jdbc.update("""
                    insert into ingestion.dataset_cursors
                      (dataset_key,committed_cursor,last_successful_version_id,updated_at)
                    values (?,cast(? as jsonb),?,?)
                    on conflict(dataset_key) do update
                    set committed_cursor=excluded.committed_cursor,
                        last_successful_version_id=excluded.last_successful_version_id,
                        updated_at=excluded.updated_at
                    """, version.datasetKey(), json.write(publicationForDataset.committedCursor()),
                    version.id(), at(now)), "INGESTION_CURSOR_WRITE_FAILED", "dataset cursor 推进失败");
            rowCounts.put(version.datasetKey(), aggregate.rowCount());
        }
        requireChanged(jdbc.update("""
                update ingestion.source_ingestion_runs
                set status='completed',row_counts=cast(? as jsonb),finished_at=?,updated_at=?
                where id=? and status='running'
                """, json.write(rowCounts), at(now), at(now), run.id()),
                "INGESTION_STATE_CONFLICT", "source run 完成状态已被并发修改");
        return sourceVersions(run.id(), false);
    }

    @Override
    public IngestionRun failSourceRun(String runId, String errorCode,
                                      Map<String, Object> errorDetail) {
        return execute(requiresNew, () -> {
            IngestionRun current = requireSourceRun(runId, false);
            lock("source", current.sourceKey(), "INGESTION_SOURCE_CONFLICT");
            current = requireSourceRun(runId, true);
            if (current.status() == IngestionRun.Status.FAILED) return current;
            if (current.status() != IngestionRun.Status.PENDING
                    && current.status() != IngestionRun.Status.RUNNING) {
                throw stateConflict("source run", runId, current.status().name());
            }
            Instant now = Instant.now();
            jdbc.update("""
                    update ingestion.source_dataset_versions
                    set status='failed'
                    where source_ingestion_run_id=? and status='building'
                    """, runId);
            requireChanged(jdbc.update("""
                    update ingestion.source_ingestion_runs
                    set status='failed',error_code=?,error_detail=cast(? as jsonb),
                        finished_at=?,updated_at=?
                    where id=? and status in ('pending','running')
                    """, text(errorCode, "errorCode"), json.write(requireMap(errorDetail, "errorDetail")),
                    at(now), at(now), runId), "INGESTION_STATE_CONFLICT",
                    "source run 失败状态已被并发修改");
            return requireSourceRun(runId, false);
        });
    }

    @Override
    public ProductMaterializationRun createProductRun(ProductRunRequest request) {
        requireRequest(request, "product run request");
        if (request.sourceDatasetVersionIds().isEmpty()) {
            throw new IllegalArgumentException("sourceDatasetVersionIds must not be empty");
        }
        return execute(transactions, () -> {
            lock("product", request.productKey(), "INGESTION_PRODUCT_CONFLICT");
            ProductMaterializationRun existing = productRun(request.id(), false);
            if (existing != null) {
                if (sameProductRequest(existing, request)) return existing;
                throw conflict("INGESTION_RUN_ID_CONFLICT", "product run id 已被不同请求使用");
            }
            requireActiveProduct(request.productKey());
            validateProductInputs(request.productKey(), request.sourceDatasetVersionIds(), false);
            Integer active = jdbc.queryForObject("""
                    select count(*) from ingestion.product_materialization_runs
                    where product_key=? and status in ('pending','running')
                    """, Integer.class, request.productKey());
            if (active != null && active > 0) {
                throw conflict("INGESTION_PRODUCT_CONFLICT", "该 product 已有运行中的 materialization");
            }
            Instant now = Instant.now();
            requireChanged(jdbc.update("""
                    insert into ingestion.product_materialization_runs
                      (id,product_key,mode,status,trigger_type,triggered_by,correlation_id,input_summary,
                       row_counts,error_code,error_detail,started_at,finished_at,created_at,updated_at)
                    values (?,?,?,'pending',?,?,?,cast(? as jsonb),'{}'::jsonb,null,null,null,null,?,?)
                    """, text(request.id(), "id"), text(request.productKey(), "productKey"),
                    db(request.mode()), db(request.triggerType()), nullableText(request.triggeredBy()),
                    nullableText(request.correlationId()), json.write(request.sourceDatasetVersionIds()),
                    at(now), at(now)), "INGESTION_RUN_CREATE_FAILED", "product run 创建失败");
            return productRun(request.id(), false);
        });
    }

    @Override
    public ProductMaterializationRun startProductRun(String runId) {
        return execute(transactions, () -> {
            ProductMaterializationRun current = requireProductRun(runId, false);
            lock("product", current.productKey(), "INGESTION_PRODUCT_CONFLICT");
            current = requireProductRun(runId, true);
            if (current.status() == ProductMaterializationRun.Status.RUNNING) return current;
            if (current.status() != ProductMaterializationRun.Status.PENDING) {
                throw stateConflict("product run", runId, current.status().name());
            }
            Instant now = Instant.now();
            requireChanged(jdbc.update("""
                    update ingestion.product_materialization_runs
                    set status='running',started_at=?,updated_at=?
                    where id=? and status='pending'
                    """, at(now), at(now), runId), "INGESTION_STATE_CONFLICT",
                    "product run 状态已被并发修改");
            return requireProductRun(runId, false);
        });
    }

    @Override
    public DataProductVersion publishProduct(ProductPublication publication,
                                             CanonicalProductTransform.CanonicalWrite canonicalWrite) {
        validateProductPublication(publication);
        requireRequest(canonicalWrite, "canonical write");
        return execute(transactions, () -> publishProductLocked(publication, canonicalWrite));
    }

    private DataProductVersion publishProductLocked(ProductPublication publication,
                                                     CanonicalProductTransform.CanonicalWrite canonicalWrite) {
        ProductMaterializationRun initial = requireProductRun(publication.runId(), false);
        lock("product", initial.productKey(), "INGESTION_PRODUCT_CONFLICT");
        ProductMaterializationRun run = requireProductRun(publication.runId(), true);
        if (run.status() == ProductMaterializationRun.Status.COMPLETED) {
            return requireSameProductPublication(publication, run.productKey());
        }
        if (run.status() != ProductMaterializationRun.Status.RUNNING) {
            throw stateConflict("product run", run.id(), run.status().name());
        }
        ProductDefinitionRow definition = requireProduct(run.productKey());
        if (!"active".equals(definition.status())) {
            throw conflict("INGESTION_PRODUCT_DISABLED", "product 已禁用：" + run.productKey());
        }
        if (publication.schemaVersion() != definition.schemaVersion()) {
            throw conflict("INGESTION_SCHEMA_VERSION_MISMATCH",
                    "product artifact schema version 与 product 定义不一致");
        }
        Map<String, String> inputVersions = run.sourceDatasetVersionIds();
        List<ProductInputRow> inputs = validateProductInputs(run.productKey(), inputVersions, true);
        long versionNumber = nextProductVersion(run.productKey());
        Instant now = Instant.now();
        requireChanged(jdbc.update("""
                insert into ingestion.data_product_versions
                  (id,product_key,materialization_run_id,version_number,storage_ref,row_count,
                   content_hash,schema_version,status,published_at,created_at)
                values (?,?,?,?,?,?,?,?,'building',null,?)
                """, publication.versionId(), run.productKey(), run.id(), versionNumber,
                publication.storageRef(), publication.rowCount(), publication.contentHash(),
                publication.schemaVersion(), at(now)),
                "INGESTION_PRODUCT_VERSION_WRITE_FAILED", "data product version 写入失败");
        canonicalWrite.execute();
        requireChanged(jdbc.update("""
                update ingestion.data_product_versions
                set status='published',published_at=?
                where id=? and status='building'
                """, at(now), publication.versionId()),
                "INGESTION_PRODUCT_VERSION_WRITE_FAILED", "data product version 发布失败");
        for (ProductInputRow input : inputs) {
            String sourceVersionId = inputVersions.get(input.inputKey());
            if (sourceVersionId == null) continue;
            requireChanged(jdbc.update("""
                    insert into ingestion.data_product_version_lineage
                      (id,product_key,product_version_id,input_key,source_dataset_key,
                       source_dataset_version_id,transform_ref,metadata,created_at)
                    values (?,?,?,?,?,?,?,'{}'::jsonb,?)
                    """, UUID.randomUUID().toString(), run.productKey(), publication.versionId(),
                    input.inputKey(), input.datasetKey(), sourceVersionId,
                    definition.transformRef(), at(now)),
                    "INGESTION_LINEAGE_WRITE_FAILED", "data product lineage 写入失败");
        }
        requireChanged(jdbc.update("""
                update ingestion.product_materialization_runs
                set status='completed',row_counts=cast(? as jsonb),finished_at=?,updated_at=?
                where id=? and status='running'
                """, json.write(Map.of(run.productKey(), publication.rowCount())), at(now), at(now), run.id()),
                "INGESTION_STATE_CONFLICT", "product run 完成状态已被并发修改");
        return new DataProductVersion(publication.versionId(), run.productKey(), versionNumber,
                DataProductVersion.Status.PUBLISHED, run.id(), publication.schemaVersion(),
                publication.storageRef(), publication.rowCount(), publication.contentHash(), now, now);
    }

    @Override
    public ProductMaterializationRun failProductRun(String runId, String errorCode,
                                                    Map<String, Object> errorDetail) {
        return execute(requiresNew, () -> {
            ProductMaterializationRun current = requireProductRun(runId, false);
            lock("product", current.productKey(), "INGESTION_PRODUCT_CONFLICT");
            current = requireProductRun(runId, true);
            if (current.status() == ProductMaterializationRun.Status.FAILED) return current;
            if (current.status() != ProductMaterializationRun.Status.PENDING
                    && current.status() != ProductMaterializationRun.Status.RUNNING) {
                throw stateConflict("product run", runId, current.status().name());
            }
            Instant now = Instant.now();
            requireChanged(jdbc.update("""
                    update ingestion.product_materialization_runs
                    set status='failed',error_code=?,error_detail=cast(? as jsonb),
                        finished_at=?,updated_at=?
                    where id=? and status in ('pending','running')
                    """, text(errorCode, "errorCode"), json.write(requireMap(errorDetail, "errorDetail")),
                    at(now), at(now), runId), "INGESTION_STATE_CONFLICT",
                    "product run 失败状态已被并发修改");
            return requireProductRun(runId, false);
        });
    }

    @Override
    public DatasetVersionSet freezeVersionSet(VersionSetPublication publication) {
        validateVersionSetPublication(publication);
        return execute(transactions, () -> {
            lock("version-set", publication.setId(), "INGESTION_VERSION_SET_CONFLICT");
            DatasetVersionSet existing = versionSet(publication.setId());
            if (existing != null) {
                if (existing.status() == DatasetVersionSet.Status.FROZEN
                        && existing.productVersionIds().equals(publication.productVersionIds())
                        && existing.capturedAt().equals(publication.capturedAt())
                        && existing.createdBy().equals(publication.createdBy())) return existing;
                throw conflict("INGESTION_VERSION_SET_ID_CONFLICT",
                        "version set id 已被不同 publication 使用");
            }
            Instant now = Instant.now();
            if (publication.capturedAt().isAfter(now)) {
                throw new IllegalArgumentException("capturedAt must not be in the future");
            }
            for (String productKey : publication.productVersionIds().keySet().stream().sorted().toList()) {
                lock("product", productKey, "INGESTION_PRODUCT_CONFLICT");
                ProductVersionRow version = requirePublishedProductVersion(
                        productKey, publication.productVersionIds().get(productKey));
                if (version.publishedAt().isAfter(publication.capturedAt())) {
                    throw conflict("INGESTION_VERSION_SET_TIME_INVALID",
                            "version set capturedAt 早于 product version 发布时间");
                }
            }
            requireChanged(jdbc.update("""
                    insert into ingestion.dataset_version_sets
                      (set_id,status,captured_at,frozen_at,created_by,created_at)
                    values (?,'frozen',?,?,?,?)
                    """, publication.setId(), at(publication.capturedAt()), at(now),
                    publication.createdBy(), at(publication.capturedAt())),
                    "INGESTION_VERSION_SET_WRITE_FAILED", "version set 写入失败");
            for (Map.Entry<String, String> item : publication.productVersionIds().entrySet()) {
                requireChanged(jdbc.update("""
                        insert into ingestion.dataset_version_set_items
                          (set_id,product_key,product_version_id) values (?,?,?)
                        """, publication.setId(), item.getKey(), item.getValue()),
                        "INGESTION_VERSION_SET_WRITE_FAILED", "version set item 写入失败");
            }
            return requireVersionSet(publication.setId());
        });
    }

    private List<ProductInputRow> validateProductInputs(String productKey,
                                                        Map<String, String> versions,
                                                        boolean lockVersions) {
        List<ProductInputRow> inputs = jdbc.query("""
                select input_key,dataset_key,is_required from ingestion.data_product_inputs
                where product_key=? order by ordinal,input_key
                """, (rs, row) -> new ProductInputRow(rs.getString("input_key"),
                rs.getString("dataset_key"), rs.getBoolean("is_required")), productKey);
        if (inputs.isEmpty()) {
            throw conflict("INGESTION_PRODUCT_INPUTS_MISSING", "product 没有已注册 input");
        }
        Set<String> known = new HashSet<>();
        for (ProductInputRow input : inputs) {
            known.add(input.inputKey());
            String versionId = versions.get(input.inputKey());
            if (versionId == null) {
                if (input.required()) {
                    throw conflict("INGESTION_PRODUCT_INPUT_REQUIRED",
                            "缺少 required product input：" + input.inputKey());
                }
                continue;
            }
            String suffix = lockVersions ? " for share" : "";
            List<Map<String, Object>> rows = jdbc.queryForList("""
                    select dataset_key,status from ingestion.source_dataset_versions
                    where id=?
                    """ + suffix, versionId);
            if (rows.size() != 1 || !input.datasetKey().equals(rows.getFirst().get("dataset_key"))
                    || !"published".equals(rows.getFirst().get("status"))) {
                throw conflict("INGESTION_SOURCE_VERSION_INVALID",
                        "product input 必须引用匹配且已发布的 source dataset version");
            }
        }
        for (String inputKey : versions.keySet()) {
            if (!known.contains(inputKey)) {
                throw conflict("INGESTION_PRODUCT_INPUT_UNKNOWN", "未知 product input：" + inputKey);
            }
        }
        return inputs;
    }

    private List<DatasetVersion> requireSameSourcePublication(SourcePublication publication) {
        List<DatasetVersion> existing = sourceVersions(publication.runId(), false);
        if (existing.size() != publication.datasets().size()) {
            throw conflict("INGESTION_RUN_ID_CONFLICT", "已完成 source run 的 dataset publication 数量不一致");
        }
        Map<String, SourceDatasetPublication> requested = new LinkedHashMap<>();
        publication.datasets().forEach(item -> requested.put(item.datasetKey(), item));
        for (DatasetVersion version : existing) {
            SourceDatasetPublication dataset = requested.get(version.datasetKey());
            if (dataset == null || version.status() != DatasetVersion.Status.PUBLISHED
                    || version.rowCount() != dataset.expectedRowCount()
                    || !version.contentHash().equals(dataset.contentHash())
                    || !version.committedCursor().equals(dataset.committedCursor())) {
                throw conflict("INGESTION_RUN_ID_CONFLICT", "已完成 source run 的 dataset publication 不一致");
            }
            SourceBatchManifest.Aggregate aggregate = aggregate(sourceBatches(version.id()));
            if (aggregate.batchCount() != dataset.expectedBatchCount()
                    || aggregate.rowCount() != dataset.expectedRowCount()
                    || !aggregate.contentHash().equals(dataset.contentHash())) {
                throw conflict("INGESTION_RUN_ID_CONFLICT", "已完成 source run 的 batch receipt 不一致");
            }
        }
        return existing;
    }

    private DataProductVersion requireSameProductPublication(ProductPublication publication,
                                                              String productKey) {
        DataProductVersion version = productVersionByRun(publication.runId());
        if (version == null || !version.productKey().equals(productKey)
                || !version.id().equals(publication.versionId())
                || !version.storageRef().equals(publication.storageRef())
                || version.rowCount() != publication.rowCount()
                || !version.contentHash().equals(publication.contentHash())
                || version.schemaVersion() != publication.schemaVersion()) {
            throw conflict("INGESTION_RUN_ID_CONFLICT", "已完成 product run 的 artifact 不一致");
        }
        return version;
    }

    private void validateSourcePublication(SourcePublication publication) {
        requireRequest(publication, "source publication");
        text(publication.runId(), "runId");
        if (publication.datasets().isEmpty()) {
            throw new IllegalArgumentException("datasets must not be empty");
        }
        Set<String> datasets = new HashSet<>();
        for (SourceDatasetPublication dataset : publication.datasets()) {
            if (!datasets.add(dataset.datasetKey())) {
                throw new IllegalArgumentException("source dataset publications must be unique");
            }
        }
    }

    private void validateSourceVersionReservation(SourceVersionReservation reservation) {
        requireRequest(reservation, "source version reservation");
        text(reservation.runId(), "runId");
        if (reservation.datasets().isEmpty()) {
            throw new IllegalArgumentException("datasets must not be empty");
        }
        Set<String> ids = new HashSet<>();
        Set<String> datasets = new HashSet<>();
        for (SourceDatasetReservation dataset : reservation.datasets()) {
            if (!ids.add(dataset.id()) || !datasets.add(dataset.datasetKey())) {
                throw new IllegalArgumentException("source reservations must have unique ids and datasets");
            }
        }
    }

    private List<DatasetVersion> requireSameSourceReservation(SourceVersionReservation reservation) {
        List<DatasetVersion> existing = sourceVersions(reservation.runId(), false);
        if (existing.size() != reservation.datasets().size()) {
            throw conflict("INGESTION_RUN_ID_CONFLICT",
                    "已完成 source run 的 reservation 数量不一致");
        }
        Map<String, SourceDatasetReservation> requested = reservation.datasets().stream()
                .collect(java.util.stream.Collectors.toMap(SourceDatasetReservation::datasetKey,
                        item -> item, (left, right) -> left, LinkedHashMap::new));
        for (DatasetVersion version : existing) {
            SourceDatasetReservation dataset = requested.get(version.datasetKey());
            if (dataset == null) {
                throw conflict("INGESTION_RUN_ID_CONFLICT",
                        "已完成 source run 的 reservation dataset 不一致");
            }
            requireSameReservation(version, dataset);
        }
        return existing;
    }

    private void requireSameReservation(DatasetVersion existing,
                                        SourceDatasetReservation requested) {
        if (!existing.id().equals(requested.id())
                || !Objects.equals(existing.parentVersionId(), requested.parentVersionId())
                || existing.schemaVersion() != requested.schemaVersion()
                || !existing.sourceWatermark().equals(requested.sourceWatermark())
                || !sourceStorageRef(existing.id()).equals(existing.storageRef())) {
            throw conflict("INGESTION_VERSION_ID_CONFLICT",
                    "source dataset version id 已被不同 reservation 使用：" + requested.id());
        }
    }

    private void validateProductPublication(ProductPublication publication) {
        requireRequest(publication, "product publication");
        text(publication.runId(), "runId");
        text(publication.versionId(), "versionId");
        text(publication.storageRef(), "storageRef");
        text(publication.contentHash(), "contentHash");
        if (publication.rowCount() < 0 || publication.schemaVersion() <= 0) {
            throw new IllegalArgumentException("product artifact metadata is invalid");
        }
    }

    private void validateVersionSetPublication(VersionSetPublication publication) {
        requireRequest(publication, "version set publication");
        text(publication.setId(), "setId");
        text(publication.createdBy(), "createdBy");
        Objects.requireNonNull(publication.capturedAt(), "capturedAt");
        if (publication.productVersionIds().isEmpty()) {
            throw new IllegalArgumentException("productVersionIds must not be empty");
        }
    }

    private DatasetDefinitionRow requireDataset(String datasetKey) {
        List<DatasetDefinitionRow> rows = jdbc.query("""
                select source_key,schema_version,status from ingestion.dataset_definitions
                where dataset_key=? for update
                """, (rs, row) -> new DatasetDefinitionRow(rs.getString("source_key"),
                rs.getInt("schema_version"), rs.getString("status")), datasetKey);
        if (rows.size() != 1) throw conflict("INGESTION_DATASET_NOT_FOUND", "dataset 未注册：" + datasetKey);
        return rows.getFirst();
    }

    private ProductDefinitionRow requireProduct(String productKey) {
        List<ProductDefinitionRow> rows = jdbc.query("""
                select transform_ref,schema_version,status from ingestion.data_product_definitions
                where product_key=? for update
                """, (rs, row) -> new ProductDefinitionRow(rs.getString("transform_ref"),
                rs.getInt("schema_version"), rs.getString("status")), productKey);
        if (rows.size() != 1) throw conflict("INGESTION_PRODUCT_NOT_FOUND", "product 未注册：" + productKey);
        return rows.getFirst();
    }

    private void requireActiveSource(String sourceKey) {
        String status = jdbc.query("select status from ingestion.source_definitions where source_key=?",
                rs -> rs.next() ? rs.getString(1) : null, sourceKey);
        if (!"active".equals(status)) {
            throw conflict("INGESTION_SOURCE_NOT_ACTIVE", "source 未注册或已禁用：" + sourceKey);
        }
    }

    private void requireActiveProduct(String productKey) {
        String status = jdbc.query("select status from ingestion.data_product_definitions where product_key=?",
                rs -> rs.next() ? rs.getString(1) : null, productKey);
        if (!"active".equals(status)) {
            throw conflict("INGESTION_PRODUCT_NOT_ACTIVE", "product 未注册或已禁用：" + productKey);
        }
    }

    private long nextSourceVersion(String datasetKey) {
        Long next = jdbc.queryForObject("""
                select coalesce(max(version_number),0)+1
                from ingestion.source_dataset_versions where dataset_key=?
                """, Long.class, datasetKey);
        return next == null ? 1 : next;
    }

    private String sourceParentVersion(IngestionRun.Mode mode,
                                       SourceDatasetReservation requested) {
        if (mode != IngestionRun.Mode.INCREMENTAL) {
            if (requested.parentVersionId() != null) {
                throw conflict("INGESTION_SOURCE_VERSION_PARENT_INVALID",
                        "full or reconcile source dataset version cannot declare a parent: "
                                + requested.datasetKey());
            }
            return null;
        }
        if (requested.parentVersionId() == null) {
            throw conflict("INGESTION_SOURCE_VERSION_PARENT_MISSING",
                    "incremental source dataset version requires its snapshot cursor parent: "
                            + requested.datasetKey());
        }
        List<String> parents = jdbc.query("""
                select c.last_successful_version_id
                from ingestion.dataset_cursors c
                join ingestion.source_dataset_versions v
                  on v.dataset_key=c.dataset_key and v.id=c.last_successful_version_id
                where c.dataset_key=? and v.status='published'
                for share of c,v
                """, (rs, row) -> rs.getString(1), requested.datasetKey());
        if (parents.size() != 1 || !requested.parentVersionId().equals(parents.getFirst())) {
            throw conflict("INGESTION_SOURCE_CURSOR_STALE",
                    "incremental source snapshot cursor changed before reservation: "
                            + requested.datasetKey());
        }
        return requested.parentVersionId();
    }

    private long nextProductVersion(String productKey) {
        Long next = jdbc.queryForObject("""
                select coalesce(max(version_number),0)+1
                from ingestion.data_product_versions where product_key=?
                """, Long.class, productKey);
        return next == null ? 1 : next;
    }

    private String sourceStorageRef(String versionId) {
        return IngestionPersistencePort.SOURCE_VERSION_STORAGE_PREFIX + text(versionId, "versionId")
                + "/" + IngestionPersistencePort.ROW_PACK_CODEC;
    }

    private String sourceKey(String versionId) {
        String sourceKey = jdbc.query("""
                select source_key from ingestion.source_dataset_versions where id=?
                """, rs -> rs.next() ? rs.getString(1) : null, versionId);
        if (sourceKey == null) {
            throw conflict("INGESTION_SOURCE_VERSION_NOT_FOUND", "source dataset version 不存在：" + versionId);
        }
        return sourceKey;
    }

    private IngestionRun sourceRun(String runId, boolean forUpdate) {
        List<IngestionRun> rows = jdbc.query("""
                select id,source_key,mode,status,trigger_type,triggered_by,correlation_id,
                       snapshot_context,row_counts,error_code,error_detail,started_at,finished_at,
                       created_at,updated_at
                from ingestion.source_ingestion_runs where id=?
                """ + (forUpdate ? " for update" : ""), this::sourceRun, runId);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    private IngestionRun requireSourceRun(String runId, boolean forUpdate) {
        IngestionRun run = sourceRun(text(runId, "runId"), forUpdate);
        if (run == null) throw conflict("INGESTION_RUN_NOT_FOUND", "source run 不存在：" + runId);
        return run;
    }

    private ProductMaterializationRun productRun(String runId, boolean forUpdate) {
        List<ProductMaterializationRun> rows = jdbc.query("""
                select id,product_key,mode,status,trigger_type,triggered_by,correlation_id,
                       input_summary,row_counts,error_code,error_detail,started_at,finished_at,
                       created_at,updated_at
                from ingestion.product_materialization_runs where id=?
                """ + (forUpdate ? " for update" : ""), this::productRun, runId);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    private ProductMaterializationRun requireProductRun(String runId, boolean forUpdate) {
        ProductMaterializationRun run = productRun(text(runId, "runId"), forUpdate);
        if (run == null) throw conflict("INGESTION_RUN_NOT_FOUND", "product run 不存在：" + runId);
        return run;
    }

    private List<DatasetVersion> sourceVersions(String runId, boolean forUpdate) {
        return jdbc.query("""
                select id,dataset_key,source_ingestion_run_id,parent_version_id,
                       version_number,status,source_watermark,
                       committed_cursor,storage_ref,row_count,content_hash,schema_version,published_at,created_at
                from ingestion.source_dataset_versions
                where source_ingestion_run_id=? order by dataset_key
                """ + (forUpdate ? " for update" : ""), this::datasetVersion, runId);
    }

    private DatasetVersion sourceVersionForRunDataset(String runId, String datasetKey,
                                                      boolean forUpdate) {
        List<DatasetVersion> rows = jdbc.query("""
                select id,dataset_key,source_ingestion_run_id,parent_version_id,
                       version_number,status,source_watermark,
                       committed_cursor,storage_ref,row_count,content_hash,schema_version,published_at,created_at
                from ingestion.source_dataset_versions
                where source_ingestion_run_id=? and dataset_key=?
                """ + (forUpdate ? " for update" : ""), this::datasetVersion, runId, datasetKey);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    private DatasetVersion requireSourceDatasetVersion(String versionId, boolean forUpdate) {
        List<DatasetVersion> rows = jdbc.query("""
                select id,dataset_key,source_ingestion_run_id,parent_version_id,
                       version_number,status,source_watermark,
                       committed_cursor,storage_ref,row_count,content_hash,schema_version,published_at,created_at
                from ingestion.source_dataset_versions where id=?
                """ + (forUpdate ? " for update" : ""), this::datasetVersion, versionId);
        if (rows.isEmpty()) {
            throw conflict("INGESTION_SOURCE_VERSION_NOT_FOUND",
                    "source dataset version 不存在：" + versionId);
        }
        return rows.getFirst();
    }

    private SourceBatchRow sourceBatchForVersionAndNumber(String versionId, long batchNumber,
                                                           boolean forUpdate) {
        List<SourceBatchRow> rows = jdbc.query("""
                select id,source_dataset_version_id,batch_number,row_count,content_hash,codec,payload,created_at
                from ingestion.source_dataset_batches
                where source_dataset_version_id=? and batch_number=?
                """ + (forUpdate ? " for update" : ""), this::sourceBatch, versionId, batchNumber);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    private List<SourceBatchRow> sourceBatches(String versionId) {
        return jdbc.query("""
                select id,source_dataset_version_id,batch_number,row_count,content_hash,codec,payload,created_at
                from ingestion.source_dataset_batches
                where source_dataset_version_id=? order by batch_number
                """, this::sourceBatch, versionId);
    }

    private DataProductVersion productVersionByRun(String runId) {
        List<DataProductVersion> rows = jdbc.query("""
                select id,product_key,materialization_run_id,version_number,status,storage_ref,
                       row_count,content_hash,schema_version,published_at,created_at
                from ingestion.data_product_versions where materialization_run_id=?
                """, this::productVersion, runId);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    private DatasetVersionSet versionSet(String setId) {
        List<DatasetVersionSet> rows = jdbc.query("""
                select set_id,status,captured_at,frozen_at,created_by,created_at
                from ingestion.dataset_version_sets where set_id=?
                """, (rs, row) -> new DatasetVersionSet(rs.getString("set_id"),
                versionSetItems(rs.getString("set_id")), rs.getTimestamp("captured_at").toInstant(),
                DatasetVersionSet.Status.valueOf(rs.getString("status").toUpperCase()),
                instant(rs, "frozen_at"), rs.getTimestamp("created_at").toInstant(),
                rs.getString("created_by")), setId);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    private DatasetVersionSet requireVersionSet(String setId) {
        DatasetVersionSet set = versionSet(setId);
        if (set == null) throw conflict("INGESTION_VERSION_SET_NOT_FOUND", "version set 不存在：" + setId);
        return set;
    }

    private Map<String, String> versionSetItems(String setId) {
        Map<String, String> items = new LinkedHashMap<>();
        jdbc.query("""
                select product_key,product_version_id from ingestion.dataset_version_set_items
                where set_id=? order by product_key
                """, (org.springframework.jdbc.core.RowCallbackHandler)
                rs -> items.put(rs.getString(1), rs.getString(2)), setId);
        return Map.copyOf(items);
    }

    private ProductVersionRow requirePublishedProductVersion(String productKey, String versionId) {
        List<ProductVersionRow> rows = jdbc.query("""
                select status,published_at from ingestion.data_product_versions
                where product_key=? and id=? for share
                """, (rs, row) -> new ProductVersionRow(rs.getString("status"),
                instant(rs, "published_at")), productKey, versionId);
        if (rows.size() != 1 || !"published".equals(rows.getFirst().status())) {
            throw conflict("INGESTION_PRODUCT_VERSION_INVALID",
                    "version set 只能引用匹配且已发布的 product version");
        }
        return rows.getFirst();
    }

    private IngestionRun sourceRun(ResultSet rs, int row) throws SQLException {
        return new IngestionRun(rs.getString("id"), rs.getString("source_key"),
                IngestionRun.Mode.valueOf(rs.getString("mode").toUpperCase()),
                IngestionRun.Status.valueOf(rs.getString("status").toUpperCase()),
                IngestionRun.TriggerType.valueOf(rs.getString("trigger_type").toUpperCase()),
                rs.getString("triggered_by"), rs.getString("correlation_id"),
                json.map(rs.getObject("snapshot_context")), longMap(rs.getObject("row_counts")),
                rs.getString("error_code"), nullableMap(rs.getObject("error_detail")),
                instant(rs, "started_at"), instant(rs, "finished_at"),
                rs.getTimestamp("created_at").toInstant(), rs.getTimestamp("updated_at").toInstant());
    }

    private ProductMaterializationRun productRun(ResultSet rs, int row) throws SQLException {
        return new ProductMaterializationRun(rs.getString("id"), rs.getString("product_key"),
                ProductMaterializationRun.Mode.valueOf(rs.getString("mode").toUpperCase()),
                ProductMaterializationRun.Status.valueOf(rs.getString("status").toUpperCase()),
                ProductMaterializationRun.TriggerType.valueOf(rs.getString("trigger_type").toUpperCase()),
                rs.getString("triggered_by"), rs.getString("correlation_id"),
                stringMap(rs.getObject("input_summary")), longMap(rs.getObject("row_counts")),
                rs.getString("error_code"), nullableMap(rs.getObject("error_detail")),
                instant(rs, "started_at"), instant(rs, "finished_at"),
                rs.getTimestamp("created_at").toInstant(), rs.getTimestamp("updated_at").toInstant());
    }

    private DatasetVersion datasetVersion(ResultSet rs, int row) throws SQLException {
        return new DatasetVersion(rs.getString("id"), rs.getString("dataset_key"),
                rs.getLong("version_number"), DatasetVersion.Status.valueOf(
                rs.getString("status").toUpperCase()), rs.getString("source_ingestion_run_id"),
                rs.getString("parent_version_id"),
                json.map(rs.getObject("source_watermark")), json.map(rs.getObject("committed_cursor")),
                rs.getString("storage_ref"),
                rs.getLong("row_count"), rs.getString("content_hash"), rs.getInt("schema_version"),
                instant(rs, "published_at"), rs.getTimestamp("created_at").toInstant());
    }

    private SourceBatchRow sourceBatch(ResultSet rs, int row) throws SQLException {
        SourceBatchReceipt receipt = new SourceBatchReceipt(rs.getString("id"),
                rs.getString("source_dataset_version_id"), rs.getLong("batch_number"),
                rs.getLong("row_count"), rs.getString("content_hash"), rs.getString("codec"),
                rs.getTimestamp("created_at").toInstant());
        return new SourceBatchRow(receipt, rs.getBytes("payload"));
    }

    private DataProductVersion productVersion(ResultSet rs, int row) throws SQLException {
        return new DataProductVersion(rs.getString("id"), rs.getString("product_key"),
                rs.getLong("version_number"), DataProductVersion.Status.valueOf(
                rs.getString("status").toUpperCase()), rs.getString("materialization_run_id"),
                rs.getInt("schema_version"), rs.getString("storage_ref"), rs.getLong("row_count"),
                rs.getString("content_hash"), instant(rs, "published_at"),
                rs.getTimestamp("created_at").toInstant());
    }

    private boolean sameSourceRequest(IngestionRun existing, SourceRunRequest request) {
        // The planned context is a pre-snapshot placeholder, so it is not part of
        // retry identity once the real source transaction context is recorded.
        return existing.sourceKey().equals(request.sourceKey())
                && existing.mode() == request.mode()
                && existing.triggerType() == request.triggerType()
                && Objects.equals(existing.triggeredBy(), nullableText(request.triggeredBy()))
                && Objects.equals(existing.correlationId(), nullableText(request.correlationId()))
                && (IngestionPersistencePort.PLANNED_SOURCE_SNAPSHOT_CONTEXT.equals(
                        request.snapshotContext())
                        || existing.snapshotContext().equals(request.snapshotContext()));
    }

    private boolean sameProductRequest(ProductMaterializationRun existing, ProductRunRequest request) {
        return existing.productKey().equals(request.productKey())
                && existing.mode() == request.mode()
                && existing.triggerType() == request.triggerType()
                && Objects.equals(existing.triggeredBy(), nullableText(request.triggeredBy()))
                && Objects.equals(existing.correlationId(), nullableText(request.correlationId()))
                && existing.sourceDatasetVersionIds().equals(request.sourceDatasetVersionIds());
    }

    private void lock(String kind, String key, String code) {
        Boolean acquired = jdbc.queryForObject("""
                select pg_try_advisory_xact_lock(hashtextextended(?,0))
                """, Boolean.class, "ingestion:" + kind + ":" + text(key, "lock key"));
        if (!Boolean.TRUE.equals(acquired)) throw conflict(code, "ingestion control-plane 事务冲突");
    }

    private Map<String, Object> nullableMap(Object value) {
        return value == null ? null : json.map(value);
    }

    private Map<String, Long> longMap(Object value) {
        Map<String, Long> result = new LinkedHashMap<>();
        json.map(value).forEach((key, item) -> {
            if (!(item instanceof Number number)) {
                throw conflict("INGESTION_DATABASE_JSON_INVALID", "row_counts 必须是数值对象");
            }
            result.put(key, number.longValue());
        });
        return Map.copyOf(result);
    }

    private Map<String, String> stringMap(Object value) {
        Map<String, String> result = new LinkedHashMap<>();
        json.map(value).forEach((key, item) -> result.put(key, String.valueOf(item)));
        return Map.copyOf(result);
    }

    /**
     * Aggregate is SHA-256 over the ordered canonical receipt lines
     * {@code batchNumber:rowCount:batchContentHash\n}.  Batch payload hashes
     * are calculated before insertion, so publication verifies both bytes and
     * order without storing a second mutable JSON manifest.
     */
    private SourceBatchManifest.Aggregate aggregate(List<SourceBatchRow> batches) {
        try {
            return SourceBatchManifest.aggregate(batches.stream()
                    .map(SourceBatchRow::receipt).toList());
        } catch (IllegalArgumentException error) {
            throw conflict("INGESTION_BATCH_SEQUENCE_INVALID", error.getMessage());
        }
    }

    private static Instant instant(ResultSet rs, String column) throws SQLException {
        Timestamp value = rs.getTimestamp(column);
        return value == null ? null : value.toInstant();
    }

    private static Timestamp at(Instant value) {
        return value == null ? null : Timestamp.from(value);
    }

    private static String db(Enum<?> value) {
        return Objects.requireNonNull(value, "enum value").name().toLowerCase();
    }

    private static String text(String value, String field) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException(field + " must not be blank");
        return value;
    }

    private static String nullableText(String value) {
        return value == null ? null : text(value, "optional text");
    }

    private static Map<String, Object> requireMap(Map<String, Object> value, String field) {
        if (value == null) throw new IllegalArgumentException(field + " must not be null");
        return Map.copyOf(value);
    }

    private static Map<String, Object> requireSnapshotContext(Map<String, Object> value) {
        if (value == null || value.isEmpty() || value.entrySet().stream().anyMatch(entry ->
                entry.getKey() == null || entry.getKey().isBlank() || entry.getValue() == null)) {
            throw new IllegalArgumentException(
                    "snapshotContext must contain non-null entries");
        }
        if ("planned".equals(value.get("phase"))) {
            throw new IllegalArgumentException(
                    "snapshotContext must describe an observed source snapshot");
        }
        return Map.copyOf(value);
    }

    private static void requireRequest(Object request, String field) {
        if (request == null) throw new IllegalArgumentException(field + " must not be null");
    }

    private static void requireChanged(int changed, String code, String message) {
        if (changed != 1) throw conflict(code, message);
    }

    private static BackendException stateConflict(String kind, String id, String status) {
        return conflict("INGESTION_STATE_CONFLICT",
                kind + " " + id + " 当前状态不允许该操作：" + status);
    }

    private static BackendException conflict(String code, String message) {
        return new BackendException(code, message);
    }

    private static <T> T execute(TransactionTemplate template, Supplier<T> action) {
        T result = template.execute(status -> action.get());
        if (result == null) throw new IllegalStateException("transaction returned null");
        return result;
    }

    private record DatasetDefinitionRow(String sourceKey, int schemaVersion, String status) {}

    private record ProductDefinitionRow(String transformRef, int schemaVersion, String status) {}

    private record ProductInputRow(String inputKey, String datasetKey, boolean required) {}

    private record ProductVersionRow(String status, Instant publishedAt) {}

    private record SourceBatchRow(SourceBatchReceipt receipt, byte[] payload) {
        private String id() {
            return receipt.id();
        }

        private long batchNumber() {
            return receipt.batchNumber();
        }

        private long rowCount() {
            return receipt.rowCount();
        }

        private String contentHash() {
            return receipt.contentHash();
        }
    }

}
