import { ArrowLeft, ArrowRight, Copy, RefreshCcw } from 'lucide-react'
import { useState } from 'react'
import type { AdminCommerceIntegrity, AdminCommerceOrder, AdminCommercePage, AdminCommerceView, AdminOrderDetail, AdminOrderRecordsView } from '../../../api/admin'
import { formatMoneyMinor } from '../../../lib/money'
import { parseServiceTimestamp } from '../../../lib/serviceTimestamp'
import { useAdapters } from '../../adapters/AdapterProvider'
import { useExperience } from '../../app/ExperienceProvider'
import type { Navigate } from '../../app/routes'
import { Button, IconButton } from '../../components/ui/Button'
import { PageHeader, Pagination } from '../../components/ui/DataDisplay'
import { AdminDataTable } from './AdminDataTable'
import { Alert, Badge } from '../../components/ui/Feedback'
import { SearchInput, Select } from '../../components/ui/FormControls'
import { Tabs } from '../../components/ui/Navigation'
import { RouteLink } from '../../components/ui/RouteLink'
import { useAsyncData } from '../../hooks/useAsyncData'

type Locale = 'ar' | 'en'
const text = (locale: Locale, en: string, ar: string) => locale === 'ar' ? ar : en
const ORDER_LABELS: Record<AdminCommerceOrder['status'], [string, string]> = { creating: ['Creating', 'جارٍ الإنشاء'], provider_unavailable: ['Provider unavailable', 'المزوّد غير متاح'], awaiting_payment: ['Awaiting payment', 'بانتظار الدفع'], confirming: ['Confirming', 'قيد التأكيد'], paid: ['Paid', 'مدفوع'], underpaid: ['Underpaid', 'دفع ناقص'], overpaid: ['Overpaid', 'دفع زائد'], expired: ['Expired', 'منتهي'], failed: ['Failed', 'فشل'], cancelled: ['Cancelled', 'ملغى'], refunded: ['Refunded', 'مسترد'], manual_review: ['Needs review', 'بحاجة لمراجعة'] }
const VIEW_LABELS: Record<AdminCommerceView, [string, string]> = { orders: ['Orders', 'الطلبات'], plans: ['Plans', 'الخطط'], integrity: ['Access review', 'مراجعة الوصول'] }
const DETAIL_LABELS: Record<AdminOrderRecordsView, [string, string]> = { attempts: ['Payment attempts', 'محاولات الدفع'], events: ['Provider events', 'أحداث المزوّد'], receipts: ['Receipts', 'الإيصالات'] }
const pageNumber = (raw: string | null) => /^\d+$/.test(raw || '') && Number(raw) > 0 && Number(raw) <= 5000 ? Number(raw) : 1
const date = (value: string | null | undefined, locale: Locale) => { const parsed = parseServiceTimestamp(value); return parsed ? new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed) : '—' }
function statusBadge(status: AdminCommerceOrder['status'], locale: Locale) { return <Badge tone={status === 'paid' ? 'success' : ['failed', 'underpaid', 'overpaid', 'manual_review'].includes(status) ? 'warning' : 'neutral'}>{ORDER_LABELS[status]?.[locale === 'ar' ? 1 : 0] || status}</Badge> }

export function AdminCommerce({ routeState, navigate, canReadSubscriptions }: { routeState?: string; navigate: Navigate; canReadSubscriptions: boolean }) {
  const { locale, t } = useExperience()
  const params = new URLSearchParams(routeState || '')
  const view = Object.hasOwn(VIEW_LABELS, params.get('view') || '') ? params.get('view') as AdminCommerceView : 'orders'
  const id = params.get('order') || ''
  const change = (values: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(values)) { if (value) next.set(key, value); else next.delete(key) }
    navigate({ surface: 'admin', page: 'commerce', state: '?' + next }, { preserveScroll: true })
  }
  return <section className="admin-commerce">
    <PageHeader title={t('payments')} />
    {id ? <OrderDetail id={id} view={Object.hasOwn(DETAIL_LABELS, params.get('records') || '') ? params.get('records') as AdminOrderRecordsView : 'attempts'} page={pageNumber(params.get('records_page'))} onBack={() => change({ order: null, records: null, records_page: null })} onView={(records) => change({ records, records_page: null })} onPage={(page) => change({ records_page: String(page) })} /> : <>
      <CommerceAvailability />
      <Tabs ariaLabel={text(locale, 'Payment sections', 'أقسام المدفوعات')} active={view} onChange={(next) => change({ view: next, query: null, status: null, page: null })} items={Object.entries(VIEW_LABELS).map(([key, labels]) => ({ id: key, label: labels[locale === 'ar' ? 1 : 0] }))} >
      <CommerceDirectory key={view} view={view} query={params.get('query') || ''} status={params.get('status') || ''} page={pageNumber(params.get('page'))}
        onChange={change} navigate={navigate} canReadSubscriptions={canReadSubscriptions} />
    </Tabs></>}
  </section>
}

function CommerceAvailability() {
  const { admin } = useAdapters(); const { locale } = useExperience()
  const resource = useAsyncData((signal) => admin.getCommerceConfiguration(signal), [admin])
  return resource.error ? <Alert tone="warning" title={text(locale, 'Payment configuration could not be checked.', 'تعذّر التحقق من إعداد الدفع.')} action={<Button onClick={resource.reload}>{text(locale, 'Retry', 'إعادة المحاولة')}</Button>} /> : resource.data ? <Alert title={text(locale, 'Checkout is not enabled', 'الدفع غير مفعّل')}>{text(locale, 'Existing records are read-only. Payments and refunds are unavailable.', 'السجلات الموجودة للعرض فقط. بدء الدفع واسترداد الأموال غير متاحين.')}<details className="commerce-provider-details"><summary>{text(locale, 'Provider configuration', 'إعداد المزوّدين')}</summary><dl className="detail-list">{Object.entries(resource.data.providers).map(([provider, state]) => <div key={provider}><dt>{provider === 'stripe' ? 'Stripe' : 'NOWPayments'}</dt><dd>{state.configured ? text(locale, 'Credentials present; payment integration unavailable', 'بيانات الربط موجودة؛ تكامل الدفع غير متاح') : text(locale, 'Not configured', 'غير مجهّز')}</dd></div>)}</dl></details></Alert> : null
}

function CommerceDirectory({ view, query, status, page, onChange, navigate, canReadSubscriptions }: {
  view: AdminCommerceView; query: string; status: string; page: number; onChange: (value: Record<string, string | null>) => void;
  navigate: Navigate; canReadSubscriptions: boolean;
}) {
  const { admin } = useAdapters(); const { locale } = useExperience()
  const resource = useAsyncData((signal) => admin.getCommercePage({ view, query, status, page }, signal), [admin, view, query, status, page], JSON.stringify([view, query, status, page]))
  const [copyError, setCopyError] = useState(false)
  const code = (value: string) => <div className="commerce-reference"><bdi>{value}</bdi><IconButton label={text(locale, 'Copy reference', 'نسخ المعرّف')} size="sm" onClick={async () => { try { await navigator.clipboard.writeText(value); setCopyError(false) } catch { setCopyError(true) } }}><Copy size={13} /></IconButton></div>
  const table = (data: AdminCommercePage) => {
    if (data.view === 'orders') return <AdminDataTable rows={data.items} rowKey={(row) => row.id} emptyTitle={text(locale, 'No matching orders', 'لا توجد طلبات مطابقة')} emptyBody={text(locale, 'Try another search or status. Existing orders will appear here.', 'جرّب بحثًا أو حالة أخرى. ستظهر هنا الطلبات الموجودة.')} columns={[
      { key: 'customer', header: text(locale, 'Customer', 'المستخدم'), render: (row) => <div className="commerce-customer"><bdi>{row.user_email || row.firebase_uid}</bdi><small>{row.plan_id} · v{row.plan_version}</small></div> },
      { key: 'amount', header: text(locale, 'Order amount', 'مبلغ الطلب'), render: (row) => <bdi>{formatMoneyMinor(row.amount_minor, row.currency, locale) || '—'}</bdi> },
      { key: 'status', header: text(locale, 'Status', 'الحالة'), render: (row) => statusBadge(row.status, locale) },
      { key: 'provider', header: text(locale, 'Provider', 'المزوّد'), render: (row) => row.provider || '—' },
      { key: 'date', header: text(locale, 'Created', 'الإنشاء'), render: (row) => date(row.created_at, locale) },
      { key: 'details', narrow: 'action' as const, header: text(locale, 'Details', 'التفاصيل'), render: (row) => <Button size="sm" onClick={() => onChange({ order: row.id, records: null, records_page: null })}>{text(locale, 'View order', 'عرض الطلب')}</Button> },
    ]} />
    if (data.view === 'plans') return <AdminDataTable comparison rows={data.items} rowKey={(row) => row.plan_id + ':' + row.version} emptyTitle={text(locale, 'No matching plans', 'لا توجد خطط مطابقة')} emptyBody={text(locale, 'Saved plan versions will appear here.', 'ستظهر هنا إصدارات الخطط المحفوظة.')} columns={[
      { key: 'plan', header: text(locale, 'Plan', 'الخطة'), render: (row) => <div className="commerce-customer"><strong>{row.display_name}</strong><small>{row.plan_id} · v{row.version}</small></div> },
      { key: 'term', header: text(locale, 'Term', 'المدة'), render: (row) => ({ weekly: text(locale, 'Weekly', 'أسبوعي'), monthly: text(locale, 'Monthly', 'شهري'), annual: text(locale, 'Annual', 'سنوي'), lifetime: text(locale, 'Lifetime', 'مدى الحياة'), custom: text(locale, 'Custom', 'مخصص') }[row.term] || row.term) },
      { key: 'price', header: text(locale, 'Listed price', 'السعر المسجّل'), render: (row) => <bdi>{formatMoneyMinor(row.price_minor, row.currency, locale) || '—'}</bdi> },
      { key: 'visibility', header: text(locale, 'Visibility', 'الظهور'), render: (row) => <Badge tone="neutral">{!row.active ? text(locale, 'Inactive', 'معطّلة') : row.public_visible ? text(locale, 'Visible', 'ظاهرة') : text(locale, 'Hidden', 'مخفية')}</Badge> },
      { key: 'provider', header: text(locale, 'Provider', 'المزوّد'), render: (row) => row.provider || text(locale, 'Not assigned', 'غير محدد') },
      { key: 'checkout', header: text(locale, 'Checkout', 'الدفع'), render: () => text(locale, 'Unavailable', 'غير متاح') },
    ]} />
    return <AdminDataTable rows={data.items} rowKey={(row) => row.id} emptyTitle={text(locale, 'No matching review records', 'لا توجد حالات مراجعة مطابقة')} emptyBody={text(locale, 'Recorded subscription integrity checks will appear here.', 'ستظهر هنا حالات التحقق المسجّلة لسلامة الاشتراكات.')} columns={[
      { key: 'code', header: text(locale, 'Reason', 'السبب'), render: (row) => code(row.code) },
      { key: 'user', header: text(locale, 'User ID', 'معرّف المستخدم'), render: (row) => row.firebase_uid ? code(row.firebase_uid) : '—' },
      { key: 'subscription', header: text(locale, 'Subscription', 'الاشتراك'), render: (row) => row.subscription_id ? code(row.subscription_id) : '—' },
      { key: 'severity', header: text(locale, 'Severity', 'الأهمية'), render: (row) => <Badge tone={row.severity === 'critical' ? 'danger' : row.severity === 'warning' ? 'warning' : 'info'}>{row.severity === 'critical' ? text(locale, 'Critical', 'حرجة') : row.severity === 'warning' ? text(locale, 'Warning', 'تحذير') : text(locale, 'Info', 'معلومة')}</Badge> },
      { key: 'source', header: text(locale, 'Source', 'المصدر'), render: (row) => row.source },
      { key: 'date', header: text(locale, 'Created', 'الإنشاء'), render: (row) => date(row.created_at, locale) },
      ...(canReadSubscriptions ? [{ key: 'related', narrow: 'action' as const, header: text(locale, 'Related records', 'سجلات مرتبطة'), render: (row: AdminCommerceIntegrity) => row.firebase_uid
        ? <RouteLink className="admin-overview__record" route={{ surface: 'admin', page: 'subscriptions', state: '?' + new URLSearchParams({ search: row.firebase_uid }) }} navigate={navigate}>
          {text(locale, 'Search subscriptions by user ID', 'البحث في الاشتراكات بمعرّف المستخدم')}
        </RouteLink> : '—' }] : []),
    ]} />
  }
  const statuses = view === 'orders' ? Object.entries(ORDER_LABELS) : view === 'plans' ? [['visible', ['Visible', 'ظاهرة']], ['hidden', ['Hidden', 'مخفية']], ['inactive', ['Inactive', 'معطّلة']]] : [['open', ['Unresolved', 'غير محلولة']], ['resolved', ['Resolved', 'محلولة']]]
  return <>
    <form key={JSON.stringify([query, status])} className="promo-filters" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); onChange({ query: String(form.get('query') || '').trim() || null, status: String(form.get('status') || '') || null, page: null }) }}>
      <SearchInput name="query" label={text(locale, 'Search records', 'البحث في السجلات')} placeholder={view === 'orders' ? text(locale, 'Customer email or order ID', 'بريد المستخدم أو رقم الطلب') : view === 'plans' ? text(locale, 'Plan ID', 'معرّف الخطة') : text(locale, 'User ID', 'معرّف المستخدم')} defaultValue={query} maxLength={100} />
      <Select aria-label={text(locale, 'Record status', 'حالة السجل')} name="status" defaultValue={status}>{view !== 'integrity' ? <option value="">{text(locale, 'All statuses', 'كل الحالات')}</option> : null}{statuses.map(([key, labels]) => <option key={String(key)} value={String(key)}>{labels[locale === 'ar' ? 1 : 0]}</option>)}</Select>
      <Button type="submit">{text(locale, 'Search', 'بحث')}</Button>{query || status ? <Button type="button" variant="ghost" onClick={() => onChange({ query: null, status: null, page: null })}>{text(locale, 'Clear', 'مسح')}</Button> : null}
      <Button type="button" leadingIcon={<RefreshCcw size={14} />} onClick={resource.reload} disabled={resource.loading || resource.refreshing}>{text(locale, 'Refresh', 'تحديث')}</Button>
    </form>
    {resource.error ? <Alert tone="warning" title={text(locale, resource.data ? 'Refresh failed. Showing the previous records.' : 'Records could not be loaded.', resource.data ? 'تعذّر التحديث. المعروض هو السجلات السابقة.' : 'تعذّر تحميل السجلات.')} action={<Button onClick={resource.reload}>{text(locale, 'Retry', 'إعادة المحاولة')}</Button>} /> : null}
    {copyError ? <Alert tone="warning" title={text(locale, 'Clipboard access was blocked. Select the reference and copy it manually.', 'تعذّر النسخ. حدد المعرّف وانسخه يدويًا.')} /> : null}
    {resource.data ? <><p className="secondary">{text(locale, 'Matching records:', 'السجلات المطابقة:')} {resource.data.total}</p>{table(resource.data)}<Pagination page={page} hasNext={resource.data.has_more} disabled={resource.loading || resource.refreshing} onChange={(next) => onChange({ page: String(next) })} label={text(locale, 'Results page', 'صفحة النتائج')} previousLabel={text(locale, 'Previous', 'السابق')} nextLabel={text(locale, 'Next', 'التالي')} /></> : !resource.error ? <AdminDataTable loading rows={[]} rowKey={() => ''} columns={[["Record", "السجل"], ["Amount", "المبلغ"], ["Status", "الحالة"], ["Date", "التاريخ"]].map(([en, ar]) => ({ key: en, header: text(locale, en, ar), render: () => null }))} emptyTitle="" emptyBody="" /> : null}
  </>
}

function OrderDetail({ id, view, page, onBack, onView, onPage }: { id: string; view: AdminOrderRecordsView; page: number; onBack: () => void; onView: (value: string) => void; onPage: (page: number) => void }) {
  const { admin } = useAdapters(); const { locale } = useExperience()
  const resource = useAsyncData((signal) => admin.getCommerceOrder(id, view, page, signal), [admin, id, view, page], id)
  const current = resource.data?.view === view && resource.data.page === page ? resource.data : null
  const order = resource.data?.order
  const orderMissing = resource.error === 'order_not_found'
  const BackIcon = locale === 'ar' ? ArrowRight : ArrowLeft
  const money = (amount: number | null | undefined, currency: string) => <bdi>{formatMoneyMinor(amount, currency, locale) || '—'}</bdi>
  const table = (data: AdminOrderDetail) => {
    if (data.unavailable || !data.items) return <Alert tone="warning" title={text(locale, 'These records could not be loaded. The order details above remain available.', 'تعذّر تحميل هذه السجلات. تفاصيل الطلب بالأعلى ما زالت متاحة.')} action={<Button onClick={resource.reload}>{text(locale, 'Retry', 'إعادة المحاولة')}</Button>} />
    const empty = { emptyTitle: text(locale, 'No recorded activity', 'لا توجد سجلات'), emptyBody: text(locale, 'This order has no records in this section.', 'لا توجد سجلات لهذا الطلب في هذا القسم.') }
    if (data.view === 'attempts') return <AdminDataTable comparison {...empty} rows={data.items} rowKey={(row) => row.id} columns={[
      { key: 'reference', header: text(locale, 'Provider reference', 'مرجع المزوّد'), render: (row) => <bdi>{row.provider_payment_id || row.id}</bdi> },
      { key: 'status', header: text(locale, 'Status', 'الحالة'), render: (row) => row.status },
      { key: 'requested', header: text(locale, 'Requested', 'المطلوب'), render: (row) => money(row.requested_amount_minor, row.currency) },
      { key: 'received', header: text(locale, 'Received', 'المستلم'), render: (row) => money(row.received_amount_minor, row.currency) },
      { key: 'date', header: text(locale, 'Created', 'الإنشاء'), render: (row) => date(row.created_at, locale) },
    ]} />
    if (data.view === 'events') return <AdminDataTable comparison {...empty} rows={data.items} rowKey={(row) => row.id} columns={[
      { key: 'event', header: text(locale, 'Event', 'الحدث'), render: (row) => row.event_type },
      { key: 'processing', header: text(locale, 'Processing', 'المعالجة'), render: (row) => row.processing_status },
      { key: 'signature', header: text(locale, 'Verified signature', 'توقيع متحقق'), render: (row) => row.signature_verified ? text(locale, 'Yes', 'نعم') : text(locale, 'No', 'لا') },
      { key: 'error', header: text(locale, 'Error code', 'رمز الخطأ'), render: (row) => row.error_code || '—' },
      { key: 'date', header: text(locale, 'Received', 'الاستلام'), render: (row) => date(row.received_at, locale) },
    ]} />
    return <AdminDataTable comparison {...empty} rows={data.items} rowKey={(row) => row.id} columns={[
      { key: 'reference', header: text(locale, 'Reference', 'المرجع'), render: (row) => <bdi>{row.provider_receipt_id || row.id}</bdi> },
      { key: 'type', header: text(locale, 'Type', 'النوع'), render: (row) => row.document_type === 'invoice' ? text(locale, 'Invoice', 'فاتورة') : text(locale, 'Receipt', 'إيصال') },
      { key: 'issued', header: text(locale, 'Issued', 'الإصدار'), render: (row) => date(row.issued_at, locale) },
      { key: 'created', header: text(locale, 'Recorded', 'التسجيل'), render: (row) => date(row.created_at, locale) },
    ]} />
  }
  return <>
    <div className="split"><Button variant="ghost" leadingIcon={<BackIcon size={14} aria-hidden="true" />} onClick={onBack}>{text(locale, 'Back to orders', 'العودة للطلبات')}</Button>{!orderMissing ? <Button leadingIcon={<RefreshCcw size={14} />} disabled={resource.loading || resource.refreshing} onClick={resource.reload}>{text(locale, 'Refresh', 'تحديث')}</Button> : null}</div>
    {resource.error ? <Alert tone="warning" title={orderMissing
      ? text(locale, 'Order not found', 'الطلب مش موجود')
      : text(locale, order ? 'Refresh failed. Showing the previous order.' : 'The order could not be loaded.', order ? 'تعذّر التحديث. المعروض هو الطلب السابق.' : 'تعذّر تحميل الطلب.')}
      action={orderMissing ? undefined : <Button onClick={resource.reload}>{text(locale, 'Retry', 'إعادة المحاولة')}</Button>} /> : null}
    {order && !orderMissing ? <>
      <header className="split"><div><h2><bdi>{order.user_email || order.firebase_uid}</bdi></h2><p className="secondary"><bdi>{order.id}</bdi></p></div>{statusBadge(order.status, locale)}</header>
      <dl className="admin-record-summary"><div><dt>{text(locale, 'Order amount', 'مبلغ الطلب')}</dt><dd>{money(order.amount_minor, order.currency)}</dd></div><div><dt>{text(locale, 'Plan', 'الخطة')}</dt><dd>{order.plan_id} · v{order.plan_version}</dd></div><div><dt>{text(locale, 'Created', 'الإنشاء')}</dt><dd>{date(order.created_at, locale)}</dd></div><div><dt>{text(locale, 'Last update', 'آخر تحديث')}</dt><dd>{date(order.updated_at, locale)}</dd></div></dl>
      <details className="commerce-provider-details"><summary>{text(locale, 'Order references', 'معرّفات الطلب')}</summary><dl className="detail-list"><div><dt>{text(locale, 'Provider', 'المزوّد')}</dt><dd><bdi>{order.provider || '—'}</bdi></dd></div><div><dt>{text(locale, 'Provider order ID', 'مرجع طلب المزوّد')}</dt><dd><bdi>{order.provider_order_id || '—'}</bdi></dd></div><div><dt>{text(locale, 'User ID', 'معرّف المستخدم')}</dt><dd><bdi>{order.firebase_uid}</bdi></dd></div><div><dt>{text(locale, 'Expiry', 'الانتهاء')}</dt><dd>{date(order.expires_at, locale)}</dd></div></dl></details>
    </> : null}
    {!orderMissing && (order || resource.loading) ? <Tabs ariaLabel={text(locale, 'Order records', 'سجلات الطلب')} active={view} onChange={onView} items={Object.entries(DETAIL_LABELS).map(([key, labels]) => ({ id: key, label: labels[locale === 'ar' ? 1 : 0] }))} >
    {view === 'events' ? <p className="secondary">{text(locale, 'Signature verification confirms the event source, not the payment result.', 'التحقق من التوقيع يثبت مصدر الحدث، لا نتيجة الدفع.')}</p> : null}
    {current ? table(current) : !resource.error ? <AdminDataTable loading rows={[]} rowKey={() => ''} columns={[{ key: 'loading', header: text(locale, 'Records', 'السجلات'), render: () => null }]} emptyTitle="" emptyBody="" /> : null}
    {current && !current.unavailable ? <Pagination page={page} hasNext={current.has_more} disabled={resource.loading || resource.refreshing} onChange={onPage} label={text(locale, 'Records page', 'صفحة السجلات')} previousLabel={text(locale, 'Previous', 'السابق')} nextLabel={text(locale, 'Next', 'التالي')} /> : null}
  </Tabs> : null}</>
}
