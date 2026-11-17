import type { AdminDiagnosticCoveragePeriod } from '../../../api/admin'

export type DiagnosticDateRange = { from: Date; to: Date }

const retentionMs = 90 * 24 * 60 * 60 * 1000

export function localDateKey(value: Date) {
  return [value.getFullYear(), value.getMonth() + 1, value.getDate()].map((part) => String(part).padStart(2, '0')).join('-')
}

function parseLocalDate(key: string | null) {
  if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return undefined
  const [year, month, day] = key.split('-').map(Number)
  const value = new Date(year, month - 1, day)
  return localDateKey(value) === key ? value : undefined
}

function localMidnight(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}

function offsetLocalDays(value: Date, days: number) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate() + days)
}

export function diagnosticDateBounds(now = new Date()) {
  return { earliest: localMidnight(new Date(now.getTime() - retentionMs)), today: localMidnight(now) }
}

export function readDiagnosticDateRange(state?: string, now = new Date()): { range: DiagnosticDateRange; adjusted: boolean } {
  const params = new URLSearchParams(state)
  const { earliest, today } = diagnosticDateBounds(now)
  const from = parseLocalDate(params.get('from'))
  const to = parseLocalDate(params.get('to'))
  if (from && to && from <= to && to >= earliest && from <= today) {
    return {
      range: { from: from < earliest ? earliest : from, to: to > today ? today : to },
      adjusted: from < earliest || to > today,
    }
  }
  const legacyDays = params.get('days')
  const days = legacyDays === '30' ? 30 : legacyDays === '90' ? 90 : 7
  return { range: { from: offsetLocalDays(today, 1 - days), to: today }, adjusted: params.has('from') || params.has('to') }
}

export function diagnosticRangeQuery(range: DiagnosticDateRange) {
  return '?' + new URLSearchParams({ from: localDateKey(range.from), to: localDateKey(range.to) })
}

export function diagnosticCoveragePeriod(range: DiagnosticDateRange): AdminDiagnosticCoveragePeriod {
  return { from: localMidnight(range.from).toISOString(), to: offsetLocalDays(range.to, 1).toISOString() }
}

export function formatDiagnosticCalendarDay(day: Date, locale: 'ar' | 'en') {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' }).format(day)
}
