package com.dip3.ontologyagent.tooling;

import java.util.List;
import java.util.Map;

public record Evidence(String source, String title, List<Map<String, Object>> rows) {}
