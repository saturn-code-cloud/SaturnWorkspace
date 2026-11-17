import { ArrowLeft, RefreshCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { AdminPolicyRules, AdminPolicyVersionChange, AdminPolicyVersionState, PolicyJson } from '../../../api/admin'
import { parseServiceTimestamp } from '../../../lib/serviceTimestamp'
import { useAdapters } from '../../adapters/AdapterProvider'
import { useExperience } from '../../app/ExperienceProvider'
import { useAdminNavigationProtection } from '../../app/adminNavigationProtection'
import type { AppRoute, Navigate } from '../../app/routes'
import { Button, IconButton } from '../../components/ui/Button'
import { Pagination } from '../../components/ui/DataDisplay'
import { AdminDataTable } from './AdminDataTable'
import { Alert, Badge, SkeletonStack } from '../../components/ui/Feedback'
import { FormField, Input, SearchInput, Textarea } from '../../components/ui/FormControls'
import { Modal } from '../../components/ui/Overlays'
import { useAsyncData } from '../../hooks/useAsyncData'
import { adminPolicyTab } from './adminPolicyTabs'

type Locale = 'ar' | 'en'
const text = (locale: Locale, en: string, ar: string) => locale === 'ar' ? ar : en
const versionPattern = /^v?\d+(?:\.\d+){0,3}(?:[-+][a-zA-Z0-9.-]+)?$/
const date = (value: string, locale: Locale) => { const parsed = parseServiceTimestamp(value); return parsed ? new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed) : '—' }
const pageNumber = (value: string | null) => /^[1-9]\d*$/.test(value || '') && Number(value) <= 5000 ? Number(value) : 1
const retainVersionDraft = (route: AppRoute) => adminPolicyTab(route.state) === 'versions'
const RULE_NAMES: Record<string, [string, string]> = { sessions: ['Sessions', 'الجلسات'], updates: ['Updates', 'التحديثات'], adspower: ['AdsPower', 'AdsPower'], cloud_sync: ['Cloud sync', 'المزامنة السحابية'], sessions_per_day: ['Sessions per day', 'الجلسات اليومية'] }

export function AdminPolicyRecords({ view, canManage, routeState, navigate }: { view: 'versions' | 'plans'; canManage: boolean; routeState?: string; navigate: Navigate }) {
  const { admin } = useAdapters(); const { locale, t } = useExperience()
  const params = new URLSearchParams(routeState || ''); const query = params.get(view + '_query') || ''; const page = pageNumber(params.get(view + '_page')); const selectedPlan = view === 'plans' ? params.get('plan') : null
  const [target, setTarget] = useState<{ version: string; disabled: boolean } | null>(null)
  const resource = useAsyncData((signal) => selectedPlan ? Promise.resolve(null) : admin.getPolicyDirectory({ view, query, page }, signal), [admin, view, query, page, selectedPlan], JSON.stringify([view, query, page, selectedPlan]))
  const change = (values: Record<string, string | null>) => { const next = new URLSearchParams(params); for (const [key, value] of Object.entries(values)) { if (value) next.set(key, value); else next.delete(key) }; navigate({ surface: 'admin', page: 'policies', state: '?' + next }, { preserveScroll: true }) }
  const data = resource.data
  return <section className="admin-policy-records">
    {selectedPlan ? <PolicyPlanDetail id={selectedPlan} onBack={() => change({ plan: null })} /> : <>
      <header className="admin-policy-heading"><h2>{view === 'versions' ? text(locale, 'Disabled versions', 'الإصدارات المعطلة') : text(locale, 'Plan policies', 'سياسات الخطط')}</h2><div className="cluster"><IconButton label={text(locale, 'Refresh records', 'تحديث السجلات')} size="sm" onClick={resource.reload} disabled={resource.loading || resource.refreshing}><RefreshCcw size={14} /></IconButton>{view === 'versions' && canManage ? <Button size="sm" variant="danger" onClick={() => setTarget({ version: '', disabled: true })}>{text(locale, 'Disable a version', 'تعطيل إصدار')}</Button> : null}</div></header>
      <p className="secondary">{view === 'versions' ? text(locale, 'A blocked version cannot pass its access-policy check. Other access requirements still apply after re-enabling it.', 'الإصدار المعطّل لا يجتاز فحص سياسة الوصول. تظل شروط الوصول الأخرى سارية بعد إعادة تفعيله.') : text(locale, 'Stored plan rules, not the effective access of an individual account. These rules are read-only here.', 'قواعد الخطط المحفوظة، وليست صلاحيات حساب بعينه. هذه القواعد للعرض فقط هنا.')}</p>
      <form className="admin-policy-search" onSubmit={(event) => { event.preventDefault(); const fields = new FormData(event.currentTarget); change({ [view + '_query']: String(fields.get('query') || '').trim(), [view + '_page']: null }) }}><SearchInput key={query} label={view === 'versions' ? text(locale, 'Search version or reason', 'ابحث بالإصدار أو السبب') : text(locale, 'Search plan ID', 'ابحث بمعرّف الخطة')} name="query" defaultValue={query} maxLength={100} /><Button>{text(locale, 'Search', 'بحث')}</Button></form>
      {resource.error ? <Alert tone={data ? 'warning' : 'danger'} title={text(locale, 'These policy records could not be loaded.', 'تعذّر تحميل سجلات السياسات.')} action={<Button onClick={resource.reload}>{text(locale, 'Retry', 'إعادة المحاولة')}</Button>}>{data ? text(locale, 'Previous results are shown. Refresh before changing a version.', 'المعروض هو آخر نتيجة محفوظة. حدّث السجلات قبل تغيير إصدار.') : null}</Alert> : null}
      {resource.loading ? <SkeletonStack rows={5} /> : null}
      {data?.view === 'versions' ? <AdminDataTable rows={data.items} rowKey={(row) => row.version} emptyTitle={text(locale, 'No matching disabled versions', 'لا توجد إصدارات معطلة مطابقة')} emptyBody={text(locale, 'Try another search. Versions outside this list are still subject to other policies.', 'جرّب بحثًا آخر. تظل الإصدارات خارج هذه القائمة خاضعة لباقي السياسات.')} columns={[
        { key: 'version', header: text(locale, 'Version', 'الإصدار'), render: (row) => <bdi>{row.version}</bdi> },
        { key: 'reason', header: text(locale, 'Reason', 'السبب'), render: (row) => row.reason || '—' },
        { key: 'created', header: text(locale, 'Disabled at', 'تاريخ التعطيل'), render: (row) => date(row.created_at, locale) },
        ...(canManage ? [{ key: 'action', narrow: 'action' as const, header: text(locale, 'Action', 'الإجراء'), render: (row: { version: string }) => <Button size="sm" disabled={Boolean(resource.error || resource.refreshing)} onClick={() => setTarget({ version: row.version, disabled: false })}>{text(locale, 'Re-enable', 'إعادة التفعيل')}</Button> }] : []),
      ]} /> : data?.view === 'plans' ? <AdminDataTable rows={data.items} rowKey={(row) => row.plan_id} emptyTitle={text(locale, 'No matching plan policies', 'لا توجد سياسات خطط مطابقة')} emptyBody={text(locale, 'Try another plan ID.', 'جرّب معرّف خطة آخر.')} columns={[
        { key: 'id', header: text(locale, 'Plan', 'الخطة'), render: (row) => <bdi>{row.plan_id}</bdi> },
        { key: 'features', header: text(locale, 'Features', 'الخصائص'), render: (row) => row.valid ? row.features_count : <Badge tone="warning">{text(locale, 'Rules unavailable', 'تعذّرت قراءة القواعد')}</Badge> },
        { key: 'blocked', header: text(locale, 'Blocked actions', 'الإجراءات المحظورة'), render: (row) => row.blocked_actions_count ?? '—' },
        { key: 'limits', header: text(locale, 'Limits', 'الحدود'), render: (row) => row.limits_count ?? '—' },
        { key: 'updated', header: text(locale, 'Updated', 'آخر تحديث'), render: (row) => date(row.updated_at, locale) },
        { key: 'action', narrow: 'action' as const, header: text(locale, 'Details', 'التفاصيل'), render: (row) => <Button size="sm" onClick={() => change({ plan: row.plan_id })}>{text(locale, 'View rules', 'عرض القواعد')}</Button> },
      ]} /> : null}
      {data ? <Pagination page={page} hasNext={data.has_more} label={text(locale, 'Policy page', 'صفحة السياسات')} previousLabel={t('previous')} nextLabel={t('next')} disabled={resource.refreshing} onChange={(next) => change({ [view + '_page']: String(next) })} /> : null}
    </>}
    {target && canManage ? <VersionChange key={target.version + target.disabled} target={target} onClose={() => setTarget(null)} onSaved={() => { setTarget(null); resource.reload() }} /> : null}
  </section>
}

function VersionChange({ target, onClose, onSaved }: { target: { version: string; disabled: boolean }; onClose: () => void; onSaved: () => void }) {
  const { admin } = useAdapters(); const { locale } = useExperience()
  const [version, setVersion] = useState(target.version); const [reason, setReason] = useState(''); const [snapshot, setSnapshot] = useState<AdminPolicyVersionState | null>(null)
  const [operation, setOperation] = useState<AdminPolicyVersionChange | null>(null)
  const [busy, setBusy] = useState<'read' | 'write' | ''>(''); const [error, setError] = useState(''); const guard = useRef(false); const controller = useRef<AbortController | null>(null)
  const dirty = version.trim() !== target.version || Boolean(reason.trim())
  const confirmClose = useAdminNavigationProtection('policies', busy === 'write' ? 'saving' : dirty ? 'draft' : null, retainVersionDraft)
  const close = () => confirmClose(onClose)
  useEffect(() => () => controller.current?.abort(), [])
  const review = async () => {
    if (guard.current || !versionPattern.test(version.trim()) || reason.trim().length < 3) return
    guard.current = true; setBusy('read'); setError(''); controller.current = new AbortController()
    try { const next = await admin.getPolicyVersion(version.trim(), controller.current.signal); if (controller.current.signal.aborted) return; setSnapshot(next); setOperation(next.disabled === target.disabled ? null : { version: next.version, disabled: target.disabled, reason: reason.trim(), expected_revision: next.revision, request_id: crypto.randomUUID() }) }
    catch { if (!controller.current.signal.aborted) setError('read') }
    finally { guard.current = false; setBusy('') }
  }
  const apply = async () => {
    if (!operation || guard.current || error === 'changed') return
    guard.current = true; setBusy('write'); setError('')
    try { await admin.updateDisabledVersion(operation); onSaved() }
    catch (failure) { setError(failure instanceof Error && ['policy_state_changed', 'policy_request_conflict'].includes(failure.message) ? 'changed' : 'uncertain') }
    finally { guard.current = false; setBusy('') }
  }
  const title = target.disabled ? text(locale, 'Disable a version', 'تعطيل إصدار') : text(locale, 'Re-enable a version', 'إعادة تفعيل إصدار')
  return <Modal open title={title} closeDisabled={busy === 'write'} onClose={close} closeLabel={text(locale, 'Close', 'إغلاق')} footer={<>
    <Button onClick={close} disabled={busy === 'write'}>{text(locale, 'Cancel', 'إلغاء')}</Button>
    {snapshot ? <Button disabled={Boolean(busy)} onClick={() => { setSnapshot(null); setOperation(null); setError('') }}>{text(locale, 'Review again', 'مراجعة من جديد')}</Button> : null}
    {operation ? <Button variant={target.disabled ? 'danger' : 'primary'} loading={busy === 'write'} disabled={busy === 'read' || error === 'changed'} onClick={apply}>{error === 'uncertain' ? text(locale, 'Retry same change', 'إعادة محاولة نفس التغيير') : target.disabled ? text(locale, 'Disable version', 'تعطيل الإصدار') : text(locale, 'Re-enable version', 'إعادة تفعيل الإصدار')}</Button> : !snapshot ? <Button variant="primary" loading={busy === 'read'} disabled={!versionPattern.test(version.trim()) || reason.trim().length < 3 || Boolean(busy)} onClick={review}>{text(locale, 'Review impact', 'مراجعة التأثير')}</Button> : null}
  </>}><div className="stack">
    {snapshot ? <><dl className="detail-list"><div><dt>{text(locale, 'Version', 'الإصدار')}</dt><dd><bdi>{snapshot.version}</bdi></dd></div><div><dt>{text(locale, 'Current state', 'الحالة الحالية')}</dt><dd>{snapshot.disabled ? text(locale, 'Disabled', 'معطّل') : text(locale, 'Not blocked by this list', 'غير محظور بهذه القائمة')}</dd></div>{snapshot.item?.reason ? <div><dt>{text(locale, 'Saved reason', 'السبب المحفوظ')}</dt><dd>{snapshot.item.reason}</dd></div> : null}<div><dt>{text(locale, 'Change reason', 'سبب التغيير')}</dt><dd>{reason}</dd></div></dl>
      <Alert tone={operation && target.disabled ? 'warning' : 'info'} title={!operation ? text(locale, 'This version is already in the requested state.', 'الإصدار موجود بالفعل في الحالة المطلوبة.') : target.disabled ? text(locale, 'Access-policy checks will block this exact version.', 'ستمنع سياسة الوصول هذا الإصدار بعينه.') : text(locale, 'Only the version block will be removed. All other access requirements remain.', 'سيُرفع حظر الإصدار فقط. تظل شروط الوصول الأخرى سارية.')} />
    </> : <><FormField label={text(locale, 'Version', 'الإصدار')} htmlFor="policy-version-target" required><Input id="policy-version-target" dir="ltr" value={version} maxLength={80} aria-invalid={Boolean(version && !versionPattern.test(version.trim()))} aria-describedby={version && !versionPattern.test(version.trim()) ? 'policy-version-format' : undefined} disabled={Boolean(busy) || !target.disabled} onChange={(event) => setVersion(event.target.value)} />{version && !versionPattern.test(version.trim()) ? <small id="policy-version-format" className="ui-field__error">{text(locale, 'Enter a version such as 1.2.32.', 'أدخل إصدارًا مثل 1.2.32.')}</small> : null}</FormField><FormField label={text(locale, 'Reason', 'السبب')} htmlFor="policy-version-reason" required><Textarea id="policy-version-reason" value={reason} minLength={3} maxLength={1000} aria-describedby={reason && reason.trim().length < 3 ? 'policy-version-reason-help' : undefined} disabled={Boolean(busy)} onChange={(event) => setReason(event.target.value)} />{reason && reason.trim().length < 3 ? <small id="policy-version-reason-help" className="ui-field__error">{text(locale, 'Use at least 3 characters for the reason.', 'اكتب سببًا من 3 أحرف على الأقل.')}</small> : null}</FormField></>}
    {error ? <Alert tone="danger" title={error === 'read' ? text(locale, 'The current version state could not be loaded. Try again.', 'تعذّر تحميل حالة الإصدار الحالية. أعد المحاولة.') : error === 'changed' ? text(locale, 'The version state changed. Review it again before applying.', 'تغيّرت حالة الإصدار. راجعها من جديد قبل التطبيق.') : text(locale, 'Saving could not be confirmed. Retry the same change.', 'تعذّر تأكيد الحفظ. أعد محاولة نفس التغيير.')} /> : null}
  </div></Modal>
}

function PolicyPlanDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { admin } = useAdapters(); const { locale } = useExperience()
  const resource = useAsyncData((signal) => admin.getPolicyPlan(id, signal), [admin, id], id)
  return <div className="stack"><div><Button leadingIcon={<ArrowLeft size={14} />} onClick={onBack}>{text(locale, 'Back to plan policies', 'العودة لسياسات الخطط')}</Button></div><header className="admin-policy-heading"><h2><bdi>{id}</bdi></h2><IconButton label={text(locale, 'Refresh plan rules', 'تحديث قواعد الخطة')} onClick={resource.reload} disabled={resource.loading || resource.refreshing}><RefreshCcw size={14} /></IconButton></header>
    {resource.error ? <Alert tone={resource.data ? 'warning' : 'danger'} title={resource.data ? text(locale, 'The plan policy could not be refreshed. Previous rules are shown.', 'تعذّر تحديث سياسة الخطة. المعروض هو آخر قواعد محفوظة.') : text(locale, 'The plan policy could not be loaded.', 'تعذّر تحميل سياسة الخطة.')} action={<Button onClick={resource.reload}>{text(locale, 'Retry', 'إعادة المحاولة')}</Button>} /> : null}
    {resource.loading ? <SkeletonStack rows={6} /> : null}
    {resource.data ? <><p className="secondary">{text(locale, 'Global rules are merged first, then plan rules, then subscription settings. Blocked actions are combined. This is not an account access test.', 'تُدمج السياسة العامة، ثم قواعد الخطة، ثم إعدادات الاشتراك. تُجمع الإجراءات المحظورة. هذا العرض ليس فحصًا لوصول حساب بعينه.')}</p><section><h3>{text(locale, 'Plan rules', 'قواعد الخطة')}</h3><PolicyRules value={resource.data.rules} /></section><details><summary>{text(locale, 'Global rules', 'قواعد السياسة العامة')}</summary>{resource.data.global_rules ? <PolicyRules value={resource.data.global_rules} /> : <Alert tone="warning" title={text(locale, 'Global rules are unavailable. The plan rules above remain available.', 'تعذّر تحميل القواعد العامة. قواعد الخطة بالأعلى ما زالت متاحة.')} />}</details></> : null}
  </div>
}

function PolicyRules({ value }: { value: AdminPolicyRules }) {
  const { locale } = useExperience()
  if (!value.valid) return <Alert tone="warning" title={text(locale, 'These saved rules could not be read. They were not treated as empty.', 'تعذّرت قراءة هذه القواعد المحفوظة. لم تُعامل كقواعد فارغة.')} />
  const sections = [{ title: text(locale, 'Features', 'الخصائص'), values: value.features }, { title: text(locale, 'Limits', 'الحدود'), values: value.limits }]
  return <div className="policy-rules">{sections.map((section) => <section key={section.title}><h4>{section.title}</h4>{Object.keys(section.values).length ? <dl>{Object.entries(section.values).map(([key, setting]) => <div key={key}><dt title={key}>{RULE_NAMES[key]?.[locale === 'ar' ? 1 : 0] || <bdi>{key}</bdi>}</dt><dd><RuleValue value={setting} locale={locale} /></dd></div>)}</dl> : <p className="secondary">{text(locale, 'No rules in this section.', 'لا توجد قواعد في هذا القسم.')}</p>}</section>)}<section><h4>{text(locale, 'Blocked actions', 'الإجراءات المحظورة')}</h4>{value.blocked_actions.length ? <ul>{value.blocked_actions.map((action, index) => <li key={index}><bdi>{action}</bdi></li>)}</ul> : <p className="secondary">{text(locale, 'No actions blocked by these rules.', 'لا تحظر هذه القواعد أي إجراءات.')}</p>}</section></div>
}
function RuleValue({ value, locale }: { value: PolicyJson; locale: Locale }): React.ReactNode {
  if (value === null) return text(locale, 'Not set', 'غير محدد')
  if (typeof value === 'boolean') return <Badge>{value ? text(locale, 'Enabled', 'مفعّل') : text(locale, 'Disabled', 'معطّل')}</Badge>
  if (typeof value === 'number') return new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-US').format(value)
  if (typeof value === 'string') return <bdi>{value}</bdi>
  const count = Array.isArray(value) ? value.length : Object.keys(value).length
  if (!count) return Array.isArray(value) ? text(locale, 'Empty list', 'قائمة فارغة') : text(locale, 'No values', 'لا توجد قيم')
  return <details className="policy-rule-value"><summary>{text(locale, 'View values', 'عرض القيم')} ({new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-US').format(count)})</summary>{Array.isArray(value) ? <ol>{value.map((item, index) => <li key={index}><RuleValue value={item} locale={locale} /></li>)}</ol> : <dl>{Object.entries(value).map(([key, item]) => <div key={key}><dt><bdi>{key}</bdi></dt><dd><RuleValue value={item} locale={locale} /></dd></div>)}</dl>}</details>
}
