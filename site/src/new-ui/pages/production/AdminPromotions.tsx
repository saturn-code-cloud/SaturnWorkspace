import { useRef, useState, type FormEvent } from 'react'
import { Copy, Plus, RefreshCcw } from 'lucide-react'
import type { AdminPromoCode, AdminPromoStatus } from '../../../api/admin'
import { parseServiceTimestamp } from '../../../lib/serviceTimestamp'
import { useAdapters } from '../../adapters/AdapterProvider'
import { useExperience } from '../../app/ExperienceProvider'
import { useAdminNavigationProtection } from '../../app/adminNavigationProtection'
import type { Navigate } from '../../app/routes'
import { Button, IconButton } from '../../components/ui/Button'
import { PageHeader, Pagination, type Column } from '../../components/ui/DataDisplay'
import { AdminDataTable } from './AdminDataTable'
import { Alert, Badge } from '../../components/ui/Feedback'
import { FormField, Input, SearchInput, Select } from '../../components/ui/FormControls'
import { Modal } from '../../components/ui/Overlays'
import { useAsyncData } from '../../hooks/useAsyncData'

const text = (locale: 'ar' | 'en', en: string, ar: string) => locale === 'ar' ? ar : en
const STATUS: Record<AdminPromoStatus, [string, string]> = { active: ['Active', 'صالح'], paused: ['Paused', 'متوقف'], scheduled: ['Scheduled', 'مجدول'], expired: ['Expired', 'منتهي'], exhausted: ['Usage limit reached', 'اكتمل الاستخدام'] }
type PromoDraft = { code: string; title: string; kind: 'percent' | 'fixed'; value: string; maxUses: string; expiry: string }
const emptyDraft = (): PromoDraft => ({ code: '', title: '', kind: 'percent', value: '', maxUses: '', expiry: '' })
function formatDate(value: string | null | undefined, locale: 'ar' | 'en') {
  if (!value) return text(locale, 'No expiry', 'بلا انتهاء')
  const parsed = parseServiceTimestamp(value)
  return parsed ? new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed) : '—'
}
function benefit(row: AdminPromoCode, locale: 'ar' | 'en') {
  if (row.is_private_tier_trigger) return text(locale, 'Private access', 'وصول خاص')
  if (row.discount_type === 'percent') return new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-US', { style: 'percent', maximumFractionDigits: 2 }).format(row.discount_value / 100)
  try { return new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-US', { style: 'currency', currency: row.currency || 'USD' }).format(row.discount_value) }
  catch { return `${row.discount_value} ${row.currency || 'USD'}` }
}
function stateText(status: AdminPromoStatus, locale: 'ar' | 'en') { return STATUS[status]?.[locale === 'ar' ? 1 : 0] || text(locale, 'Unknown', 'غير معروف') }

export function AdminPromotions({ canManage, routeState, navigate }: { canManage: boolean; routeState?: string; navigate: Navigate }) {
  const { admin } = useAdapters()
  const { locale } = useExperience()
  const params = new URLSearchParams(routeState || '')
  const query = params.get('query') || ''
  const status = Object.hasOwn(STATUS, params.get('status') || '') ? params.get('status') as AdminPromoStatus : ''
  const rawPage = Number(params.get('page') || 1)
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 && rawPage <= 5000 ? rawPage : 1
  const resource = useAsyncData((signal) => admin.listPromoDirectory({ query, status, page }, signal), [admin, query, status, page], JSON.stringify([query, status, page]))
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<PromoDraft>(emptyDraft)
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const [error, setError] = useState('')
  const [undo, setUndo] = useState<{ row: AdminPromoCode; previous: boolean } | null>(null)
  const [createdCode, setCreatedCode] = useState('')
  const hasDraft = Boolean(draft.code.trim() || draft.title.trim() || draft.kind !== 'percent' || draft.value || draft.maxUses || draft.expiry)
  useAdminNavigationProtection('promos', canManage ? busy ? 'saving' : hasDraft ? 'draft' : null : null)
  const change = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) { if (value) next.set(key, value); else next.delete(key) }
    navigate({ surface: 'admin', page: 'promos', state: '?' + next }, { preserveScroll: true })
  }
  const setActive = async (row: AdminPromoCode, active: boolean, reversing = false) => {
    if (!canManage || pending.current || !row.updated_at || resource.error || resource.loading || resource.refreshing) return
    pending.current = true; setBusy(true); setError('')
    try {
      const result = await admin.updatePromoCodeState(row.id, active, reversing ? 'Previous state restored by administrator' : active ? 'Activated by administrator' : 'Paused by administrator', row.updated_at)
      setUndo(reversing ? null : { row: result, previous: row.is_active }); resource.reload()
    } catch (failure) {
      setError(String(failure).includes('promo_code_changed') ? text(locale, 'The code changed since it was loaded. Refresh it before trying again.', 'تغيّر الكود منذ تحميله. حدّث البيانات قبل المحاولة مرة أخرى.') : text(locale, 'The change could not be confirmed. Refresh the codes to check their current state.', 'لم يتأكد حفظ التغيير. حدّث الأكواد لمعرفة حالتها الحالية.'))
      setUndo(null); resource.reload()
    } finally { pending.current = false; setBusy(false) }
  }
  const columns: Column<AdminPromoCode>[] = [
    { key: 'code', header: text(locale, 'Code', 'الكود'), render: (row) => <div className="promo-code-cell"><span className="promo-code-value" dir="auto">{row.code}</span><IconButton label={text(locale, `Copy code ${row.code}`, `نسخ الكود ${row.code}`)} size="sm" onClick={async () => { try { await navigator.clipboard.writeText(row.code) } catch { setError(text(locale, 'Clipboard access was blocked. Select the code and copy it manually.', 'تعذّر النسخ. حدد نص الكود وانسخه يدويًا.')) } }}><Copy size={14} /></IconButton>{row.title ? <small>{row.title}</small> : null}</div> },
    { key: 'discount', header: text(locale, 'Benefit', 'الخصم أو الميزة'), render: (row) => benefit(row, locale) },
    { key: 'status', header: text(locale, 'Status', 'الحالة'), render: (row) => <Badge tone={row.effective_status === 'active' ? 'success' : row.effective_status === 'scheduled' ? 'info' : row.effective_status === 'paused' ? 'neutral' : 'warning'}>{stateText(row.effective_status!, locale)}</Badge> },
    { key: 'usage', header: text(locale, 'Uses / limit', 'الاستخدام / الحد'), render: (row) => <bdi dir="ltr">{row.used_count ?? '—'} / {row.max_uses === null ? text(locale, 'Unlimited', 'بلا حد') : row.max_uses ?? '—'}</bdi> },
    { key: 'expiry', header: text(locale, 'Expiry', 'الانتهاء'), render: (row) => formatDate(row.expires_at, locale) },
    ...(canManage ? [{ key: 'action', narrow: 'action' as const, header: text(locale, 'Action', 'الإجراء'), render: (row: AdminPromoCode) => !row.is_active && ((row.expires_at && Date.parse(row.expires_at) <= Date.now()) || (row.max_uses !== null && row.max_uses !== undefined && (row.used_count ?? 0) >= row.max_uses))
      ? <span className="secondary">{text(locale, 'Expiry or limit reached', 'انتهت الصلاحية أو الحد')}</span>
      : <Button size="sm" disabled={busy || resource.refreshing || Boolean(resource.error)} onClick={() => { void setActive(row, !row.is_active) }}>{row.is_active ? text(locale, 'Pause', 'إيقاف') : text(locale, 'Resume', 'تفعيل')}</Button> }] : []),
  ]
  return <section className="admin-promotions">
    <PageHeader title={text(locale, 'Promotion codes', 'أكواد الخصم')} actions={canManage ? <Button variant="primary" leadingIcon={<Plus size={15} />} disabled={busy} onClick={() => setOpen(true)}>{hasDraft ? text(locale, 'Continue draft', 'متابعة المسودة') : text(locale, 'Create code', 'إنشاء كود')}</Button> : undefined} />
    {!canManage ? <Alert tone="info" title={text(locale, 'View only', 'عرض فقط')}>{text(locale, 'Your role can view codes. Creating or changing them requires permission.', 'صلاحيتك تسمح بعرض الأكواد فقط.')}</Alert> : null}
    <form key={JSON.stringify([query, status])} className="promo-filters" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); change({ query: String(form.get('query') || '').trim() || null, status: String(form.get('status') || '') || null, page: null }) }}>
      <SearchInput name="query" label={text(locale, 'Search codes', 'البحث عن كود')} placeholder={text(locale, 'Search codes', 'البحث عن كود')} defaultValue={query} maxLength={100} />
      <Select name="status" defaultValue={status} aria-label={text(locale, 'Code status', 'حالة الكود')}><option value="">{text(locale, 'All statuses', 'كل الحالات')}</option>{Object.keys(STATUS).map((item) => <option key={item} value={item}>{stateText(item as AdminPromoStatus, locale)}</option>)}</Select>
      <Button type="submit">{text(locale, 'Search', 'بحث')}</Button>{query || status ? <Button type="button" variant="ghost" onClick={() => change({ query: null, status: null, page: null })}>{text(locale, 'Clear', 'مسح')}</Button> : null}
      <Button type="button" onClick={resource.reload} disabled={resource.loading || resource.refreshing} leadingIcon={<RefreshCcw size={14} />}>{text(locale, 'Refresh', 'تحديث')}</Button>
    </form>
    {resource.error ? <Alert tone="warning" title={text(locale, resource.data ? 'Refresh failed. Showing the previous results.' : 'Promotion codes could not be loaded.', resource.data ? 'تعذّر التحديث. المعروض هو النتائج السابقة.' : 'تعذّر تحميل أكواد الخصم.')} action={<Button onClick={resource.reload}>{text(locale, 'Try again', 'إعادة المحاولة')}</Button>} /> : null}
    {error ? <Alert tone="warning" title={error} /> : null}
    {createdCode && query === createdCode ? <Alert tone="success" title={text(locale, 'Code created', 'تم إنشاء الكود')}><bdi>{createdCode}</bdi></Alert> : null}
    {undo ? <Alert title={undo.row.is_active ? text(locale, 'Code resumed.', 'تم تفعيل الكود.') : text(locale, 'Code paused.', 'تم إيقاف الكود.')} action={<Button disabled={busy || resource.refreshing || Boolean(resource.error)} onClick={() => { void setActive(undo.row, undo.previous, true) }}>{text(locale, 'Undo', 'تراجع')}</Button>} /> : null}
    <div aria-busy={resource.loading || resource.refreshing}>
      {resource.data || !resource.error ? <AdminDataTable columns={columns} rows={resource.data?.items || []} loading={resource.loading} rowKey={(row) => row.id} emptyTitle={text(locale, 'No matching codes', 'لا توجد أكواد مطابقة')} emptyBody={query || status ? text(locale, 'Try another search or status.', 'جرّب بحثًا أو حالة أخرى.') : text(locale, 'Created promotion codes will appear here.', 'ستظهر أكواد الخصم المحفوظة هنا.')} /> : null}
    </div>
    {resource.data ? <div className="split"><p className="secondary promo-checked-at">{text(locale, 'Updated', 'آخر تحديث')} {formatDate(resource.data.generated_at, locale)}</p><Pagination page={page} hasNext={resource.data.has_more} disabled={resource.loading || resource.refreshing} onChange={(next) => change({ page: String(next) })} label={text(locale, 'Codes page', 'صفحة الأكواد')} previousLabel={text(locale, 'Previous', 'السابق')} nextLabel={text(locale, 'Next', 'التالي')} /></div> : null}
    <PromoCreate open={canManage && open} draft={draft} onDraft={setDraft} onClose={() => setOpen(false)} onCreated={(row) => { setOpen(false); setDraft(emptyDraft()); setUndo(null); setCreatedCode(row.code); change({ query: row.code, status: null, page: null }); resource.reload() }} onLookup={() => { setOpen(false); change({ query: draft.code.trim(), status: null, page: null }); resource.reload() }} />
  </section>
}

function PromoCreate({ open, draft, onDraft, onClose, onCreated, onLookup }: { open: boolean; draft: PromoDraft; onDraft: (value: PromoDraft) => void; onClose: () => void; onCreated: (row: AdminPromoCode) => void; onLookup: () => void }) {
  const { admin } = useAdapters()
  const { locale } = useExperience()
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const [error, setError] = useState('')
  useAdminNavigationProtection('promos', open && busy ? 'saving' : null)
  const change = (key: keyof PromoDraft, value: string) => { onDraft({ ...draft, [key]: value }); setError('') }
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (pending.current || !event.currentTarget.reportValidity()) return
    pending.current = true; setBusy(true); setError('')
    try {
      onCreated(await admin.createPromoCode({ code: draft.code.trim(), title: draft.title.trim() || undefined, discount_type: draft.kind, discount_value: Number(draft.value), is_private_tier_trigger: false,
        max_uses: draft.maxUses ? Number(draft.maxUses) : undefined, expires_at: draft.expiry ? new Date(draft.expiry).toISOString() : undefined }))
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'promo_save_unconfirmed') }
    finally { pending.current = false; setBusy(false) }
  }
  const messages: Record<string, [string, string]> = {
    promo_code_exists: ['This code already exists. Find it before creating another.', 'الكود موجود بالفعل. ابحث عنه قبل إنشاء كود آخر.'],
    promo_save_unconfirmed: ['Saving could not be confirmed. Find this code to check whether it was saved.', 'لم يتأكد الحفظ. ابحث عن هذا الكود للتأكد إن كان محفوظًا.'],
    invalid_promo_discount: ['Enter a valid discount with up to two decimal places. Percentages cannot exceed 100%.', 'أدخل خصمًا صالحًا بمنزلتين عشريتين بحد أقصى. النسبة لا تتجاوز 100٪.'],
    invalid_promo_expiry: ['Choose a future expiry date and time.', 'اختر تاريخ ووقت انتهاء في المستقبل.'],
    invalid_promo_max_uses: ['Enter a positive whole number for the usage limit.', 'أدخل عددًا صحيحًا موجبًا لحد الاستخدام.'],
  }
  return <Modal open={open} onClose={onClose} closeDisabled={busy} title={text(locale, 'Create promotion code', 'إنشاء كود خصم')} closeLabel={text(locale, 'Close', 'إغلاق')} footer={<><Button disabled={busy} onClick={onClose}>{text(locale, 'Close', 'إغلاق')}</Button><Button type="submit" form="promo-create-form" variant="primary" loading={busy}>{text(locale, 'Create code', 'إنشاء الكود')}</Button></>}>
    <form id="promo-create-form" className="settings-form" onSubmit={save}>
      <p className="secondary">{text(locale, 'Checkout is currently unavailable. Creating a code does not enable payments.', 'الدفع غير متاح حاليًا. إنشاء كود لا يفعّل الدفع.')}</p>
      <FormField label={text(locale, 'Code', 'الكود')} htmlFor="promo-code" required><Input id="promo-code" value={draft.code} onChange={(event) => change('code', event.target.value.toUpperCase())} maxLength={64} required disabled={busy} dir="auto" /></FormField>
      <FormField label={text(locale, 'Internal name', 'اسم داخلي')} htmlFor="promo-title"><Input id="promo-title" value={draft.title} onChange={(event) => change('title', event.target.value)} maxLength={120} disabled={busy} /></FormField>
      <div className="form-grid"><FormField label={text(locale, 'Discount type', 'نوع الخصم')} htmlFor="promo-kind"><Select id="promo-kind" value={draft.kind} disabled={busy} onChange={(event) => change('kind', event.target.value)}><option value="percent">{text(locale, 'Percentage', 'نسبة مئوية')}</option><option value="fixed">{text(locale, 'Fixed amount (USD)', 'مبلغ ثابت (USD)')}</option></Select></FormField>
        <FormField label={text(locale, draft.kind === 'percent' ? 'Percentage' : 'Amount (USD)', draft.kind === 'percent' ? 'النسبة' : 'المبلغ (USD)')} htmlFor="promo-value" required><Input id="promo-value" type="number" min="0.01" max={draft.kind === 'percent' ? 100 : 9999999999.99} step="0.01" value={draft.value} onChange={(event) => change('value', event.target.value)} required disabled={busy} /></FormField></div>
      <FormField label={text(locale, 'Usage limit', 'حد الاستخدام')} htmlFor="promo-max-uses" helper={text(locale, 'Leave empty for unlimited uses.', 'اتركه فارغًا للاستخدام بلا حد.')}><Input id="promo-max-uses" type="number" min="1" max="2147483647" step="1" value={draft.maxUses} onChange={(event) => change('maxUses', event.target.value)} disabled={busy} /></FormField>
      <FormField label={text(locale, 'Expiry', 'الانتهاء')} htmlFor="promo-expiry" helper={text(locale, 'Uses your local time. Leave empty for no expiry.', 'بتوقيت جهازك. اتركه فارغًا ليظل بلا انتهاء.')}><Input id="promo-expiry" type="datetime-local" value={draft.expiry} onChange={(event) => change('expiry', event.target.value)} disabled={busy} /></FormField>
      {error ? <Alert tone="warning" title={messages[error]?.[locale === 'ar' ? 1 : 0] || text(locale, 'The code could not be saved. Check the values and try again.', 'تعذّر حفظ الكود. راجع القيم وحاول مرة أخرى.')} action={['promo_code_exists', 'promo_save_unconfirmed'].includes(error) ? <Button onClick={onLookup}>{text(locale, 'Find this code', 'البحث عن الكود')}</Button> : undefined} /> : null}
    </form>
  </Modal>
}
