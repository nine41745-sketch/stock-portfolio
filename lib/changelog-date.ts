/** Formats known provenance labels without changing or inventing timestamps. */
export function formatChangelogDate(value: string): string {
  const match = value.match(/^Development History — (Feature commit|Preview alias) (\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?) (\+07:00|ICT) \(ไม่ใช่ Production\)$/)
  if (!match) return value
  const label = match[1] === 'Feature commit' ? 'เวลาพัฒนา' : 'เวลา Preview'
  return `${match[2]} ICT · ${label} (ไม่ใช่เวลา Production)`
}
