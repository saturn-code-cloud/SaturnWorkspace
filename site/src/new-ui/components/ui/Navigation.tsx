import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { nextTabTarget } from './tabNavigation'

export function Tabs({ items, active, onChange, ariaLabel, children, panelClassName = 'stack' }: { items: { id: string; label: string; icon?: ReactNode; disabled?: boolean }[]; active: string; onChange: (id: string) => void; ariaLabel: string; children: ReactNode; panelClassName?: string }) {
  const id = useId()
  const list = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState<string | null>(null)
  const available = items.filter((item) => !item.disabled)
  const selected = available.find((item) => item.id === active)
  const tabStop = available.find((item) => item.id === focused)?.id || selected?.id || available[0]?.id
  const tabId = (value: string) => `${id}-tab-${encodeURIComponent(value)}`
  const panelId = (value: string) => `${id}-panel-${encodeURIComponent(value)}`
  const move = (event: KeyboardEvent<HTMLButtonElement>, value: string) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const rtl = window.getComputedStyle(event.currentTarget).direction === 'rtl'
    const target = nextTabTarget(items, value, event.key, rtl)
    if (target === null) return
    event.preventDefault()
    const button = list.current?.querySelector<HTMLButtonElement>(`[id="${CSS.escape(tabId(target))}"]`)
    button?.focus({ preventScroll: true })
    button?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
  return <>
    <div className="ui-tabs" role="tablist" aria-label={ariaLabel} aria-orientation="horizontal" ref={list} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(null) }}>
      {items.map((item) => <button type="button" key={item.id} id={tabId(item.id)} role="tab" aria-selected={selected?.id === item.id} aria-controls={panelId(item.id)} tabIndex={!item.disabled && tabStop === item.id ? 0 : -1} className={selected?.id === item.id ? 'is-active' : ''} disabled={item.disabled} onFocus={() => setFocused(item.id)} onKeyDown={(event) => move(event, item.id)} onClick={() => { if (item.id !== active) onChange(item.id) }}>{item.icon}{item.label}</button>)}
    </div>
    {selected ? <div className={`ui-tab-panel ${panelClassName}`} role="tabpanel" id={panelId(selected.id)} aria-labelledby={tabId(selected.id)} tabIndex={0}>{children}</div> : null}
    {items.filter((item) => item.id !== selected?.id).map((item) => <div key={item.id} role="tabpanel" id={panelId(item.id)} aria-labelledby={tabId(item.id)} hidden />)}
  </>
}

export function Accordion({ items, initiallyOpen = true }: { items: { id: string; title: string; body: ReactNode }[]; initiallyOpen?: boolean }) {
  const id = useId()
  const [open, setOpen] = useState<string | null>(initiallyOpen ? items[0]?.id ?? null : null)
  return <div className="ui-accordion">{items.map((item) => {
    const expanded = open === item.id
    const panel = `${id}-${item.id}`
    return <section key={item.id}><button type="button" aria-expanded={expanded} aria-controls={panel} onClick={() => setOpen(expanded ? null : item.id)}><span>{item.title}</span><ChevronDown size={17} aria-hidden="true" /></button><div id={panel} hidden={!expanded}>{expanded ? item.body : null}</div></section>
  })}</div>
}

export function SegmentedControl({ items, value, onChange, ariaLabel }: { items: { value: string; label: string }[]; value: string; onChange: (value: string) => void; ariaLabel: string }) {
  return <div className="ui-segmented" role="group" aria-label={ariaLabel}>{items.map((item) => <button type="button" key={item.value} className={item.value === value ? 'is-active' : ''} aria-pressed={item.value === value} onClick={() => onChange(item.value)}>{item.label}</button>)}</div>
}
