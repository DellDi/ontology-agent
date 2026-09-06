package com.dip3.ontologyagent.ingestion.internal.application;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;

/** Canonical hashing rules shared by batch writers and publication verification. */
public final class SourceBatchManifest {
    private SourceBatchManifest() {}

    public static String contentHash(byte[] payload) {
        if (payload == null || payload.length == 0) {
            throw new IllegalArgumentException("payload must not be empty");
        }
        return HexFormat.of().formatHex(digest().digest(payload));
    }

    public static Aggregate aggregate(
            List<IngestionPersistencePort.SourceBatchReceipt> receipts) {
        if (receipts == null || receipts.stream().anyMatch(receipt -> receipt == null)) {
            throw new IllegalArgumentException("receipts must not contain null");
        }
        MessageDigest digest = digest();
        long rowCount = 0;
        long expectedBatchNumber = 1;
        for (IngestionPersistencePort.SourceBatchReceipt receipt : receipts) {
            if (receipt.batchNumber() != expectedBatchNumber) {
                throw new IllegalArgumentException("batch numbers must start at 1 and be contiguous");
            }
            try {
                rowCount = Math.addExact(rowCount, receipt.rowCount());
            } catch (ArithmeticException error) {
                throw new IllegalArgumentException("batch row count exceeds long range", error);
            }
            digest.update((receipt.batchNumber() + ":" + receipt.rowCount() + ":"
                    + receipt.contentHash() + "\n").getBytes(StandardCharsets.UTF_8));
            expectedBatchNumber++;
        }
        return new Aggregate(receipts.size(), rowCount,
                HexFormat.of().formatHex(digest.digest()));
    }

    private static MessageDigest digest() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException("SHA-256 is required by row-pack-v1", error);
        }
    }

    public record Aggregate(long batchCount, long rowCount, String contentHash) {}
}
