import { useId, useRef, useState, type FormEvent } from 'react'
import { ListFilter } from 'lucide-react'
import type { AdminDiagnosticFilters } from '../../../api/admin'
import { useExperience } from '../../app/ExperienceProvider'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Feedback'
import { FormField, Input, SearchInput, Select } from '../../components/ui/FormControls'

export type AppliedDiagnosticFilters = Pick<AdminDiagnosticFilters, 'search' | 'user' | 'attribution'>

export function DiagnosticFiltersToolbar({ applied, onApply }: {
  applied: AppliedDiagnosticFilters
  onApply: (filters: AppliedDiagnosticFilters) => void
}) {
  const { locale } = useExperience()
  const text = (en: string, ar: string) => locale === 'ar' ? ar : en
  const panelId = useId()
  const searchInput = useRef<HTMLInputElement>(null)
  const [search, setSearch] = useState(applied.search ?? '')
  const [user, setUser] = useState(applied.user ?? '')
  const [attribution, setAttribution] = useState<AppliedDiagnosticFilters['attribution']>(applied.attribution)
  const [expanded, setExpanded] = useState(false)
  const [invalid, setInvalid] = useState<'search' | 'user' | null>(null)
  const hasApplied = Boolean(applied.search || applied.user || applied.attribution)
  const hasPending = search.trim() !== (applied.search ?? '') || user.trim() !== (applied.user ?? '') || attribution !== applied.attribution
  const attributionLabels = {
    verified: text('Verified user', 'مستخدم موثّق'),
    unattributed: text('No verified user', 'بدون مستخدم موثّق'),
  }
  const searchError = text('Enter a search term.', 'أدخل كلمة للبحث.')
  const userError = text('Check the email or user ID.', 'تحقق من البريد أو معرّف المستخدم.')

  const apply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    // Match the report search's server-side normalization before showing the active term.
    const nextSearch = search.replace(/[,%()*]/g, ' ').replace(/\s+/g, ' ').trim()
    if (search.trim() && !nextSearch) {
      setInvalid('search')
      searchInput.current?.focus()
      return
    }
    const nextUser = user.trim()
    if (/[,()"\\]/.test(nextUser) || Array.from(nextUser).some((character) => character.charCodeAt(0) <= 32)) {
      setInvalid('user')
      event.currentTarget.querySelector<HTMLInputElement>('[name="user"]')?.focus()
      return
    }
    setInvalid(null)
    setSearch(nextSearch)
    setUser(nextUser)
    if (nextSearch === (applied.search ?? '') && nextUser === (applied.user ?? '') && attribution === applied.attribution) return
    onApply({ search: nextSearch || undefined, user: nextUser || undefined, attribution })
    if (expanded) searchInput.current?.focus()
    setExpanded(false)
  }

  return <div className="diagnostic-filters">
    <form role="search" aria-label={text('Filter diagnostic reports', 'تصفية تقارير التشخيص')} onSubmit={apply}>
      <div className="diagnostic-filters__controls">
        <SearchInput ref={searchInput} name="search" value={search} maxLength={100}
          label={text('Search reports', 'بحث في التقارير')} placeholder={text('Search reports…', 'بحث في التقارير…')}
          aria-invalid={invalid === 'search'} aria-describedby={invalid === 'search' ? panelId + '-search-error' : undefined}
          onChange={(event) => { setSearch(event.target.value); if (invalid === 'search') setInvalid(null) }} />
        <Button type="submit" size="sm">{expanded ? text('Apply filters', 'تطبيق الفلاتر') : text('Search', 'بحث')}</Button>
        <Button type="button" size="sm" leadingIcon={<ListFilter size={15} aria-hidden="true" />}
          aria-expanded={expanded} aria-controls={panelId}
          onClick={() => {
            if (expanded) {
              setUser(applied.user ?? '')
              setAttribution(applied.attribution)
              if (invalid === 'user') setInvalid(null)
            }
            setExpanded(!expanded)
          }}>{text('Filters', 'الفلاتر')}</Button>
      </div>
      {invalid === 'search' ? <p className="ui-field__error" id={panelId + '-search-error'}>{searchError}</p> : null}
      <div className="diagnostic-filters__details" id={panelId} hidden={!expanded}>
        <FormField label={text('User email or ID', 'بريد المستخدم أو معرّفه')} htmlFor={panelId + '-user'}>
          <Input id={panelId + '-user'} name="user" value={user} dir="auto" maxLength={254} autoComplete="off"
            aria-invalid={invalid === 'user'} aria-describedby={invalid === 'user' ? panelId + '-user-error' : undefined}
            onChange={(event) => { setUser(event.target.value); if (invalid === 'user') setInvalid(null) }} />
          {invalid === 'user' ? <p className="ui-field__error" id={panelId + '-user-error'}>{userError}</p> : null}
        </FormField>
        <FormField label={text('Report attribution', 'ربط التقرير بمستخدم')} htmlFor={panelId + '-attribution'}>
          <Select id={panelId + '-attribution'} value={attribution ?? ''}
            onChange={(event) => setAttribution((event.target.value || undefined) as AppliedDiagnosticFilters['attribution'])}>
            <option value="">{text('Any attribution', 'الكل')}</option>
            <option value="verified">{attributionLabels.verified}</option>
            <option value="unattributed">{attributionLabels.unattributed}</option>
          </Select>
        </FormField>
      </div>
    </form>
    {hasPending && !invalid ? <p className="diagnostic-filters__pending secondary">{text('Changes not applied', 'التغييرات غير مطبّقة')}</p> : null}
    {hasApplied ? <div className="diagnostic-filters__applied">
      <div className="diagnostic-filters__values" role="status" aria-label={text('Applied filters', 'الفلاتر المطبّقة')}>
        {applied.search ? <Badge>{text('Search:', 'البحث:')}&nbsp;<bdi>{applied.search}</bdi></Badge> : null}
        {applied.user ? <Badge>{text('User:', 'المستخدم:')}&nbsp;<bdi>{applied.user}</bdi></Badge> : null}
        {applied.attribution ? <Badge>{attributionLabels[applied.attribution]}</Badge> : null}
      </div>
      <Button size="sm" type="button" variant="text" onClick={() => {
        setSearch('')
        setUser('')
        setAttribution(undefined)
        setInvalid(null)
        setExpanded(false)
        onApply({})
        searchInput.current?.focus()
      }}>{text('Clear filters', 'مسح الفلاتر')}</Button>
    </div> : null}
  </div>
}
