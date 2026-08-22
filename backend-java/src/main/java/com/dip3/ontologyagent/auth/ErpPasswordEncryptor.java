package com.dip3.ontologyagent.auth;

import java.util.Optional;

/** 调用远端 ERP 加密接口对明文密码做 AES 加密（用于与目录存储密文比对）。 */
public interface ErpPasswordEncryptor {
    /** 加密成功返回密文；网络失败、结构异常或结果为空返回 empty（不抛错）。 */
    Optional<String> encrypt(String plainPassword);
}
