package com.dip3.ontologyagent.easyv.internal.application;

import com.dip3.ontologyagent.easyv.internal.domain.EasyVWritebackContract;

/** EasyV 写回上游契约只读探针端口；执行 READ ONLY 数据库核验与只读 Redis PING。 */
public interface EasyVWritebackContractPort {
  EasyVWritebackContract.Report check();
}
