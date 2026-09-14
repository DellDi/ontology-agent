package com.dip3.ontologyagent.auth;

import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;

/** 平台账号口令哈希（PBKDF2-HmacSHA256，600k 迭代，随机盐）。 */
final class PasswordHash {
    private static final int ITERATIONS = 600_000;
    static String hash(String password) {
        byte[] salt = new byte[16]; new SecureRandom().nextBytes(salt);
        return Base64.getEncoder().encodeToString(salt) + ":" + Base64.getEncoder().encodeToString(derive(password, salt));
    }
    static boolean matches(String password, String encoded) {
        String[] parts = encoded.split(":", -1);
        if (parts.length != 2) throw new IllegalStateException("Invalid stored password hash");
        return MessageDigest.isEqual(derive(password, Base64.getDecoder().decode(parts[0])), Base64.getDecoder().decode(parts[1]));
    }
    private static byte[] derive(String password, byte[] salt) {
        var spec = new PBEKeySpec(password.toCharArray(), salt, ITERATIONS, 256);
        try { return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded(); }
        catch (java.security.GeneralSecurityException error) { throw new IllegalStateException("Password hashing unavailable", error); }
        finally { spec.clearPassword(); }
    }
}
