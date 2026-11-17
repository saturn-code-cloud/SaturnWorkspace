export function parseServiceTimestamp(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const raw = value.trim()
  const sqlOrUnzoned = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(raw)
  const date = new Date(sqlOrUnzoned ? raw.replace(' ', 'T') + 'Z' : raw)
  return Number.isFinite(date.getTime()) ? date : null
}
