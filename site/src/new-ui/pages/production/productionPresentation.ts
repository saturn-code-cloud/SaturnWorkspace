import { parseServiceTimestamp } from '../../../lib/serviceTimestamp'

export function copyByLocale(locale: 'ar' | 'en', en: string, ar: string) {
  return locale === 'ar' ? ar : en
}

export function formatBytes(bytes?: number) {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

export function formatDisplayDate(value?: string | null, locale: 'ar' | 'en' = 'ar') {
  const date = parseServiceTimestamp(value)
  if (!date) return '—'
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}
