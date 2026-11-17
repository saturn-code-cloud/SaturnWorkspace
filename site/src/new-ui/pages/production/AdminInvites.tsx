import { useCallback, useRef, useState, type FormEvent } from 'react'
import { ArrowLeft, Copy, Plus, RefreshCcw } from 'lucide-react'
import type { AdminInviteCode, AdminInviteUsage } from '../../../api/admin'
import { parseServiceTimestamp } from '../../../lib/serviceTimestamp'
import { useAdapters } from '../../adapters/AdapterProvider'
import { useExperience } from '../../app/ExperienceProvider'
import { useAdminNavigationProtection } from '../../app/adminNavigationProtection'
import type { AppRoute, Navigate } from '../../app/routes'
import { Button } from '../../components/ui/Button'
import { Pagination, type Column } from '../../components/ui/DataDisplay'
import { AdminDataTable } from './AdminDataTable'
import { Alert, Badge } from '../../components/ui/Feedback'
import { FormField, Input, SearchInput, Select, Textarea } from '../../components/ui/FormControls'
import { Modal } from '../../components/ui/Overlays'
import { useAsyncData } from '../../hooks/useAsyncData'
import { adminPolicyTab } from './adminPolicyTabs'

type Locale = 'ar' | 'en'
const text = (locale: Locale, en: string, ar: string) => locale === 'ar' ? ar : en
const STATES = { active: ['Available', 'متاح'], expired: ['Expired', 'منتهي'], exhausted: ['Usage limit reached', 'اكتمل الاستخدام'], revoked: ['Revoked', 'ملغى'], blocked: ['Blocked', 'محظور'] } as const
function stateLabel(row: AdminInviteCode, locale: Locale) { return STATES[row.effective_status || 'blocked'][locale === 'ar' ? 1 : 0] }
function badge(row: AdminInviteCode, locale: Locale) { return <Badge tone={row.effective_status === 'active' ? 'success' : row.effective_status === 'revoked' || row.effective_status === 'blocked' ? 'neutral' : 'warning'}>{stateLabel(row, locale)}</Badge> }
function date(value: string | null | undefined, locale: Locale) { const parsed = parseServiceTimestamp(value); return !value ? text(locale, 'No expiry', 'بلا انتهاء') : parsed ? new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed) : '—' }
const pageNumber = (value: string | null) => /^\d+$/.test(value || '') && Number(value) >= 1 && Number(value) <= 5000 ? Number(value) : 1
function failureText(error: string, locale: Locale) {
  const messages: Record<string, [string, string]> = {
    invalid_expiry: ['Choose a future expiry date and time.', 'اختر تاريخ ووقت انتهاء في المستقبل.'],
    invalid_max_uses: ['Enter a whole number from 1 to 100,000.', 'أدخل عددًا صحيحًا من 1 إلى 100,000.'],
    invalid_invite_restrictions: ['Check the restrictions. Use one value per line and a valid email address.', 'راجع القيود. اكتب قيمة واحدة في كل سطر وبريدًا إلكترونيًا صالحًا.'],
    invite_request_conflict: ['This request was already used with different values. Refresh the invitations before creating another.', 'استُخدم هذا الطلب بقيم مختلفة. حدّث الدعوات قبل إنشاء دعوة أخرى.'],
    invite_draft_storage_unavailable: ['Your browser could not preserve this request. Allow session storage before creating an invitation.', 'تعذّر حفظ الطلب في هذا التبويب. اسمح بالتخزين المؤقت للمتصفح قبل إنشاء الدعوة.'],
  }
  return messages[error]?.[locale === 'ar' ? 1 : 0] || text(locale, 'The result could not be confirmed. Retry the same request to check it without creating another invitation.', 'لم يتأكد تنفيذ الطلب. أعد المحاولة بنفس الطلب للتحقق منه دون إنشاء دعوة إضافية.')
}
type Draft = { requestId: string; expiry: string; maxUses: string; note: string; onePerUser: boolean; onePerDevice: boolean; channels: string; versions: string; emails: string; users: string; devices: string; installs: string }
const defaultInviteFields: Omit<Draft, 'requestId'> = { expiry: '', maxUses: '1', note: '', onePerUser: true, onePerDevice: false, channels: '', versions: '', emails: '', users: '', devices: '', installs: '' }
const emptyDraft = (): Draft => ({ requestId: crypto.randomUUID(), ...defaultInviteFields })
const retainInviteDraft = (route: AppRoute) => adminPolicyTab(route.state) === 'invites'
const DRAFT_KEY = 'saturnws.admin.invite.pending.v1:'
function restorePending(owner: string): Draft | null {
  try {
    const key = DRAFT_KEY + owner
    for (const stored of Object.keys(sessionStorage)) if (stored.startsWith(DRAFT_KEY) && stored !== key) sessionStorage.removeItem(stored)
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw); const draft = parsed.draft
    const shape = emptyDraft()
    if (parsed.version !== 1 || !Number.isFinite(parsed.expires) || parsed.expires <= Date.now() || !draft || Object.keys(draft).length !== Object.keys(shape).length ||
        !Object.entries(shape).every(([field, value]) => typeof draft[field] === typeof value) || !/^[A-Za-z0-9_-]{8,160}$/.test(draft.requestId) || raw.length > 70000) { sessionStorage.removeItem(key); return null }
    return draft
  } catch { return null }
}
function rememberPending(owner: string, draft: Draft) {
  sessionStorage.setItem(DRAFT_KEY + owner, JSON.stringify({ version: 1, expires: Date.now() + 24 * 60 * 60 * 1000, draft }))
}
function clearPending(owner: string) { try { sessionStorage.removeItem(DRAFT_KEY + owner) } catch { /* The confirmed result remains visible even if storage is unavailable. */ } }

export function AdminInvites({ canManage, owner, routeState, navigate }: { canManage: boolean; owner: string; routeState?: string; navigate: Navigate }) {
  const params = new URLSearchParams(routeState || '')
  const selected = params.get('invite') || ''
  const [recovered] = useState(() => restorePending(owner))
  const [creating, setCreating] = useState(Boolean(recovered))
  const [draft, setDraft] = useState<Draft>(() => recovered || emptyDraft())
  const change = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params); next.set('tab', 'invites')
    for (const [key, value] of Object.entries(changes)) { if (value) next.set(key, value); else next.delete(key) }
    navigate({ surface: 'admin', page: 'policies', state: '?' + next }, { preserveScroll: true })
  }
  return <section className="admin-invites">
    {selected ? <InviteDetail key={selected} id={selected} page={pageNumber(params.get('usage_page'))} canManage={canManage} onBack={() => change({ invite: null, usage_page: null })} onPage={(page) => change({ usage_page: String(page) })} /> :
      <InviteDirectory canManage={canManage} query={params.get('invite_query') || ''} status={Object.hasOwn(STATES, params.get('invite_status') || '') ? params.get('invite_status') || '' : ''} page={pageNumber(params.get('invite_page'))} onCreate={() => setCreating(true)} onChange={change} />}
    <InviteCreate canManage={canManage} open={canManage && creating} owner={owner} recovered={Boolean(recovered)} draft={draft} onDraft={setDraft} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setDraft(emptyDraft()); change({ invite: id, usage_page: null }) }} />
  </section>
}

function InviteDirectory({ canManage, query, status, page, onCreate, onChange }: { canManage: boolean; query: string; status: string; page: number; onCreate: () => void; onChange: (changes: Record<string, string | null>) => void }) {
  const { admin } = useAdapters(); const { locale } = useExperience()
  const resource = useAsyncData((signal) => admin.listInviteDirectory({ query, status, page }, signal), [admin, query, status, page], JSON.stringify([query, status, page]))
  const columns: Column<AdminInviteCode>[] = [
    { key: 'invitation', header: text(locale, 'Invitation', 'الدعوة'), render: (row) => <div className="invite-name"><strong>{row.note || text(locale, 'Untitled invitation', 'دعوة بلا اسم')}</strong><small dir="ltr">{row.id}</small></div> },
    { key: 'status', header: text(locale, 'Status', 'الحالة'), render: (row) => badge(row, locale) },
    { key: 'usage', header: text(locale, 'Uses / limit', 'الاستخدام / الحد'), render: (row) => <bdi dir="ltr">{row.used_count} / {row.max_uses && row.max_uses > 0 ? row.max_uses : text(locale, 'Unlimited', 'بلا حد')}</bdi> },
    { key: 'expiry', header: text(locale, 'Expiry', 'الانتهاء'), render: (row) => date(row.expires_at, locale) },
    { key: 'details', narrow: 'action' as const, header: text(locale, 'Details', 'التفاصيل'), render: (row) => <Button size="sm" onClick={() => onChange({ invite: row.id, usage_page: null })}>{text(locale, 'View usage', 'عرض الاستخدام')}</Button> },
  ]
  return <>
    <form key={JSON.stringify([query, status])} className="promo-filters" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); onChange({ invite_query: String(form.get('query') || '').trim() || null, invite_status: String(form.get('status') || '') || null, invite_page: null }) }}>
      <SearchInput name="query" label={text(locale, 'Search invitations', 'البحث في الدعوات')} placeholder={text(locale, 'Name or invitation ID', 'الاسم أو معرّف الدعوة')} defaultValue={query} maxLength={100} />
      <Select name="status" defaultValue={status} aria-label={text(locale, 'Invitation status', 'حالة الدعوة')}><option value="">{text(locale, 'All statuses', 'كل الحالات')}</option>{Object.entries(STATES).map(([key, labels]) => <option key={key} value={key}>{labels[locale === 'ar' ? 1 : 0]}</option>)}</Select>
      <Button type="submit">{text(locale, 'Search', 'بحث')}</Button>{query || status ? <Button type="button" variant="ghost" onClick={() => onChange({ invite_query: null, invite_status: null, invite_page: null })}>{text(locale, 'Clear', 'مسح')}</Button> : null}
      <Button type="button" leadingIcon={<RefreshCcw size={14} />} onClick={resource.reload} disabled={resource.loading || resource.refreshing}>{text(locale, 'Refresh', 'تحديث')}</Button>
      {canManage ? <Button type="button" variant="primary" leadingIcon={<Plus size={14} />} onClick={onCreate}>{text(locale, 'Create invitation', 'إنشاء دعوة')}</Button> : null}
    </form>
    {resource.error ? <Alert tone="warning" title={text(locale, resource.data ? 'Refresh failed. Showing the previous invitations.' : 'Invitations could not be loaded.', resource.data ? 'تعذّر التحديث. المعروض هو الدعوات السابقة.' : 'تعذّر تحميل الدعوات.')} action={<Button onClick={resource.reload}>{text(locale, 'Try again', 'إعادة المحاولة')}</Button>} /> : null}
    {resource.data || !resource.error ? <div aria-busy={resource.loading || resource.refreshing}><AdminDataTable columns={columns} rows={resource.data?.items || []} rowKey={(row) => row.id} loading={resource.loading} emptyTitle={text(locale, 'No matching invitations', 'لا توجد دعوات مطابقة')} emptyBody={query || status ? text(locale, 'Try another search or status.', 'جرّب بحثًا أو حالة أخرى.') : text(locale, 'Create an invitation when access by code is required.', 'أنشئ دعوة عند الحاجة إلى وصول بكود.')} /></div> : null}
    {resource.data ? <Pagination page={page} hasNext={resource.data.has_more} disabled={resource.loading || resource.refreshing} onChange={(next) => onChange({ invite_page: String(next) })} label={text(locale, 'Invitations page', 'صفحة الدعوات')} previousLabel={text(locale, 'Previous', 'السابق')} nextLabel={text(locale, 'Next', 'التالي')} /> : null}
  </>
}

function InviteDetail({ id, page, canManage, onBack, onPage }: { id: string; page: number; canManage: boolean; onBack: () => void; onPage: (page: number) => void }) {
  const { admin } = useAdapters(); const { locale } = useExperience()
  const resource = useAsyncData((signal) => admin.getInviteDetail(id, page, signal), [admin, id, page], JSON.stringify([id, page]))
  const [revoking, setRevoking] = useState(false); const [reason, setReason] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const pending = useRef(false)
  const retainRevokeDraft = useCallback((route: AppRoute) => retainInviteDraft(route) && new URLSearchParams(route.state).get('invite') === id, [id])
  const confirmRevokeClose = useAdminNavigationProtection('policies', canManage && revoking ? busy ? 'saving' : reason.trim() ? 'draft' : null : null, retainRevokeDraft)
  const closeRevoke = () => confirmRevokeClose(() => { setRevoking(false); setReason(''); setError('') })
  const row = resource.data?.item
  const revoke = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!canManage || pending.current || !event.currentTarget.reportValidity() || resource.error || resource.refreshing) return
    pending.current = true; setBusy(true); setError('')
    try { await admin.revokeInvite(id, reason.trim()); setRevoking(false); setReason(''); resource.reload() }
    catch { setError(text(locale, 'Revocation could not be confirmed. Refresh this invitation before trying again.', 'لم يتأكد إلغاء الدعوة. حدّثها قبل المحاولة مرة أخرى.')); setRevoking(false); resource.reload() }
    finally { pending.current = false; setBusy(false) }
  }
  const resultLabel = (result: string) => ({ valid: text(locale, 'Accepted', 'مقبول'), invalid: text(locale, 'Invalid code', 'كود غير صالح'), expired: text(locale, 'Expired', 'منتهي'), already_used: text(locale, 'Already used or limit reached', 'مستخدم مسبقًا أو اكتمل الحد'), blocked: text(locale, 'Not permitted', 'غير مسموح'), policy_unavailable: text(locale, 'Verification unavailable', 'التحقق غير متاح') }[result] || result)
  const columns: Column<AdminInviteUsage>[] = [
    { key: 'user', header: text(locale, 'User', 'المستخدم'), render: (item) => <bdi>{item.email || item.user_id || '—'}</bdi> },
    { key: 'result', header: text(locale, 'Result', 'النتيجة'), render: (item) => <Badge tone={item.result === 'valid' ? 'success' : 'warning'}>{resultLabel(item.result)}</Badge> },
    { key: 'app', header: text(locale, 'Version / channel', 'الإصدار / القناة'), render: (item) => <bdi>{[item.app_version, item.channel].filter(Boolean).join(' · ') || '—'}</bdi> },
    { key: 'device', header: text(locale, 'Device', 'الجهاز'), render: (item) => <bdi>{item.device_id || item.install_id || '—'}</bdi> },
    { key: 'date', header: text(locale, 'Time', 'الوقت'), render: (item) => date(item.created_at, locale) },
  ]
  const restrictions = row?.restrictions; const scope = row?.scope
  const limits = [
    [text(locale, 'Channels', 'القنوات'), scope?.channels], [text(locale, 'App versions', 'إصدارات الأداة'), scope?.app_versions],
    [text(locale, 'Emails', 'البريد'), restrictions?.emails], [text(locale, 'Users', 'المستخدمون'), restrictions?.user_ids],
    [text(locale, 'Devices', 'الأجهزة'), restrictions?.device_ids], [text(locale, 'Installations', 'التثبيتات'), restrictions?.install_ids],
  ] as Array<[string, string[] | undefined]>
  return <>
    <div className="split"><Button variant="ghost" leadingIcon={<ArrowLeft size={14} />} onClick={onBack}>{text(locale, 'Back to invitations', 'العودة للدعوات')}</Button><Button disabled={resource.loading || resource.refreshing || busy} onClick={resource.reload} leadingIcon={<RefreshCcw size={14} />}>{text(locale, 'Refresh', 'تحديث')}</Button></div>
    {resource.error ? <Alert tone="warning" title={text(locale, row ? 'Refresh failed. Showing the previous details.' : 'This invitation could not be loaded.', row ? 'تعذّر التحديث. المعروض هو التفاصيل السابقة.' : 'تعذّر تحميل هذه الدعوة.')} action={<Button onClick={resource.reload}>{text(locale, 'Try again', 'إعادة المحاولة')}</Button>} /> : null}
    {error ? <Alert tone="warning" title={error} /> : null}
    {row ? <>
      <header className="split"><div><h2>{row.note || text(locale, 'Invitation details', 'تفاصيل الدعوة')}</h2><p className="secondary" dir="ltr">{row.id}</p></div><div className="cluster">{badge(row, locale)}{canManage && ['active', 'enabled'].includes(row.status) ? <Button variant="danger" disabled={Boolean(resource.error) || resource.refreshing || busy} onClick={() => { setError(''); setRevoking(true) }}>{text(locale, 'Revoke invitation', 'إلغاء الدعوة')}</Button> : null}</div></header>
      <dl className="admin-record-summary">
        <div><dt>{text(locale, 'Uses / limit', 'الاستخدام / الحد')}</dt><dd><bdi dir="ltr">{row.used_count} / {row.max_uses && row.max_uses > 0 ? row.max_uses : text(locale, 'Unlimited', 'بلا حد')}</bdi></dd></div>
        <div><dt>{text(locale, 'Expiry', 'الانتهاء')}</dt><dd>{date(row.expires_at, locale)}</dd></div>
        <div><dt>{text(locale, 'Created', 'الإنشاء')}</dt><dd>{date(row.created_at, locale)}</dd></div>
        <div><dt>{text(locale, 'Created by', 'أنشأها')}</dt><dd><bdi>{row.created_by || '—'}</bdi></dd></div>
      </dl>
      <details className="invite-restrictions"><summary>{text(locale, 'Access restrictions', 'قيود الوصول')}</summary><dl className="detail-list"><div><dt>{text(locale, 'One use per user', 'استخدام واحد لكل مستخدم')}</dt><dd>{restrictions?.one_per_user ? text(locale, 'Yes', 'نعم') : text(locale, 'No', 'لا')}</dd></div><div><dt>{text(locale, 'One use per device', 'استخدام واحد لكل جهاز')}</dt><dd>{restrictions?.one_per_device ? text(locale, 'Yes', 'نعم') : text(locale, 'No', 'لا')}</dd></div>{limits.map(([label, values]) => <div key={label}><dt>{label}</dt><dd dir="auto">{values?.length ? values.join(', ') : text(locale, 'Unrestricted', 'بلا قيد')}</dd></div>)}</dl></details>
      {row.revoked_at ? <Alert title={text(locale, 'Invitation revoked', 'الدعوة ملغاة')}>{date(row.revoked_at, locale)} · <bdi>{row.revoked_by || '—'}</bdi>{row.revoke_reason ? <p>{row.revoke_reason}</p> : null}</Alert> : null}
    </> : null}
    {row || !resource.error ? <section aria-busy={resource.loading || resource.refreshing}><h3>{text(locale, 'Validation history', 'سجل التحقق')}</h3><p className="secondary">{text(locale, 'Recorded attempts, including rejected attempts. The successful-use count above is separate.', 'المحاولات المسجّلة، بما فيها المحاولات المرفوضة. عدد الاستخدامات الناجحة ظاهر بالأعلى.')} </p><AdminDataTable columns={columns} rows={resource.data?.items || []} loading={resource.loading} rowKey={(item) => item.id} emptyTitle={text(locale, 'No recorded attempts', 'لا توجد محاولات مسجّلة')} emptyBody={text(locale, 'Attempts to validate this invitation will appear here.', 'ستظهر هنا محاولات التحقق من هذه الدعوة.')} /></section> : null}
    {resource.data ? <Pagination page={page} hasNext={resource.data.has_more} disabled={resource.loading || resource.refreshing} onChange={onPage} label={text(locale, 'History page', 'صفحة السجل')} previousLabel={text(locale, 'Previous', 'السابق')} nextLabel={text(locale, 'Next', 'التالي')} /> : null}
    <Modal open={canManage && revoking} onClose={closeRevoke} closeDisabled={busy} title={text(locale, 'Revoke invitation', 'إلغاء الدعوة')} closeLabel={text(locale, 'Close', 'إغلاق')} footer={<><Button disabled={busy} onClick={closeRevoke}>{text(locale, 'Cancel', 'رجوع')}</Button><Button form="invite-revoke" type="submit" variant="danger" loading={busy}>{text(locale, 'Revoke invitation', 'إلغاء الدعوة')}</Button></>}>
      <form id="invite-revoke" className="settings-form" onSubmit={revoke}><p>{text(locale, 'The code will no longer accept new uses. Previous successful uses are not reversed.', 'لن يقبل الكود استخدامات جديدة. الاستخدامات الناجحة السابقة لن تتراجع.')}</p><FormField label={text(locale, 'Reason', 'السبب')} htmlFor="invite-reason" required><Textarea id="invite-reason" value={reason} onChange={(event) => setReason(event.target.value)} required minLength={3} maxLength={1000} disabled={busy} /></FormField></form>
    </Modal>
  </>
}

function InviteCreate({ canManage, open, owner, recovered, draft, onDraft, onClose, onCreated }: { canManage: boolean; open: boolean; owner: string; recovered: boolean; draft: Draft; onDraft: (value: Draft) => void; onClose: () => void; onCreated: (id: string) => void }) {
  const { admin } = useAdapters(); const { locale } = useExperience()
  const [busy, setBusy] = useState(false); const pending = useRef(false); const [error, setError] = useState(recovered ? 'invite_write_unconfirmed' : ''); const [locked, setLocked] = useState(recovered)
  const [saved, setSaved] = useState<{ id: string; code: string | null } | null>(null)
  const [copyError, setCopyError] = useState(false)
  const [copied, setCopied] = useState(false)
  const hasDraft = !locked && !saved && Object.entries(defaultInviteFields).some(([field, value]) => draft[field as keyof Draft] !== value)
  const confirmCodeClose = useAdminNavigationProtection('policies', !canManage ? null : busy ? 'saving' : saved?.code && !copied ? 'invite-code' : hasDraft ? 'draft' : null, retainInviteDraft)
  const change = (key: keyof Draft, value: string | boolean) => { onDraft({ ...draft, [key]: value }); setError('') }
  const lines = (value: string) => value.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean)
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (pending.current || saved || !event.currentTarget.reportValidity()) return
    pending.current = true; setBusy(true); setLocked(true); setError('')
    try {
      try { rememberPending(owner, draft) } catch { throw new Error('invite_draft_storage_unavailable') }
      const result = await admin.createInvite({ request_id: draft.requestId, expires_at: draft.expiry ? new Date(draft.expiry).toISOString() : undefined, max_uses: draft.maxUses ? Number(draft.maxUses) : undefined, note: draft.note,
        scope: { channels: lines(draft.channels), app_versions: lines(draft.versions) }, restrictions: { one_per_user: draft.onePerUser, one_per_device: draft.onePerDevice, emails: lines(draft.emails), user_ids: lines(draft.users), device_ids: lines(draft.devices), install_ids: lines(draft.installs) } })
      setSaved({ id: result.item.id, code: result.code })
      clearPending(owner)
    } catch (failure) { const message = failure instanceof Error ? failure.message : 'invite_write_unconfirmed'; setError(message); if (['invalid_expiry', 'invalid_max_uses', 'invalid_invite_request', 'invalid_invite_restrictions', 'invalid_invite_note', 'request_id_required', 'invite_draft_storage_unavailable'].includes(message)) { setLocked(false); clearPending(owner) } }
    finally { pending.current = false; setBusy(false) }
  }
  const close = () => {
    if (pending.current) return
    if (!saved) { onClose(); return }
    const id = saved.id
    confirmCodeClose(() => {
      setSaved(null); setLocked(false); setError(''); setCopyError(false); setCopied(false); onCreated(id)
    })
  }
  const copy = async () => {
    if (!saved?.code) return
    try { await navigator.clipboard.writeText(saved.code); setCopied(true); setCopyError(false) }
    catch { setCopyError(true) }
  }
  const restricted = busy || locked || Boolean(saved)
  return <Modal open={open} onClose={close} closeDisabled={busy} title={text(locale, saved ? 'Invitation created' : 'Create invitation', saved ? 'تم إنشاء الدعوة' : 'إنشاء دعوة')} closeLabel={text(locale, 'Close', 'إغلاق')} footer={saved ? <Button variant="primary" onClick={close}>{text(locale, 'View invitation', 'عرض الدعوة')}</Button> : <><Button disabled={busy} onClick={close}>{text(locale, 'Close', 'إغلاق')}</Button><Button variant="primary" type="submit" form="invite-create" loading={busy}>{text(locale, locked ? 'Retry same request' : 'Create invitation', locked ? 'إعادة المحاولة بنفس الطلب' : 'إنشاء الدعوة')}</Button></>}>
    {saved ? <div className="settings-form">{saved.code ? <><p>{text(locale, 'Copy the code before closing. It cannot be retrieved later.', 'انسخ الكود قبل الإغلاق. لن يمكن عرضه مرة أخرى.')}</p><div className="invite-secret" dir="ltr"><code onCopy={() => { if (window.getSelection()?.toString() === saved.code) { setCopied(true); setCopyError(false) } }}>{saved.code}</code><Button leadingIcon={<Copy size={14} />} onClick={() => { void copy() }}><span aria-live="polite">{copied ? text(locale, 'Code copied', 'تم نسخ الكود') : text(locale, 'Copy code', 'نسخ الكود')}</span></Button></div>{copyError ? <Alert tone="warning" title={text(locale, 'Select the code and copy it manually.', 'حدد الكود وانسخه يدويًا.')} /> : null}</> : <Alert tone="warning" title={text(locale, 'This request already created an invitation.', 'سبق إنشاء دعوة بهذا الطلب.')}>{text(locale, 'Its code is no longer available. Open the invitation to review it or revoke it before creating a replacement.', 'الكود لم يعد متاحًا للعرض. افتح الدعوة لمراجعتها أو إلغائها قبل إنشاء بديل.')}</Alert>}</div> :
      <form id="invite-create" className="settings-form" onSubmit={create}>
        <FormField label={text(locale, 'Internal name or note', 'اسم أو ملاحظة داخلية')} htmlFor="invite-note"><Textarea id="invite-note" value={draft.note} onChange={(event) => change('note', event.target.value)} maxLength={1000} disabled={restricted} /></FormField>
        <div className="form-grid"><FormField label={text(locale, 'Maximum uses', 'حد الاستخدام')} htmlFor="invite-max" helper={text(locale, 'Leave empty for unlimited uses.', 'اتركه فارغًا للاستخدام بلا حد.')}><Input id="invite-max" type="number" min="1" max="100000" step="1" value={draft.maxUses} onChange={(event) => change('maxUses', event.target.value)} disabled={restricted} /></FormField><FormField label={text(locale, 'Expiry', 'الانتهاء')} htmlFor="invite-expiry" helper={text(locale, 'Local time. Empty means no expiry.', 'بتوقيت جهازك. فارغ يعني بلا انتهاء.')}><Input id="invite-expiry" type="datetime-local" value={draft.expiry} onChange={(event) => change('expiry', event.target.value)} disabled={restricted} /></FormField></div>
        <label className="ui-check"><input type="checkbox" checked={draft.onePerUser} disabled={restricted} onChange={(event) => change('onePerUser', event.target.checked)} /><span>{text(locale, 'One successful use per user', 'استخدام ناجح واحد لكل مستخدم')}</span></label>
        <label className="ui-check"><input type="checkbox" checked={draft.onePerDevice} disabled={restricted} onChange={(event) => change('onePerDevice', event.target.checked)} /><span>{text(locale, 'One successful use per device', 'استخدام ناجح واحد لكل جهاز')}</span></label>
        <details className="invite-restrictions"><summary>{text(locale, 'Restrict access', 'تقييد الوصول')}</summary><p className="secondary">{text(locale, 'Optional. One value per line. All non-empty groups must match; any listed value within a group is allowed.', 'اختياري. قيمة واحدة في كل سطر. يجب مطابقة كل مجموعة غير فارغة، ويكفي أي قيمة من قيم المجموعة.')}</p>{([
          ['channels', 'Channels (up to 20)', 'القنوات (حتى 20)'], ['versions', 'App versions (up to 50)', 'إصدارات الأداة (حتى 50)'], ['emails', 'Emails (up to 100)', 'البريد (حتى 100)'], ['users', 'User IDs (up to 100)', 'معرّفات المستخدمين (حتى 100)'], ['devices', 'Device IDs (up to 100)', 'معرّفات الأجهزة (حتى 100)'], ['installs', 'Installation IDs (up to 100)', 'معرّفات التثبيت (حتى 100)'],
        ] as const).map(([key, en, ar]) => <FormField key={key} label={text(locale, en, ar)} htmlFor={'invite-' + key}><Textarea id={'invite-' + key} value={draft[key]} disabled={restricted} maxLength={key === 'channels' ? 1620 : key === 'versions' ? 4050 : key === 'emails' ? 25500 : 16100} onChange={(event) => change(key, event.target.value)} dir="auto" /></FormField>)}</details>
        {error ? <Alert tone="warning" title={failureText(error, locale)} /> : null}
      </form>}
  </Modal>
}
