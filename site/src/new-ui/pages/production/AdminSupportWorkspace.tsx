import { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, LifeBuoy, RefreshCcw, Send } from 'lucide-react'
import { useAdapters } from '../../adapters/AdapterProvider'
import { useExperience } from '../../app/ExperienceProvider'
import { useAdminNavigationProtection } from '../../app/adminNavigationProtection'
import { Button } from '../../components/ui/Button'
import { PageHeader, Pagination } from '../../components/ui/DataDisplay'
import { RouteLink } from '../../components/ui/RouteLink'
import { Alert, Badge, EmptyState, SkeletonStack } from '../../components/ui/Feedback'
import { Checkbox, FormField, Input, SearchInput, Select, Textarea } from '../../components/ui/FormControls'
import { ConfirmDialog } from '../../components/ui/Overlays'
import type { AppRoute, Navigate } from '../../app/routes'
import type { AdminSupportAuditEvent } from '../../../api/admin'
import { useAsyncData } from '../../hooks/useAsyncData'
import { useRouteSearchDraft } from '../../hooks/useRouteSearchDraft'
import { copyByLocale, formatDisplayDate } from './productionPresentation'
import { EMAIL_SUPPORT_ENABLED, stableTicketNumber, supportAuditLabel, supportErrorMessage, supportStatusLabel, supportStatusTone } from './productionSupport'
import { ErrorBlock } from './ProductionErrorBlock'
import { SupportThreadMessage } from './ProductionSupportMessage'
import { readSupportQueueState, supportQueueRoute, SUPPORT_QUEUE_PRIORITIES, SUPPORT_QUEUE_STATUSES, type SupportQueueState } from './adminRouteState'
import { useRecordReturnFocus } from './useRecordReturnFocus'

type SupportDraft = {
  reply: string; note: string; mode: 'reply' | 'note'; emailRequested: boolean
  replyKey?: string; noteKey?: string
  statusValue?: string; statusReason?: string
  statusAttempt?: { status: string; reason: string; key: string }
}
const EMPTY_SUPPORT_DRAFT: SupportDraft = { reply: '', note: '', mode: 'reply', emailRequested: false }
const hasSupportDraft = (draft?: SupportDraft) => Boolean(draft && (draft.reply.trim() || draft.note.trim() || draft.statusValue || draft.statusReason?.trim()))

export function AdminSupportV2({ routeState, navigate, canManage }: { routeState?: string; navigate: Navigate; canManage: boolean }) {
  const { t, locale } = useExperience()
  const { admin } = useAdapters()
  const queueState = readSupportQueueState(routeState)
  const { scope, query, status, priority, page } = queueState
  const threadId = new URLSearchParams(routeState).get('thread') || undefined
  const searchOrigin = JSON.stringify([scope, query, status, priority, page, threadId])
  const { value: search, setValue: setSearch, pending: searchPending } = useRouteSearchDraft(query, searchOrigin, (value) => {
    navigate(supportQueueRoute({ scope, status, priority, query: value, page: 1 }, threadId), { preserveScroll: true, replace: true })
  })
  const [drafts, setDrafts] = useState<Record<string, SupportDraft>>({})
  const [pending, setPending] = useState<Set<string>>(new Set())
  const hasDraft = Object.values(drafts).some(hasSupportDraft)
  const retainPendingTicket = useCallback((route: AppRoute) => new URLSearchParams(route.state).get('thread') === threadId, [threadId])
  useAdminNavigationProtection('support', pending.size ? 'saving' : hasDraft ? 'draft' : null, pending.size ? retainPendingTicket : undefined)
  const queue = useRef<HTMLElement>(null)
  const threads = useAsyncData(
    (signal) => admin.listSupportInbox({ scope, query, status, priority, page }, signal),
    [admin], JSON.stringify([scope, query, status, priority, page]),
  )
  useRecordReturnFocus(threadId || '', Boolean(threads.data && !threads.loading && !threads.refreshing), queue)
  const changeQueue = (patch: Partial<SupportQueueState>) => navigate(supportQueueRoute({ ...queueState, query: search.trim(), page: 1, ...patch }, threadId), { preserveScroll: true })
  const closeTicket = () => {
    navigate(supportQueueRoute(queueState), { preserveScroll: true, replace: true })
  }
  const resetFilters = () => {
    setSearch('')
    changeQueue({ query: '', status: '', priority: '' })
  }
  const filtered = Boolean(query || status || priority)
  const busy = searchPending || threads.loading || threads.refreshing
  const updateDraft = (id: string, patch: Partial<SupportDraft>) =>
    setDrafts((current) => ({ ...current, [id]: { ...(current[id] || EMPTY_SUPPORT_DRAFT), ...patch } }))
  const setTicketPending = (id: string, active: boolean) => setPending((current) => {
    const next = new Set(current)
    if (active) next.add(id); else next.delete(id)
    return next
  })
  return <div className="stack">
    <PageHeader title={t('supportInbox')} />
    <div className={threadId ? 'support-workbench has-ticket' : 'support-workbench'}>
      <nav className="support-inbox" ref={queue} tabIndex={-1} aria-label={t('supportInbox')}>
        <div className="support-inbox__tools">
          <div className="split">
            <Select aria-label={copyByLocale(locale, 'Ticket list', 'قائمة التذاكر')} value={scope} onChange={(event) => {
              setSearch('')
              changeQueue({ scope: event.target.value === 'waiting' ? 'waiting' : 'all', query: '', status: '', priority: '' })
            }}>
              <option value="all">{copyByLocale(locale, 'All tickets', 'كل التذاكر')}</option>
              <option value="waiting">{copyByLocale(locale, 'Awaiting a reply', 'بانتظار رد الدعم')}</option>
            </Select>
            <Button size="sm" variant="ghost" onClick={threads.reload} loading={busy}
              leadingIcon={<RefreshCcw size={15} aria-hidden="true" />}>{copyByLocale(locale, 'Refresh', 'تحديث')}</Button>
          </div>
          <SearchInput label={copyByLocale(locale, 'Search tickets', 'بحث في التذاكر')}
            placeholder={copyByLocale(locale, 'Ticket number, subject, or email', 'رقم التذكرة أو العنوان أو البريد')}
            value={search} onChange={(event) => setSearch(event.target.value.replace(/\p{Cc}/gu, '').slice(0, 200))} />
          <details className="support-inbox__filters">
            <summary>{copyByLocale(locale, 'Filters', 'الفلاتر')}{filtered ? ' · ' + copyByLocale(locale, 'Applied', 'مطبّقة') : ''}</summary>
            <div className="stack">
              {scope === 'all' ? <FormField label={t('status')} htmlFor="support-inbox-status">
                <Select id="support-inbox-status" value={status} onChange={(event) => changeQueue({ status: event.target.value as SupportQueueState['status'] })}>
                  <option value="">{copyByLocale(locale, 'All statuses', 'كل الحالات')}</option>
                  {SUPPORT_QUEUE_STATUSES.map((value) => <option key={value} value={value}>{supportStatusLabel(value, locale)}</option>)}
                </Select>
              </FormField> : null}
              <FormField label={copyByLocale(locale, 'Priority', 'الأولوية')} htmlFor="support-inbox-priority">
                <Select id="support-inbox-priority" value={priority} onChange={(event) => changeQueue({ priority: event.target.value as SupportQueueState['priority'] })}>
                  <option value="">{copyByLocale(locale, 'All priorities', 'كل الأولويات')}</option>
                  {SUPPORT_QUEUE_PRIORITIES.map((value) => <option key={value} value={value}>{supportPriorityLabel(value, locale)}</option>)}
                </Select>
              </FormField>
              {filtered ? <Button size="sm" variant="ghost" onClick={resetFilters}>{copyByLocale(locale, 'Clear filters', 'مسح الفلاتر')}</Button> : null}
            </div>
          </details>
        </div>
        <div className="support-inbox__results" aria-busy={busy}>
          {threads.error && !searchPending ? <ErrorBlock error={supportErrorMessage(threads.error, locale)} onRetry={threads.reload} />
            : searchPending || threads.loading ? <SkeletonStack rows={5} />
            : !threads.data?.threads.length ? <EmptyState
              title={page > 1 ? copyByLocale(locale, 'No tickets on this page', 'لا توجد تذاكر في هذه الصفحة') : filtered ? copyByLocale(locale, 'No matching tickets', 'لا توجد تذاكر مطابقة') : scope === 'waiting' ? copyByLocale(locale, 'No tickets awaiting a reply', 'لا توجد تذاكر بانتظار رد') : copyByLocale(locale, 'No support tickets', 'لا توجد تذاكر دعم')}
              body={page === 1 && filtered ? copyByLocale(locale, 'Try another search or clear the filters.', 'جرّب بحثًا آخر أو امسح الفلاتر.') : ''}
              action={page > 1 ? <Button size="sm" onClick={() => changeQueue({ page: 1 })}>{copyByLocale(locale, 'Return to first page', 'العودة للصفحة الأولى')}</Button> : undefined} />
            : <ul className="support-inbox__list">{threads.data.threads.map((row) => {
              const hasDraft = hasSupportDraft(drafts[row.id])
              return <li key={row.id} data-row-key={row.id}><RouteLink className="support-inbox__ticket"
                aria-current={threadId === row.id ? 'true' : undefined} route={supportQueueRoute(queueState, row.id)}
                navigate={(route) => navigate(route, { preserveScroll: true, replace: Boolean(threadId) })}>
                <div className="split"><bdi className={row.unread_count ? 'is-unread' : ''}>{row.email || stableTicketNumber(row.id, row.created_at, row.updated_at)}</bdi>
                  <time>{formatDisplayDate(row.last_message_at || row.updated_at, locale)}</time></div>
                <strong dir="auto">{row.subject}</strong>
                {row.last_message_body ? <p dir="auto">{row.last_message_body}</p> : null}
                <div className="cluster">
                  <Badge tone={supportStatusTone(row.status)}>{supportStatusLabel(row.status, locale)}</Badge>
                  {row.priority === 'urgent' || row.priority === 'high' ? <SupportPriorityBadge priority={row.priority} /> : null}
                  {row.unread_count ? <small>{copyByLocale(locale, String(row.unread_count) + ' unread', String(row.unread_count) + ' غير مقروءة')}</small> : null}
                  {hasDraft ? <small>{copyByLocale(locale, 'Draft', 'مسودة')}</small> : null}
                </div>
              </RouteLink></li>
            })}</ul>}
        </div>
        {page > 1 || threads.data?.has_more ? <Pagination page={page} hasNext={Boolean(!threads.error && threads.data?.has_more)} disabled={busy}
          label={copyByLocale(locale, 'Page', 'الصفحة')} previousLabel={t('previous')} nextLabel={t('next')} onChange={(next) => changeQueue({ page: next })} /> : null}
      </nav>
      {threadId ? <AdminSupportTicket key={threadId} threadId={threadId} onClose={closeTicket} onChanged={threads.reload} canManage={canManage}
        draft={drafts[threadId] || EMPTY_SUPPORT_DRAFT} onDraftChange={(patch) => updateDraft(threadId, patch)}
        pending={pending.has(threadId)} onPendingChange={(active) => setTicketPending(threadId, active)} />
        : <section className="support-conversation support-conversation--empty"><EmptyState icon={LifeBuoy}
          title={copyByLocale(locale, 'Select a ticket', 'اختر تذكرة')}
          body={copyByLocale(locale, 'Read the conversation and reply here.', 'اقرأ المحادثة وردّ من هنا.')} /></section>}
    </div>
  </div>
}

function supportPriorityLabel(priority: string | undefined, locale: 'ar' | 'en') {
  return priority === 'urgent' ? copyByLocale(locale, 'Urgent', 'عاجلة')
    : priority === 'high' ? copyByLocale(locale, 'High', 'مرتفعة')
    : priority === 'low' ? copyByLocale(locale, 'Low', 'منخفضة') : copyByLocale(locale, 'Normal', 'عادية')
}
function SupportPriorityBadge({ priority }: { priority?: string }) {
  const { locale } = useExperience()
  return <Badge tone={priority === 'urgent' ? 'danger' : priority === 'high' ? 'warning' : 'neutral'}>{supportPriorityLabel(priority, locale)}</Badge>
}

function AdminSupportTicket({ threadId, onClose, onChanged, canManage, draft, onDraftChange, pending, onPendingChange }: {
  threadId: string; onClose: () => void; onChanged: () => void; canManage: boolean
  draft: SupportDraft; onDraftChange: (patch: Partial<SupportDraft>) => void
  pending: boolean; onPendingChange: (active: boolean) => void
}) {
  const { t, locale } = useExperience()
  const { admin } = useAdapters()
  const conversation = useAsyncData((signal) => admin.getSupportConversation(threadId, signal), [admin, threadId], threadId)
  const selected = conversation.data?.thread
  const ticketNumber = selected ? stableTicketNumber(selected.id, selected.created_at, selected.updated_at) : ''
  const heading = useRef<HTMLHeadingElement>(null)
  const messages = useRef<HTMLDivElement>(null)
  const submitting = useRef(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [noticeTone, setNoticeTone] = useState<'success' | 'warning'>('success')
  const [blockConfirm, setBlockConfirm] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [failedReceipt, setFailedReceipt] = useState<string[]>()
  const [historyRevision, setHistoryRevision] = useState(0)
  const refreshTicket = () => {
    conversation.reload()
    setHistoryRevision((value) => value + 1)
  }
  const controlsDisabled = !canManage || pending || conversation.loading || conversation.refreshing || Boolean(conversation.error)
  useEffect(() => { heading.current?.focus() }, [])
  useEffect(() => {
    if (messages.current) messages.current.scrollTop = messages.current.scrollHeight
  }, [conversation.data?.messages.length])
  const receipt = conversation.status === 'success' ? conversation.data?.unreadMessageIds : undefined
  useEffect(() => {
    const controller = new AbortController()
    if (!receipt?.length) return
    let started = false
    const acknowledge = () => {
      if (document.visibilityState !== 'visible' || started) return
      started = true
      void admin.markSupportMessagesRead(threadId, receipt, controller.signal).then(() => {
        if (!controller.signal.aborted) onChanged()
      }).catch(() => {
        if (!controller.signal.aborted) { setFailedReceipt(receipt); onChanged() }
      })
    }
    document.addEventListener('visibilitychange', acknowledge)
    acknowledge()
    return () => {
      document.removeEventListener('visibilitychange', acknowledge)
      controller.abort()
    }
  }, [admin, onChanged, receipt, threadId])
  const run = async (action: () => Promise<unknown>, success: string, onCommitted?: () => void) => {
    if (submitting.current || controlsDisabled) return
    submitting.current = true; onPendingChange(true); setError(''); setNotice('')
    try {
      await action()
      onCommitted?.()
      setNoticeTone('success'); setNotice(success)
      refreshTicket(); onChanged()
    } catch (err) { setError(supportErrorMessage(err, locale)) }
    finally { submitting.current = false; onPendingChange(false) }
  }
  const sendReply = async () => {
    const internal = draft.mode === 'note'
    const body = internal ? draft.note : draft.reply
    if (!body.trim() || controlsDisabled || submitting.current || (!internal && selected?.support_blocked)) return
    const key = (internal ? draft.noteKey : draft.replyKey) || crypto.randomUUID()
    onDraftChange(internal ? { noteKey: key } : { replyKey: key })
    submitting.current = true; onPendingChange(true); setError(''); setNotice('')
    try {
      const result = await admin.sendSupportReply(threadId, body, { internal, emailRequested: !internal && draft.emailRequested, idempotencyKey: key })
      onDraftChange(internal ? { note: '', noteKey: undefined } : { reply: '', replyKey: undefined })
      const emailFailed = !internal && draft.emailRequested && result.emailQueued === false
      setNoticeTone(emailFailed ? 'warning' : 'success')
      setNotice(emailFailed ? copyByLocale(locale, 'Reply saved in the portal, but the email could not be queued.', 'تم حفظ الرد في البوابة، لكن تعذر تجهيز نسخة البريد.')
        : internal ? copyByLocale(locale, 'Internal note saved.', 'تم حفظ الملاحظة الداخلية.') : copyByLocale(locale, 'Reply saved in the portal.', 'تم حفظ الرد في البوابة.'))
      refreshTicket(); onChanged()
    } catch (err) { setError(supportErrorMessage(err, locale)) }
    finally { submitting.current = false; onPendingChange(false) }
  }
  return <section className="support-conversation" aria-labelledby="support-ticket-title" aria-busy={pending || conversation.loading}>
    <header className="support-conversation__header">
      <div className="split"><h2 ref={heading} tabIndex={-1} id="support-ticket-title">{selected?.subject || t('support')}</h2>
        <Button size="sm" variant="ghost" onClick={onClose}>{copyByLocale(locale, 'Back to tickets', 'الرجوع للتذاكر')}</Button></div>
      {selected ? <div className="cluster">
        <bdi>{selected.email || '—'}</bdi><Badge tone={supportStatusTone(selected.status)}>{supportStatusLabel(selected.status, locale)}</Badge>
        <Button size="sm" variant="text" onClick={async () => {
          try { await navigator.clipboard.writeText(ticketNumber); setNoticeTone('success'); setNotice(copyByLocale(locale, 'Ticket number copied.', 'تم نسخ رقم التذكرة.')) }
          catch { setError(copyByLocale(locale, 'Could not copy the ticket number.', 'تعذر نسخ رقم التذكرة.')) }
        }}><bdi>{ticketNumber}</bdi><Copy size={13} aria-hidden="true" /></Button>
        <Button size="sm" variant="ghost" disabled={pending || conversation.loading || conversation.refreshing} onClick={refreshTicket}>{copyByLocale(locale, 'Refresh', 'تحديث')}</Button>
      </div> : null}
    </header>
    {conversation.error ? <ErrorBlock error={supportErrorMessage(conversation.error, locale)} onRetry={conversation.reload} /> : null}
    {receipt && receipt === failedReceipt && !conversation.error ? <Alert tone="warning"
      title={copyByLocale(locale, 'Could not mark these messages as read.', 'تعذر تحديد الرسائل كمقروءة.')}
      action={<Button size="sm" onClick={conversation.reload}>{copyByLocale(locale, 'Retry', 'إعادة المحاولة')}</Button>} /> : null}
    {error ? <Alert title={error} tone="danger" /> : null}
    {notice ? <Alert title={notice} tone={noticeTone} /> : null}
    {selected ? <details className="support-conversation__properties" name="support-ticket-inspector">
      <summary>{copyByLocale(locale, 'Ticket details and actions', 'تفاصيل التذكرة وإجراءاتها')}</summary>
      <div className="stack">
        {canManage ? <form className="form-grid" key={selected.status} onSubmit={(event) => {
          event.preventDefault()
          const currentStatus = selected.status || 'open'
          const nextStatus = draft.statusValue ?? currentStatus
          if (nextStatus === currentStatus || controlsDisabled || submitting.current) return
          const reason = (draft.statusReason || '').trim()
          const key = draft.statusAttempt?.status === nextStatus && draft.statusAttempt.reason === reason ? draft.statusAttempt.key : crypto.randomUUID()
          onDraftChange({ statusAttempt: { status: nextStatus, reason, key } })
          void run(() => admin.updateSupportStatus(threadId, nextStatus, reason, { idempotencyKey: key }), copyByLocale(locale, 'Status updated.', 'تم تحديث الحالة.'), () => onDraftChange({ statusValue: undefined, statusReason: undefined, statusAttempt: undefined }))
        }}>
          <FormField label={t('status')} htmlFor="admin-ticket-status"><Select id="admin-ticket-status" name="status" value={draft.statusValue ?? selected.status ?? 'open'} disabled={controlsDisabled || Boolean(selected.support_blocked)} onChange={(event) => onDraftChange({ statusValue: event.target.value === (selected.status || 'open') ? undefined : event.target.value })}>
            {['open', 'awaiting_support', 'awaiting_customer', 'reopened', 'closed', 'blocked'].map((value) => <option key={value} value={value} disabled={value === 'blocked'}>{supportStatusLabel(value, locale)}</option>)}
          </Select></FormField>
          <FormField label={copyByLocale(locale, 'Reason (optional)', 'السبب (اختياري)')} htmlFor="support-status-reason"><Input id="support-status-reason" name="reason" maxLength={300} value={draft.statusReason || ''} disabled={controlsDisabled} onChange={(event) => onDraftChange({ statusReason: event.target.value })} /></FormField>
          <Button type="submit" size="sm" disabled={controlsDisabled || Boolean(selected.support_blocked)}>{copyByLocale(locale, 'Update status', 'تحديث الحالة')}</Button>
        </form> : null}
        <div className="form-grid"><FormField label={copyByLocale(locale, 'Priority', 'الأولوية')} htmlFor="admin-ticket-priority">
          {canManage ? <Select id="admin-ticket-priority" value={selected.priority || 'normal'} disabled={controlsDisabled} onChange={(event) => {
            const value = event.target.value as 'low' | 'normal' | 'high' | 'urgent'
            void run(() => admin.updateSupportPriority(threadId, value), copyByLocale(locale, 'Priority updated.', 'تم تحديث الأولوية.'))
          }}>{['urgent', 'high', 'normal', 'low'].map((value) => <option key={value} value={value}>{supportPriorityLabel(value, locale)}</option>)}</Select> : <SupportPriorityBadge priority={selected.priority} />}
        </FormField></div>
        <dl className="detail-list">
          <div><dt>{copyByLocale(locale, 'App version', 'إصدار الأداة')}</dt><dd><bdi>{selected.app_version || '—'}</bdi></dd></div>
          <div><dt>{copyByLocale(locale, 'Platform', 'النظام')}</dt><dd><bdi>{selected.platform || '—'}</bdi></dd></div>
          <div><dt>{copyByLocale(locale, 'Created', 'تاريخ الإنشاء')}</dt><dd>{formatDisplayDate(selected.created_at, locale)}</dd></div>
        </dl>
        {canManage ? <Button size="sm" variant={selected.support_blocked ? 'secondary' : 'danger'} disabled={controlsDisabled} onClick={() => {
          if (selected.support_blocked) void run(() => admin.setSupportBlocked(threadId, false), copyByLocale(locale, 'Sender unblocked.', 'تم إلغاء حظر المرسل.'))
          else setBlockConfirm(true)
        }}>{selected.support_blocked ? copyByLocale(locale, 'Unblock sender', 'إلغاء حظر المرسل') : t('blockSender')}</Button> : null}
      </div>
    </details> : null}
    {selected ? <details className="support-conversation__properties support-conversation__history" name="support-ticket-inspector" onToggle={(event) => setHistoryOpen(event.currentTarget.open)}>
      <summary>{copyByLocale(locale, 'Ticket history', 'سجل التذكرة')}</summary>
      {historyOpen ? <SupportTicketHistory key={historyRevision} threadId={threadId} /> : null}
    </details> : null}
    <div ref={messages} className="support-conversation__messages">
      {conversation.loading ? <SkeletonStack rows={4} /> : null}
      <div className="support-thread">{conversation.data?.messages.map((message) => <SupportThreadMessage key={message.id} message={message} locale={locale} attachmentsDownloadable={canManage} />)}</div>
    </div>
    {canManage && selected ? <form className={draft.mode === 'note' ? 'support-composer is-note' : 'support-composer'} onSubmit={(event) => { event.preventDefault(); void sendReply() }}>
      <div className="cluster"><Button type="button" size="sm" variant={draft.mode === 'reply' ? 'secondary' : 'ghost'} aria-pressed={draft.mode === 'reply'} disabled={pending} onClick={() => onDraftChange({ mode: 'reply' })}>{copyByLocale(locale, 'Reply to customer', 'رد للمستخدم')}</Button>
        <Button type="button" size="sm" variant={draft.mode === 'note' ? 'secondary' : 'ghost'} aria-pressed={draft.mode === 'note'} disabled={pending} onClick={() => onDraftChange({ mode: 'note' })}>{copyByLocale(locale, 'Internal note', 'ملاحظة داخلية')}</Button></div>
      <FormField label={draft.mode === 'note' ? copyByLocale(locale, 'Visible only to administrators', 'تظهر للمديرين فقط') : t('reply')} htmlFor="admin-support-reply">
        <Textarea id="admin-support-reply" value={draft.mode === 'note' ? draft.note : draft.reply} maxLength={4000} disabled={controlsDisabled || (draft.mode === 'reply' && Boolean(selected.support_blocked))}
          onChange={(event) => onDraftChange(draft.mode === 'note' ? { note: event.target.value, noteKey: undefined } : { reply: event.target.value, replyKey: undefined })} required />
      </FormField>
      {draft.mode === 'reply' && selected.support_blocked ? <p className="secondary">{copyByLocale(locale, 'Unblock the sender before replying. Internal notes are still available.', 'ألغِ حظر المرسل للرد عليه. يمكنك إضافة ملاحظة داخلية.')}</p> : null}
      <div className="split">
        {draft.mode === 'reply' ? <Checkbox label={copyByLocale(locale, 'Send an email copy', 'إرسال نسخة بالبريد')} checked={draft.emailRequested} disabled={controlsDisabled || !EMAIL_SUPPORT_ENABLED}
          onChange={(event) => onDraftChange({ emailRequested: event.target.checked, replyKey: undefined })} /> : <span />}
        <Button type="submit" variant="primary" loading={pending} leadingIcon={<Send size={14} aria-hidden="true" />}
          disabled={controlsDisabled || !(draft.mode === 'note' ? draft.note : draft.reply).trim() || (draft.mode === 'reply' && Boolean(selected.support_blocked))}>
          {draft.mode === 'note' ? copyByLocale(locale, 'Save note', 'حفظ الملاحظة') : copyByLocale(locale, 'Send reply', 'إرسال الرد')}
        </Button>
      </div>
    </form> : null}
    <ConfirmDialog open={blockConfirm} title={copyByLocale(locale, 'Block this sender?', 'حظر هذا المرسل؟')}
      body={copyByLocale(locale, 'This blocks support messages from this sender across their tickets. You can unblock them later.', 'سيمنع المرسل من إرسال رسائل الدعم في تذاكره. يمكنك إلغاء الحظر لاحقًا.')}
      confirmLabel={t('blockSender')} cancelLabel={t('cancel')} destructive
      onClose={() => setBlockConfirm(false)} onConfirm={() => { setBlockConfirm(false); void run(() => admin.setSupportBlocked(threadId, true, 'admin_block'), copyByLocale(locale, 'Sender blocked.', 'تم حظر المرسل.')) }} />
  </section>
}

function SupportTicketHistory({ threadId }: { threadId: string }) {
  const { locale } = useExperience()
  const { admin } = useAdapters()
  const first = useAsyncData((signal) => admin.getSupportHistory(threadId, null, signal), [admin], threadId)
  const [extension, setExtension] = useState<{ firstPage: typeof first.data; events: AdminSupportAuditEvent[]; nextCursor: string | null; focusId?: string }>()
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [appendFailed, setAppendFailed] = useState(false)
  const request = useRef<AbortController | null>(null)
  const firstAppended = useRef<HTMLLIElement | null>(null)
  const moreAction = useRef<HTMLButtonElement | null>(null)
  const saved = extension && extension.firstPage === first.data ? extension : null
  const cursor = saved ? saved.nextCursor : first.data?.nextCursor ?? null
  const rows = [...(first.data?.events ?? []), ...(saved?.events ?? [])]
  const busy = first.loading || first.refreshing || loadingOlder
  const retry = copyByLocale(locale, 'Retry', 'إعادة المحاولة')

  useEffect(() => () => request.current?.abort(), [])
  useEffect(() => {
    if (extension?.focusId) firstAppended.current?.focus()
  }, [extension])

  async function loadOlder() {
    if (request.current || !first.data || !cursor || busy) return
    const controller = new AbortController()
    request.current = controller
    setLoadingOlder(true)
    setAppendFailed(false)
    try {
      const page = await admin.getSupportHistory(threadId, cursor, controller.signal)
      if (controller.signal.aborted) return
      const previousIds = new Set(rows.map(({ id }) => id))
      if (page.events.some(({ id }) => previousIds.has(id))) throw new Error('support_history_unavailable')
      const focusId = moreAction.current === document.activeElement ? page.events[0]?.id ?? rows.at(-1)?.id : undefined
      setExtension({ firstPage: first.data, events: [...(saved?.events ?? []), ...page.events], nextCursor: page.nextCursor, focusId })
    } catch {
      if (!controller.signal.aborted) setAppendFailed(true)
    } finally {
      if (!controller.signal.aborted) setLoadingOlder(false)
      request.current = null
    }
  }
  return <div className="stack">
    {first.loading ? <div role="status">{copyByLocale(locale, 'Loading history…', 'جارٍ تحميل السجل…')}</div> : null}
    {first.error ? <Alert tone="warning"
      title={copyByLocale(locale, 'Could not load ticket history.', 'تعذر تحميل سجل التذكرة.')}
      action={<Button size="sm" onClick={first.reload}>{retry}</Button>} /> : null}
    {!first.loading && !first.error && rows.length === 0
      ? <p className="secondary">{copyByLocale(locale, 'No events yet.', 'لا توجد أحداث بعد.')}</p> : null}
    {rows.length ? <ol className="support-audit-list" aria-busy={busy}>{rows.map((event) =>
      <li key={event.id} tabIndex={-1} ref={event.id === saved?.focusId ? firstAppended : undefined}>
        <strong>{supportAuditLabel(event.event_type, locale)}</strong>
        <small>{formatDisplayDate(event.created_at, locale)}</small>
      </li>)}</ol> : null}
    {appendFailed ? <Alert tone="warning" title={copyByLocale(locale, 'Could not load older events.', 'تعذر تحميل الأحداث الأقدم.')} /> : null}
    {cursor !== null ? <Button ref={moreAction} size="sm" variant="secondary" aria-disabled={busy}
      onClick={() => { void loadOlder() }}>
      {loadingOlder ? copyByLocale(locale, 'Loading older events…', 'جارٍ تحميل الأحداث الأقدم…')
        : appendFailed ? retry : copyByLocale(locale, 'Load older events', 'تحميل أحداث أقدم')}
    </Button> : null}
  </div>
}
