/** 正式指标绑定的展示；缺失单位或口径明确说明，不用示例数值替代。 */
export function MetricDefinition({ properties }: { properties: Record<string, unknown> }) {
  return <div className="space-y-3 text-sm">
    <dl className="space-y-3">{[['metricName','指标'],['metricUnit','单位'],['aggregationRule','口径'],['metricDescription','含义']].map(([key,title]) => properties[key] ? <div key={key}>
      <dt className="mb-1 text-xs text-muted-foreground">{title}</dt><dd className="whitespace-pre-wrap leading-6">{String(properties[key])}</dd>
    </div> : null)}</dl>
    {!properties.metricUnit || !properties.aggregationRule ? <p className="text-xs text-muted-foreground">源记录未保留{!properties.metricUnit && !properties.aggregationRule ? '单位和口径' : !properties.metricUnit ? '单位' : '口径'}。</p> : null}
  </div>;
}
