import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { useExperience } from '../app/ExperienceProvider'
import type { Navigate } from '../app/routes'
import { Button } from '../components/ui/Button'
import { SearchInput } from '../components/ui/FormControls'
import { Modal } from '../components/ui/Overlays'
import { RouteLink } from '../components/ui/RouteLink'
import type { NavigationGroup } from './WorkspaceShell'

export function AdminSectionFinder({ groups, navigate }: { groups: NavigationGroup[]; navigate: Navigate }) {
  const { locale, t } = useExperience()
  const isArabic = locale === 'ar'
  const title = isArabic ? 'انتقل إلى قسم' : 'Go to a section'
  const inputId = useId()
  const listId = inputId + '-results'
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [focusedId, setFocusedId] = useState<string>()
  const show = useCallback(() => { setQuery(''); setFocusedId(undefined); setOpen(true) }, [])
  const close = useCallback(() => setOpen(false), [])
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'k') return
      if (document.querySelector('[role="dialog"][aria-modal="true"], dialog:modal, :is(:popover-open)')) return
      event.preventDefault()
      show()
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [show])
  const term = query.trim().toLocaleLowerCase(locale)
  const results = groups.map(({ label, items }) => ({
    label,
    items: items.filter((item) => !item.disabled && (!term || `${item.label} ${item.id}`.toLocaleLowerCase(locale).includes(term))),
  })).filter((group) => group.items.length)
  const matching = results.flatMap((group) => group.items)
  const activeIndex = Math.max(0, matching.findIndex((item) => item.id === focusedId))
  const activeId = matching[activeIndex]?.id
  const activeOptionId = activeId ? listId + '-' + activeId : undefined
  useEffect(() => {
    if (open && activeOptionId) document.getElementById(activeOptionId)?.scrollIntoView({ block: 'nearest' })
  }, [open, activeOptionId])
  const goTo = (route: Parameters<Navigate>[0]) => { close(); navigate(route) }
  return <>
    <Button type="button" className="admin-section-finder" size="sm" leadingIcon={<Search size={16} aria-hidden="true" />}
      aria-haspopup="dialog" aria-expanded={open} aria-keyshortcuts="Control+K Meta+K" onClick={show}>
      {title}<kbd dir="ltr" aria-hidden="true">Ctrl K</kbd>
    </Button>
    <Modal open={open} onClose={close} title={title} closeLabel={t('close')} initialFocusRef={inputRef}>
      <div className="stack stack--compact">
        <SearchInput ref={inputRef} id={inputId} name="section" autoComplete="off" spellCheck={false}
            role="combobox" aria-autocomplete="list" aria-expanded={Boolean(activeId)}
            aria-controls={activeId ? listId : undefined} aria-activedescendant={activeOptionId}
            label={isArabic ? 'ابحث باسم القسم' : 'Search sections'}
            placeholder={isArabic ? 'ابحث عن قسم…' : 'Search sections…'}
            value={query} onChange={(event) => { setQuery(event.target.value); setFocusedId(undefined) }}
            onKeyDown={(event) => {
              if (!activeId || event.nativeEvent.isComposing || event.altKey || event.shiftKey) return
              if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey) {
                event.preventDefault()
                goTo({ surface: 'admin', page: activeId })
              } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !event.ctrlKey && !event.metaKey) {
                event.preventDefault()
                const direction = event.key === 'ArrowDown' ? 1 : -1
                const next = Math.min(matching.length - 1, Math.max(0, activeIndex + direction))
                setFocusedId(matching[next].id)
              }
            }} />
        {matching.length ? <div id={listId} className="admin-section-results" role="listbox"
          aria-label={isArabic ? 'الأقسام المطابقة' : 'Matching sections'}>
          {results.map(({ label, items }, index) => {
            const heading = listId + '-group-' + index
            return <div key={items[0].id} role={label ? 'group' : 'presentation'} aria-labelledby={label ? heading : undefined}>
              {label ? <div id={heading} className="admin-section-results__heading">{label}</div> : null}
              {items.map(({ id, label: itemLabel, icon: Icon }) => <RouteLink key={id}
                id={listId + '-' + id} role="option" tabIndex={-1} aria-selected={id === activeId}
                route={{ surface: 'admin', page: id }} navigate={goTo}>
                <Icon size={16} aria-hidden="true" /><span>{itemLabel}</span>
              </RouteLink>)}
            </div>
          })}
        </div> : <p className="secondary" role="status">{isArabic ? 'لا يوجد قسم مطابق.' : 'No matching sections.'}</p>}
      </div>
    </Modal>
  </>
}
