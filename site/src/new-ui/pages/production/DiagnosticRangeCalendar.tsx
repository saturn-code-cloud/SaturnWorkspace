import { DayPicker, type DateRange } from '@daypicker/react'
import { arEG } from '@daypicker/react/locale/ar-EG'
import '@daypicker/react/style.css'
import '../../foundation/date-range-calendar.css'

export default function DiagnosticRangeCalendar({ locale, selected, onSelect, earliest, today }: {
  locale: 'ar' | 'en'
  selected?: DateRange
  onSelect: (range: DateRange | undefined) => void
  earliest: Date
  today: Date
}) {
  return <DayPicker
    className="date-range-calendar"
    mode="range"
    locale={locale === 'ar' ? arEG : undefined}
    dir={locale === 'ar' ? 'rtl' : 'ltr'}
    numerals={locale === 'ar' ? 'arab' : 'latn'}
    defaultMonth={selected?.to ?? selected?.from ?? today}
    today={today}
    startMonth={earliest}
    endMonth={today}
    disabled={[{ before: earliest }, { after: today }]}
    selected={selected}
    onSelect={onSelect}
    resetOnSelect
  />
}
