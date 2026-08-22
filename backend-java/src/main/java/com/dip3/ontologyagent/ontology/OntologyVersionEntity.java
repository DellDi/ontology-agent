package com.dip3.ontologyagent.ontology;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.Instant;

@TableName("platform.ontology_versions")
public class OntologyVersionEntity {
    @TableId(type = IdType.INPUT)
    public String id;
    public String semver;
    public String status;
    public Instant publishedAt;
}
