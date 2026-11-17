import { useId, useLayoutEffect, useRef, useState } from 'react'
import { CalendarDays } from 'lucide-react'
import type { DateRange } from '@daypicker/react'
import { useExperience } from '../../app/ExperienceProvider'
import { Button } from '../../components/ui/Button'
import { formatDiagnosticCalendarDay, type DiagnosticDateRange } from './diagnosticDateRange'

export function DiagnosticDateRangePicker({ range, earliest, today, onApply }: {
  range: DiagnosticDateRange
  earliest: Date
  today: Date
  onApply: (range: DiagnosticDateRange) => void
}) {
  const { locale } = useExperience()
  const panelId = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<DateRange>()
  const [Calendar, setCalendar] = useState<typeof import('./DiagnosticRangeCalendar').default>()
  const [calendarUnavailable, setCalendarUnavailable] = useState(false)
  const arabic = locale === 'ar'
  const label = arabic ? 'اختيار فترة التقارير' : 'Choose report dates'
  const formatDate = (date: Date) => formatDiagnosticCalendarDay(date, locale)
  const rangeLabel = (from: Date, to: Date) => {
    const start = formatDate(from)
    const end = formatDate(to)
    return start === end ? start : arabic ? `من ${start} إلى ${end}` : `${start} to ${end}`
  }
  const selectedLabel = rangeLabel(range.from, range.to)

  useLayoutEffect(() => {
    const anchor = trigger.current
    const surface = panel.current
    if (!open || !anchor || !surface) return
    const edge = 8
    const gap = 6
    const place = () => {
      if (!surface.matches(':popover-open')) return
      const bounds = anchor.getBoundingClientRect()
      const { clientWidth, clientHeight } = document.documentElement
      if (bounds.bottom < 0 || bounds.top > clientHeight) {
        surface.hidePopover()
        return
      }
      const below = Math.max(0, clientHeight - bounds.bottom - edge - gap)
      const above = Math.max(0, bounds.top - edge - gap)
      const naturalHeight = surface.scrollHeight + (surface.offsetHeight - surface.clientHeight)
      const opensAbove = naturalHeight > below && above > below
      surface.style.maxBlockSize = `${opensAbove ? above : below}px`
      const width = surface.offsetWidth
      const start = arabic ? bounds.right - width : bounds.left
      const end = arabic ? bounds.left : bounds.right - width
      const rightmost = clientWidth - width - edge
      const aligned = start >= edge && start <= rightmost ? start : end >= edge && end <= rightmost ? end : start
      surface.style.left = `${Math.max(edge, Math.min(aligned, rightmost))}px`
      surface.style.top = `${opensAbove ? bounds.top - surface.offsetHeight - gap : bounds.bottom + gap}px`
      surface.dataset.positioned = 'true'
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(surface)
    observer.observe(anchor)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, { capture: true, passive: true })
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      delete surface.dataset.positioned
    }
  }, [open, arabic])

  const loadCalendar = () => {
    setCalendarUnavailable(false)
    void import('./DiagnosticRangeCalendar').then((module) => setCalendar(() => module.default))
      .catch(() => setCalendarUnavailable(true))
  }
  const apply = () => {
    if (!draft?.from || !draft.to || !Calendar) return
    onApply({ from: draft.from, to: draft.to })
    panel.current?.hidePopover()
    trigger.current?.focus()
  }
  return <>
    <Button ref={trigger} type="button" size="sm" popoverTarget={panelId}
      leadingIcon={<CalendarDays aria-hidden="true" size={16} />} aria-haspopup="dialog"
      aria-expanded={open} aria-controls={panelId} aria-label={`${label}: ${selectedLabel}`}>
      {selectedLabel}
    </Button>
    <div ref={panel} id={panelId} popover="auto" role="dialog" aria-label={label}
      className="ui-popover diagnostic-date-popover" onToggle={(event) => {
        const next = event.newState === 'open'
        setOpen(next)
        if (!next) return
        setDraft(range)
        if (!Calendar) loadCalendar()
      }}>
      {open ? <>
        {Calendar ? <Calendar locale={locale} selected={draft} onSelect={setDraft} earliest={earliest} today={today} />
          : calendarUnavailable ? <div className="stack stack--compact">
            <p className="secondary" role="status">{arabic ? 'تعذر تحميل التقويم.' : 'Could not load the calendar.'}</p>
            <Button size="sm" onClick={loadCalendar}>{arabic ? 'إعادة المحاولة' : 'Retry'}</Button>
          </div>
          : <p className="secondary" role="status">{arabic ? 'جارٍ تحميل التقويم…' : 'Loading calendar…'}</p>}
        <span className="sr-only" role="status">{draft?.from && draft.to ? rangeLabel(draft.from, draft.to)
          : draft?.from ? (arabic ? `تاريخ البداية: ${formatDate(draft.from)}. اختر تاريخ النهاية.` : `Start date: ${formatDate(draft.from)}. Choose the end date.`) : ''}</span>
        {Calendar ? <div className="diagnostic-date-popover__actions">
          <Button type="button" size="sm" variant="primary" disabled={!draft?.from || !draft.to} onClick={apply}>
            {arabic ? 'تطبيق الفترة' : 'Apply dates'}
          </Button>
        </div> : null}
      </> : null}
    </div>
  </>
}
