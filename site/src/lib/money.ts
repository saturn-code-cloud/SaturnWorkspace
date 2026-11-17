export function formatMoneyMinor(amount: number | null | undefined, currency: string, locale: 'ar' | 'en') {
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || !/^[A-Z]{3}$/.test(currency)) return ''
  try {
    const formatter = new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-US', { style: 'currency', currency })
    const digits = formatter.resolvedOptions().maximumFractionDigits
    if (typeof digits !== 'number') return ''
    return formatter.format(amount / 10 ** digits)
  } catch { return '' }
}
