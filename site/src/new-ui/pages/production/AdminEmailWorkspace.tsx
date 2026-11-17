import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowLeft, RefreshCcw, Send } from 'lucide-react'
import type { AdminEmailActivityPage, AdminEmailActivityView, AdminEmailCatalogItem, AdminEmailProcessingResult } from '../../../api/admin'
import { parseServiceTimestamp } from '../../../lib/serviceTimestamp'
import { useAdapters } from '../../adapters/AdapterProvider'
import { useExperience } from '../../app/ExperienceProvider'
import { useAdminNavigationProtection } from '../../app/adminNavigationProtection'
import type { AppRoute } from '../../app/routes'
import type { Navigate } from '../../app/routes'
import { Button } from '../../components/ui/Button'
import { Card, PageHeader, Pagination, SectionHeader, Timeline, type Column } from '../../components/ui/DataDisplay'
import { AdminDataTable } from './AdminDataTable'
import { Alert, Badge, SkeletonStack, type Tone } from '../../components/ui/Feedback'
import { FormField, Input, SearchInput, Select } from '../../components/ui/FormControls'
import { Tabs } from '../../components/ui/Navigation'
import { ConfirmDialog } from '../../components/ui/Overlays'
import { RouteLink } from '../../components/ui/RouteLink'
import { useAsyncData } from '../../hooks/useAsyncData'

const VIEWS: AdminEmailActivityView[] = ['outbound', 'inbound', 'scheduled', 'events', 'flags']
const STATUSES: Record<AdminEmailActivityView, string[]> = {
  outbound: ['queued', 'processing', 'sent', 'delivered', 'failed', 'bounced', 'complained', 'suppressed', 'cancelled'],
  inbound: ['received', 'processed', 'rejected'], scheduled: ['scheduled', 'processing', 'queued', 'skipped', 'failed', 'cancelled'],
  events: ['email.sent', 'email.delivered', 'email.delivery_delayed', 'email.bounced', 'email.complained', 'email.failed', 'email.received', 'email.suppressed'],
  flags: ['bounced', 'complained', 'suppressed'],
}
const LABELS: Record<string, [string, string]> = {
  outbound: ['Outbound', 'الصادر'], inbound: ['Inbound', 'الوارد'], scheduled: ['Scheduled', 'المجدول'], events: ['Provider events', 'أحداث المزوّد'], flags: ['Suppressed recipients', 'المستلمون المحظورون'],
  queued: ['Queued', 'في الانتظار'], processing: ['Processing', 'قيد المعالجة'], sent: ['Accepted by provider', 'قبِلها المزوّد'], delivered: ['Delivered to mail server', 'وصلت لخادم البريد'],
  failed: ['Failed', 'فشلت'], bounced: ['Bounced', 'مرتجعة'], complained: ['Spam complaint', 'شكوى بريد مزعج'], suppressed: ['Suppressed', 'محظورة'], cancelled: ['Cancelled', 'ملغاة'],
  received: ['Received', 'مستلمة'], processed: ['Processed', 'تمت المعالجة'], rejected: ['Rejected', 'مرفوضة'], skipped: ['Skipped', 'لم تُرسل'],
  delivery_delayed: ['Delivery delayed', 'تأخر التسليم'], delayed: ['Delivery delayed', 'تأخر التسليم'],
  linked: ['Connected', 'متصل'], prepared: ['Prepared, not connected', 'مجهّز وغير متصل'], disabled: ['Disabled', 'معطّل'], backend_missing: ['Backend unavailable', 'الخادم غير متاح'],
  support: ['Support', 'الدعم'], auth: ['Authentication', 'تسجيل الدخول'], billing: ['Billing', 'الفوترة'], subscription: ['Subscriptions', 'الاشتراكات'], release: ['Releases', 'الإصدارات'], security: ['Security', 'الأمان'],
  general: ['General', 'عام'], account: ['Account', 'الحساب'], admin: ['Administration', 'الإدارة'],
}
const text = (locale: 'ar' | 'en', en: string, ar: string) => locale === 'ar' ? ar : en
const label = (value: string, locale: 'ar' | 'en') => LABELS[value]?.[locale === 'ar' ? 1 : 0] || value
function tone(value: string): Tone {
  const state = value.replace(/^email\./, '')
  return ['delivered', 'processed', 'linked'].includes(state) ? 'success' : ['failed', 'bounced', 'complained', 'rejected', 'suppressed', 'backend_missing'].includes(state) ? 'danger' : ['queued', 'processing', 'scheduled', 'received', 'prepared', 'sent'].includes(state) ? 'info' : 'neutral'
}
function date(value: string | null | undefined, locale: 'ar' | 'en') {
  if (!value) return '—'
  const parsed = parseServiceTimestamp(value)
  return parsed ? new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed) : '—'
}
function processingNotice(result: AdminEmailProcessingResult, locale: 'ar' | 'en'): { title: string; tone: 'info' | 'warning' } {
  if (result.sent) return { tone: 'info', title: text(locale, 'The provider accepted the message. Delivery is not confirmed yet.', 'قبِل المزوّد الرسالة. لم يتأكد وصولها بعد.') }
  if (result.skipped) return { tone: 'info', title: text(locale, 'The message was not sent immediately. Check its current status.', 'لم تُرسل الرسالة فورًا. راجع حالتها الحالية.') }
  return { tone: 'warning', title: text(locale, 'The attempt did not send the message. Check its status and last error.', 'لم تُرسل الرسالة في هذه المحاولة. راجع حالتها وآخر خطأ.') }
}
function EmailReadError({ stale, onRetry }: { stale?: boolean; onRetry: () => void }) {
  const { locale } = useExperience()
  return <Alert tone="warning" title={text(locale, stale ? 'Refresh failed. Showing the previous results.' : 'Email records could not be loaded.', stale ? 'تعذّر التحديث. المعروض هو النتائج السابقة.' : 'تعذّر تحميل سجلات البريد.')} action={<Button onClick={onRetry}>{text(locale, 'Try again', 'إعادة المحاولة')}</Button>} />
}

export function AdminEmailWorkspace({ canManage, routeState, navigate }: { canManage: boolean; routeState?: string; navigate: Navigate }) {
  const { locale } = useExperience()
  const params = new URLSearchParams(routeState || '')
  const section = ['catalog', 'configuration'].includes(params.get('email_section') || '') ? params.get('email_section')! : 'activity'
  const view = VIEWS.includes(params.get('email_view') as AdminEmailActivityView) ? params.get('email_view') as AdminEmailActivityView : 'outbound'
  const query = params.get('email_query') || ''
  const status = params.get('email_status') || ''
  const rawPage = Number(params.get('email_page') || 1)
  const page = Number.isSafeInteger(rawPage) && rawPage >= 1 && rawPage <= 10000 ? rawPage : 1
  const jobId = params.get('email_job') || ''
  const lastLink = useRef<HTMLAnchorElement | null>(null)
  const results = useRef<HTMLDivElement>(null)
  const [revision, setRevision] = useState(0)
  const route = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) { if (value) next.set(key, value); else next.delete(key) }
    return { surface: 'admin' as const, page: 'communications', state: '?' + next }
  }
  const change = (changes: Record<string, string | null>) => navigate(route(changes), { preserveScroll: true })
  const openJob = (id: string): ReactNode => <RouteLink route={route({ email_job: id })} navigate={navigate} aria-current={id === jobId ? 'true' : undefined} onClick={(event) => { lastLink.current = event.currentTarget }}>{text(locale, 'View', 'عرض')}</RouteLink>
  const closeJob = () => {
    change({ email_job: null })
    window.requestAnimationFrame(() => (lastLink.current?.isConnected ? lastLink.current : results.current)?.focus())
  }
  return <section className="email-operations">
    <PageHeader title={text(locale, 'Email operations', 'عمليات البريد')} />
    <Tabs ariaLabel={text(locale, 'Email sections', 'أقسام البريد')} active={section} onChange={(id) => change({ email_section: id === 'activity' ? null : id })} items={[
      { id: 'activity', label: text(locale, 'Message activity', 'متابعة الرسائل') }, { id: 'catalog', label: text(locale, 'Templates', 'القوالب') }, { id: 'configuration', label: text(locale, 'Configuration and tools', 'الإعدادات والأدوات') },
    ]} >
    {section === 'activity' ? <>
      <div className="email-workspace" data-detail-open={Boolean(jobId)}>
        <div className="email-workspace__list" ref={results} tabIndex={-1} aria-label={text(locale, 'Message results', 'نتائج الرسائل')}>
          <form key={JSON.stringify([view, query, status])} className="email-filters" onSubmit={(event) => {
            event.preventDefault(); const form = new FormData(event.currentTarget)
            change({ email_query: String(form.get('query') || '').trim() || null, email_status: String(form.get('status') || '') || null, email_page: null, email_job: null })
          }}>
            <Select aria-label={text(locale, 'Message source', 'مصدر السجلات')} value={view} onChange={(event) => change({ email_view: event.target.value, email_page: null, email_query: null, email_status: null, email_job: null })}>{VIEWS.map((item) => <option key={item} value={item}>{label(item, locale)}</option>)}</Select>
            <SearchInput name="query" label={text(locale, 'Search email records', 'البحث في سجلات البريد')} placeholder={text(locale, 'Email, subject or ID', 'البريد أو الموضوع أو المعرّف')} defaultValue={query} maxLength={200} />
            <Select name="status" aria-label={text(locale, 'Message status', 'حالة الرسالة')} defaultValue={status}><option value="">{text(locale, 'All statuses', 'كل الحالات')}</option>{STATUSES[view].map((item) => <option key={item} value={item}>{label(item.replace(/^email\./, ''), locale)}</option>)}</Select>
            <Button type="submit">{text(locale, 'Search', 'بحث')}</Button>
            {query || status ? <Button type="button" variant="ghost" onClick={() => change({ email_query: null, email_status: null, email_page: null, email_job: null })}>{text(locale, 'Clear', 'مسح')}</Button> : null}
          </form>
          <EmailActivity view={view} query={query} status={status} page={page} revision={revision} openJob={openJob} navigate={navigate} onPage={(next) => change({ email_page: String(next), email_job: null })} />
        </div>
        {jobId ? <EmailJob key={jobId} jobId={jobId} canManage={canManage} navigate={navigate} onClose={closeJob} onChange={() => setRevision((value) => value + 1)} /> : null}
      </div>
    </> : <EmailConfiguration section={section} canManage={canManage} onJob={(id) => change({ email_section: null, email_job: id })} />}
  </Tabs></section>
}

function EmailActivity({ view, query, status, page, revision, openJob, navigate, onPage }: { view: AdminEmailActivityView; query: string; status: string; page: number; revision: number; openJob: (id: string) => ReactNode; navigate: Navigate; onPage: (page: number) => void }) {
  const { admin } = useAdapters()
  const { locale } = useExperience()
  const resource = useAsyncData((signal) => admin.listEmailActivity({ view, query, status, page }, signal), [admin, view, query, status, page, revision], JSON.stringify([view, query, status, page]))
  const data = resource.data
  const badge = (value: string) => <Badge tone={tone(value)}>{label(value.replace(/^email\./, ''), locale)}</Badge>
  const empty = { emptyTitle: text(locale, 'No matching records', 'لا توجد سجلات مطابقة'), emptyBody: text(locale, 'Try another search or status.', 'جرّب بحثًا أو حالة أخرى.') }
  const ticket = (id?: string | null) => id ? <RouteLink route={{ surface: 'admin', page: 'support', state: '?thread=' + encodeURIComponent(id) }} navigate={navigate}>{text(locale, 'Open ticket', 'فتح التذكرة')}</RouteLink> : '—'
  const table = (result: AdminEmailActivityPage) => {
    if (result.view === 'outbound') return <AdminDataTable {...empty} rows={result.items} rowKey={(row) => row.id} columns={[
      { key: 'message', header: text(locale, 'Message', 'الرسالة'), render: (row) => <div className="email-message-cell"><strong>{row.subject}</strong><small dir="ltr">{row.recipient}</small></div> },
      { key: 'status', header: text(locale, 'Status', 'الحالة'), render: (row) => badge(row.status) },
      { key: 'date', header: text(locale, 'Created', 'الإنشاء'), render: (row) => date(row.created_at, locale) },
      { key: 'open', narrow: 'action' as const, header: text(locale, 'Details', 'التفاصيل'), render: (row) => openJob(row.id) },
    ]} />
    if (result.view === 'inbound') return <AdminDataTable {...empty} rows={result.items} rowKey={(row) => row.id} columns={[
      { key: 'message', header: text(locale, 'Message', 'الرسالة'), render: (row) => <div className="email-message-cell"><strong>{row.subject || '—'}</strong><small dir="ltr">{row.sender_email}</small></div> },
      { key: 'status', header: text(locale, 'Status', 'الحالة'), render: (row) => badge(row.status) },
      { key: 'reason', header: text(locale, 'Reason', 'السبب'), render: (row) => row.rejection_reason || '—' },
      { key: 'date', header: text(locale, 'Received', 'الاستلام'), render: (row) => date(row.received_at || row.created_at, locale) },
      { key: 'ticket', header: text(locale, 'Ticket', 'التذكرة'), render: (row) => ticket(row.thread_id) },
    ]} />
    if (result.view === 'scheduled') return <AdminDataTable {...empty} rows={result.items} rowKey={(row) => row.id} columns={[
      { key: 'recipient', header: text(locale, 'Recipient', 'المستلم'), render: (row) => <span dir="ltr">{row.recipient}</span> },
      { key: 'type', header: text(locale, 'Type', 'النوع'), render: (row) => row.event_type },
      { key: 'status', header: text(locale, 'Status', 'الحالة'), render: (row) => badge(row.status) },
      { key: 'date', header: text(locale, 'Scheduled for', 'موعد الإرسال'), render: (row) => date(row.scheduled_for, locale) },
      { key: 'reason', header: text(locale, 'Last error', 'آخر خطأ'), render: (row) => row.last_error || '—' },
    ]} />
    if (result.view === 'events') return <AdminDataTable {...empty} rows={result.items} rowKey={(row) => row.id} columns={[
      { key: 'event', header: text(locale, 'Event', 'الحدث'), render: (row) => badge(row.event_type) },
      { key: 'id', header: text(locale, 'Provider message ID', 'معرّف المزوّد'), render: (row) => row.provider_message_id || '—' },
      { key: 'date', header: text(locale, 'Received', 'الاستلام'), render: (row) => date(row.created_at, locale) },
      { key: 'job', narrow: 'action' as const, header: text(locale, 'Message', 'الرسالة'), render: (row) => row.email_job_id ? openJob(row.email_job_id) : '—' },
    ]} />
    return <AdminDataTable {...empty} rows={result.items} rowKey={(row) => row.email} columns={[
      { key: 'email', header: text(locale, 'Recipient', 'المستلم'), render: (row) => <span dir="ltr">{row.email}</span> },
      { key: 'status', header: text(locale, 'Status', 'الحالة'), render: (row) => badge(row.status) },
      { key: 'reason', header: text(locale, 'Reason', 'السبب'), render: (row) => row.reason || '—' },
      { key: 'date', header: text(locale, 'Updated', 'آخر تغيير'), render: (row) => date(row.updated_at, locale) },
    ]} />
  }
  return <div className="email-activity" aria-busy={resource.loading || resource.refreshing}>
    <div className="email-activity__meta"><span className="secondary">{data ? text(locale, `Updated ${date(data.generated_at, locale)}`, `آخر تحديث ${date(data.generated_at, locale)}`) : label(view, locale)}</span><Button size="sm" onClick={resource.reload} disabled={resource.loading || resource.refreshing} leadingIcon={<RefreshCcw size={14} />}>{text(locale, 'Refresh', 'تحديث')}</Button></div>
    {resource.error ? <EmailReadError stale={Boolean(data)} onRetry={resource.reload} /> : null}
    {data ? table(data) : !resource.error ? <EmailActivitySkeleton view={view} /> : null}
    {data ? <Pagination page={page} hasNext={data.has_more} disabled={resource.loading || resource.refreshing} onChange={onPage} label={text(locale, 'Results page', 'صفحة النتائج')} previousLabel={text(locale, 'Previous', 'السابق')} nextLabel={text(locale, 'Next', 'التالي')} /> : null}
  </div>
}

function EmailActivitySkeleton({ view }: { view: AdminEmailActivityView }) {
  const { locale } = useExperience()
  const columns = view === 'outbound' ? ['Message', 'Status', 'Created', 'Details'] : view === 'events' ? ['Event', 'Provider ID', 'Received', 'Message'] : ['Recipient', 'Status', 'Date', 'Details']
  const arabic = view === 'outbound' ? ['الرسالة', 'الحالة', 'الإنشاء', 'التفاصيل'] : view === 'events' ? ['الحدث', 'معرّف المزوّد', 'الاستلام', 'الرسالة'] : ['المستلم', 'الحالة', 'التاريخ', 'التفاصيل']
  return <AdminDataTable loading columns={columns.map((name, index) => ({ key: name, header: text(locale, name, arabic[index]), render: () => null }))} rows={[]} rowKey={() => ''} emptyTitle="" emptyBody="" />
}

function EmailJob({ jobId, canManage, navigate, onClose, onChange }: { jobId: string; canManage: boolean; navigate: Navigate; onClose: () => void; onChange: () => void }) {
  const { admin } = useAdapters()
  const { locale } = useExperience()
  const resource = useAsyncData((signal) => admin.getEmailJob(jobId, signal), [admin, jobId], jobId)
  const heading = useRef<HTMLHeadingElement>(null)
  const pending = useRef(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<ReturnType<typeof processingNotice> | null>(null)
  const [error, setError] = useState('')
  const retainJob = useCallback((route: AppRoute) => {
    const params = new URLSearchParams(route.state)
    const section = params.get('email_section')
    return section !== 'catalog' && section !== 'configuration' && params.get('email_job') === jobId
  }, [jobId])
  useAdminNavigationProtection('communications', busy ? 'saving' : null, retainJob)
  useEffect(() => { heading.current?.focus() }, [])
  const retry = async () => {
    if (pending.current || !canManage || !resource.data?.job.retry_allowed || resource.refreshing || resource.error) return
    pending.current = true; setBusy(true); setError(''); setNotice(null)
    try { setNotice(processingNotice(await admin.retryEmailJob(jobId), locale)); resource.reload(); onChange() }
    catch { setError(text(locale, 'Retry could not be confirmed. Check the updated message status before trying again.', 'لم تتأكد إعادة المحاولة. راجع حالة الرسالة بعد التحديث قبل المحاولة مجددًا.')); resource.reload(); onChange() }
    finally { pending.current = false; setBusy(false) }
  }
  const job = resource.data?.job
  return <aside className="email-workspace__detail" aria-labelledby="email-job-title">
    <div className="split"><h2 id="email-job-title" ref={heading} tabIndex={-1}>{text(locale, 'Message details', 'تفاصيل الرسالة')}</h2><Button size="sm" onClick={onClose} disabled={busy} leadingIcon={<ArrowLeft size={14} />}>{text(locale, 'Back to results', 'العودة للنتائج')}</Button></div>
    {resource.error ? <EmailReadError stale={Boolean(job)} onRetry={resource.reload} /> : null}
    {!job && !resource.error ? <SkeletonStack rows={6} /> : null}
    {job ? <><h3>{job.subject}</h3><p dir="ltr" className="email-address">{job.recipient}</p><Badge tone={tone(job.status)}>{label(job.status, locale)}</Badge>
      {job.last_error ? <Alert tone="warning" title={text(locale, 'Last send error', 'آخر خطأ في الإرسال')}>{job.last_error}</Alert> : null}
      {notice ? <Alert {...notice} /> : null}{error ? <Alert tone="warning" title={error} /> : null}
      <dl className="detail-list">
        <div><dt>{text(locale, 'Sender', 'المرسل')}</dt><dd dir="ltr">{job.sender || '—'}</dd></div>
        <div><dt>{text(locale, 'Created', 'الإنشاء')}</dt><dd>{date(job.created_at, locale)}</dd></div>
        <div><dt>{text(locale, 'Attempts', 'المحاولات')}</dt><dd><bdi dir="ltr">{job.attempt_count ?? '—'} / {job.max_attempts ?? '—'}</bdi></dd></div>
        <div><dt>{text(locale, 'Last attempt', 'آخر محاولة')}</dt><dd>{date(job.last_attempt_at, locale)}</dd></div>
        {job.status === 'queued' ? <div><dt>{text(locale, 'Next attempt', 'المحاولة التالية')}</dt><dd>{date(job.next_attempt_at, locale)}</dd></div> : null}
      </dl>
      <div className="cluster">
        {job.retry_allowed && canManage ? <Button onClick={retry} loading={busy} disabled={Boolean(resource.error) || resource.refreshing}>{text(locale, 'Retry sending', 'إعادة محاولة الإرسال')}</Button> : null}
        {job.linked_ticket_id ? <RouteLink className="ui-button ui-button--ghost ui-button--sm" route={{ surface: 'admin', page: 'support', state: '?' + new URLSearchParams({ thread: job.linked_ticket_id }) }} navigate={navigate}>{text(locale, 'Open ticket', 'فتح التذكرة')}</RouteLink> : null}
      </div>
      {job.retry_blocked_reason === 'recipient_suppressed' ? <p className="secondary">{text(locale, 'Sending to this recipient is blocked. Retrying does not remove that block.', 'الإرسال لهذا المستلم محظور. إعادة المحاولة لا تزيل الحظر.')}</p> : null}
      {job.retry_blocked_reason === 'sensitive_payload_unavailable' || job.retry_blocked_reason === 'sensitive_payload_expired' ? <p className="secondary">{text(locale, 'The temporary message data is no longer available. Request a new message through its original flow.', 'بيانات الرسالة المؤقتة لم تعد متاحة. اطلب رسالة جديدة من مسارها الأصلي.')}</p> : null}
      <SectionHeader title={text(locale, 'Message events', 'أحداث الرسالة')} action={<Button size="sm" onClick={resource.reload} disabled={resource.loading || resource.refreshing}>{text(locale, 'Refresh', 'تحديث')}</Button>} />
      {resource.data!.events_unavailable ? <EmailReadError onRetry={resource.reload} /> : resource.data!.events.length ? <Timeline items={resource.data!.events.map((event) => ({ title: label(event.event_type.replace(/^email\./, ''), locale), time: date(event.created_at, locale) }))} /> : <p className="secondary">{text(locale, 'No provider events have been recorded for this message.', 'لم تُسجّل أحداث من المزوّد لهذه الرسالة.')}</p>}
      {resource.data!.events_has_more ? <p className="secondary">{text(locale, 'Showing the first 100 events.', 'المعروض هو أول 100 حدث.')}</p> : null}
      <details><summary>{text(locale, 'Technical details', 'التفاصيل التقنية')}</summary><dl className="detail-list"><div><dt>ID</dt><dd>{job.id}</dd></div><div><dt>{text(locale, 'Provider ID', 'معرّف المزوّد')}</dt><dd>{job.provider_message_id || '—'}</dd></div><div><dt>{text(locale, 'Type', 'النوع')}</dt><dd>{job.catalog_event_type || job.email_type}</dd></div><div><dt>{text(locale, 'Template', 'القالب')}</dt><dd>{job.template_key || '—'} {job.template_version ? `v${job.template_version}` : ''}</dd></div></dl></details>
    </> : null}
  </aside>
}

function EmailConfiguration({ section, canManage, onJob }: { section: string; canManage: boolean; onJob: (id: string) => void }) {
  const { admin } = useAdapters()
  const { locale } = useExperience()
  const resource = useAsyncData((signal) => admin.getEmailConfiguration(signal), [admin], 'email-configuration')
  const data = resource.data
  const columns: Column<AdminEmailCatalogItem>[] = [
    { key: 'title', header: text(locale, 'Template', 'القالب'), render: (row) => <details><summary>{locale === 'ar' ? row.title_ar : row.title_en}</summary><p className="secondary">{locale === 'ar' ? row.description_ar : row.description_en}</p><small>{row.event_type} · {row.template_key} v{row.template_version}</small></details> },
    { key: 'category', header: text(locale, 'Category', 'التصنيف'), render: (row) => label(row.category, locale) },
    { key: 'status', header: text(locale, 'Integration', 'الربط'), render: (row) => <Badge tone={tone(row.integration_status)}>{label(row.integration_status, locale)}</Badge> },
    { key: 'sender', header: text(locale, 'Sender identity', 'هوية المرسل'), render: (row) => label(row.sender_identity, locale) },
  ]
  return <div className="email-configuration">
    <div className="email-activity__meta"><span /> <Button size="sm" onClick={resource.reload} disabled={resource.loading || resource.refreshing} leadingIcon={<RefreshCcw size={14} />}>{text(locale, 'Refresh', 'تحديث')}</Button></div>
    {resource.error ? <EmailReadError stale={Boolean(data)} onRetry={resource.reload} /> : null}
    {!data && !resource.error ? <SkeletonStack rows={6} /> : null}
    {data ? section === 'catalog' ? <AdminDataTable columns={columns} rows={data.catalog} rowKey={(row) => row.event_type} emptyTitle={text(locale, 'No templates', 'لا توجد قوالب')} emptyBody={text(locale, 'No email templates were returned.', 'لم تُرجع الخدمة قوالب بريد.')} /> : <>
      <dl className="readiness-checks">{[
        [text(locale, 'Outbound sending', 'إرسال البريد'), data.config.outbound_enabled, false], [text(locale, 'Inbound receiving', 'استقبال البريد'), data.config.inbound_enabled, false], [text(locale, 'Scheduler', 'الجدولة'), data.config.scheduler_enabled, false],
        [text(locale, 'Sending key', 'مفتاح الإرسال'), data.config.has_resend_send_api_key, true], [text(locale, 'Receiving key', 'مفتاح الاستقبال'), data.config.has_resend_receive_api_key, true], [text(locale, 'Webhook signature', 'توقيع أحداث المزوّد'), data.config.has_resend_webhook_secret, true],
      ].map(([name, value, configuration]) => <div key={String(name)}><dt>{name}</dt><dd><Badge tone={value ? 'neutral' : 'warning'}>{configuration ? value ? text(locale, 'Configured', 'مضبوط') : text(locale, 'Missing', 'غير مضبوط') : value ? text(locale, 'Enabled', 'مفعّل') : text(locale, 'Disabled', 'معطّل')}</Badge></dd></div>)}</dl>
      {!data.config.schema?.ok ? <Alert tone="warning" title={text(locale, 'Email storage could not be verified. Sending tools are unavailable.', 'تعذّر التحقق من تخزين البريد. أدوات الإرسال غير متاحة.')}><details><summary>{text(locale, 'Technical details', 'التفاصيل التقنية')}</summary><ul>{data.config.schema?.missing.map((item) => <li key={item}>{item}</li>)}</ul></details></Alert> : null}
      <details><summary>{text(locale, 'Sender identities and categories', 'هويات الإرسال والتصنيفات')}</summary><dl className="detail-list">{Object.entries(data.config.sender_identities || { general: data.config.from }).map(([key, value]) => <div key={key}><dt>{label(key, locale)}</dt><dd dir="ltr">{value}</dd></div>)}{Object.entries(data.config.category_flags || {}).map(([key, value]) => <div key={key}><dt>{label(key, locale)}</dt><dd>{value ? text(locale, 'Enabled', 'مفعّل') : text(locale, 'Disabled', 'معطّل')}</dd></div>)}</dl></details>
      {canManage ? <EmailTools catalog={data.catalog} enabled={data.config.outbound_enabled && Boolean(data.config.schema?.ok) && !resource.error && !resource.refreshing} onJob={onJob} /> : null}
    </> : null}
  </div>
}

const retainEmailTools = (route: AppRoute) => new URLSearchParams(route.state).get('email_section') === 'configuration'

function EmailTools({ catalog, enabled, onJob }: { catalog: AdminEmailCatalogItem[]; enabled: boolean; onJob: (id: string) => void }) {
  const { admin } = useAdapters()
  const { locale } = useExperience()
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const [confirmQueue, setConfirmQueue] = useState(false)
  const [notice, setNotice] = useState<ReturnType<typeof processingNotice> | null>(null)
  const [error, setError] = useState('')
  const [sentJob, setSentJob] = useState('')
  const testable = catalog.filter((item) => item.admin_test_allowed && item.integration_status !== 'disabled' && item.integration_status !== 'backend_missing')
  const defaultTemplate = testable.find((item) => item.event_type === 'admin.email_test')?.event_type ?? testable[0]?.event_type ?? ''
  const [draft, setDraft] = useState({ recipient: '', template: defaultTemplate, locale })
  const [baseline, setBaseline] = useState(draft)
  const selectedTemplate = testable.some((item) => item.event_type === draft.template) ? draft.template : defaultTemplate
  const hasDraft = draft.recipient.trim() !== baseline.recipient.trim() || draft.template !== baseline.template || draft.locale !== baseline.locale
  useAdminNavigationProtection('communications', busy ? 'saving' : hasDraft ? 'draft' : null, retainEmailTools)
  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (pending.current || !enabled || !selectedTemplate || !event.currentTarget.reportValidity()) return
    pending.current = true; setBusy(true); setError(''); setNotice(null); setSentJob('')
    try {
      const result = await admin.sendAdminTestEmail({ recipient: draft.recipient.trim(), emailType: selectedTemplate, locale: draft.locale })
      setBaseline(draft)
      setNotice(processingNotice(result.processing, locale)); setSentJob(result.jobId)
    } catch { setError(text(locale, 'Sending could not be confirmed. Check message activity before sending again.', 'لم يتأكد الإرسال. راجع سجل الرسائل قبل الإرسال مرة أخرى.')) }
    finally { pending.current = false; setBusy(false) }
  }
  const process = async () => {
    if (pending.current || !enabled) return
    pending.current = true; setBusy(true); setError(''); setNotice(null); setSentJob('')
    try {
      const result = await admin.processEmailOutbox()
      setNotice(result.skipped === true
        ? { tone: 'info', title: text(locale, 'The queue is already being processed.', 'الطابور قيد المعالجة بالفعل.') }
        : { tone: 'info', title: text(locale, `Messages checked: ${result.processed}. Accepted: ${result.sent}. Skipped: ${result.skipped}.`, `الرسائل التي راجعها الخادم: ${result.processed}، قبلها المزوّد: ${result.sent}، وتخطّاها الخادم: ${result.skipped}.`) })
    } catch { setError(text(locale, 'Queue processing could not be confirmed. Refresh message activity to check the result.', 'لم تتأكد معالجة الطابور. حدّث سجل الرسائل لمعرفة النتيجة.')) }
    finally { pending.current = false; setBusy(false) }
  }
  return <div className="email-tools">
    <Card><SectionHeader title={text(locale, 'Send a test email', 'إرسال بريد اختباري')} description={text(locale, 'This sends a real email to the address below.', 'هذا الإجراء يرسل بريدًا حقيقيًا للعنوان التالي.')} />
      <form className="settings-form" onSubmit={send}><FormField label={text(locale, 'Recipient', 'المستلم')} htmlFor="email-test-recipient" required><Input name="recipient" id="email-test-recipient" type="email" required disabled={busy} value={draft.recipient} onChange={(event) => setDraft({ ...draft, recipient: event.target.value })} /></FormField>
        <FormField label={text(locale, 'Template', 'القالب')} htmlFor="email-test-template"><Select name="template" id="email-test-template" value={selectedTemplate} disabled={busy} onChange={(event) => setDraft({ ...draft, template: event.target.value })}>{testable.map((item) => <option key={item.event_type} value={item.event_type}>{locale === 'ar' ? item.title_ar : item.title_en}</option>)}</Select></FormField>
        <FormField label={text(locale, 'Language', 'اللغة')} htmlFor="email-test-language"><Select name="locale" id="email-test-language" value={draft.locale} disabled={busy} onChange={(event) => setDraft({ ...draft, locale: event.target.value === 'ar' ? 'ar' : 'en' })}><option value="ar">العربية</option><option value="en">English</option></Select></FormField>
        <Button type="submit" variant="primary" leadingIcon={<Send size={14} />} loading={busy} disabled={!enabled || !testable.length}>{text(locale, 'Send test', 'إرسال الاختبار')}</Button>
      </form>
    </Card>
    <div><SectionHeader title={text(locale, 'Process the queue', 'معالجة الطابور')} description={text(locale, 'Runs the current batch of due messages. It can send email to multiple recipients.', 'يشغّل الدفعة الحالية من الرسائل المستحقة، وقد يرسل بريدًا لعدة مستلمين.')} /><Button onClick={() => setConfirmQueue(true)} disabled={!enabled || busy}>{text(locale, 'Process queue', 'معالجة الطابور')}</Button></div>
    {!enabled ? <p className="secondary">{text(locale, 'Sending tools are unavailable until sending is enabled and configuration is current.', 'أدوات الإرسال غير متاحة حتى يكون الإرسال مفعّلًا والإعداد المعروض محدّثًا.')}</p> : null}
    {notice ? <Alert {...notice} action={sentJob ? <Button onClick={() => onJob(sentJob)}>{text(locale, 'View message', 'عرض الرسالة')}</Button> : undefined} /> : null}{error ? <Alert tone="warning" title={error} /> : null}
    <ConfirmDialog open={confirmQueue} onClose={() => setConfirmQueue(false)} title={text(locale, 'Process queued emails?', 'معالجة رسائل الطابور؟')} body={text(locale, 'This starts sending the current batch of due messages, not just a selected message.', 'سيبدأ إرسال الدفعة الحالية من الرسائل المستحقة، وليس رسالة مختارة فقط.')} confirmLabel={text(locale, 'Process queue', 'معالجة الطابور')} cancelLabel={text(locale, 'Cancel', 'إلغاء')} onConfirm={() => { void process() }} />
  </div>
}
