package com.dip3.ontologyagent.integration.erp;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.math.BigDecimal;
import java.time.Instant;

@TableName("erp_staging.dw_datacenter_charge")
public class ErpChargeEntity {
    @TableId(type = IdType.INPUT)
    public Long recordId;
    public String organizationId;
    public String precinctId;
    public String precinctName;
    public Instant shouldChargeDate;
    public BigDecimal actualChargeSum;
    public BigDecimal paidChargeSum;
    public BigDecimal arrears;
}
