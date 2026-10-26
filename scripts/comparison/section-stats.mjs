// Statistics of section statistics: every section has equal weight, never labelled as voter-level percentiles.
export const median = (values) => {
  if (!values.length) return null
  const sorted = values.toSorted((a,b) => a-b)
  const middle = sorted.length >> 1
  return sorted.length % 2 ? sorted[middle] : (sorted[middle-1]+sorted[middle])/2
}
export function sectionStatistics(rows) {
  const values = (key) => rows.map((r) => r[key]).filter((v) => v != null)
  return {
    sections: rows.length,
    section_median_gap: median(values('med')),
    section_p10_gap: median(values('p10')),
    section_p90_gap: median(values('p90')),
    longest_pause: rows.reduce((v,r) => r.maxgap == null ? v : Math.max(v ?? r.maxgap,r.maxgap), null),
    earliest_event: rows.reduce((v,r) => Math.min(v ?? r.first,r.first), null),
    latest_event: rows.reduce((v,r) => Math.max(v ?? r.last,r.last), null),
  }
}
