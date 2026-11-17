import { useRef, useState } from 'react'
import type { AdminGlobalPolicy, AdminGlobalPolicyChange } from '../../../api/admin'
import { useAdapters } from '../../adapters/AdapterProvider'
import { useExperience } from '../../app/ExperienceProvider'
import { useAdminNavigationProtection } from '../../app/adminNavigationProtection'
import { Button } from '../../components/ui/Button'
import { Alert, Badge, SkeletonStack } from '../../components/ui/Feedback'
import { Checkbox, FormField, Input, Select, Textarea } from '../../components/ui/FormControls'
import { Modal } from '../../components/ui/Overlays'
import { useAsyncData } from '../../hooks/useAsyncData'
import type { AppRoute } from '../../app/routes'
import { adminPolicyTab } from './adminPolicyTabs'

type Locale = 'ar' | 'en'
const text = (locale: Locale, en: string, ar: string) => locale === 'ar' ? ar : en
type Values = Pick<AdminGlobalPolicyChange, 'kill_switch_enabled' | 'mandatory_update_enabled' | 'minimum_supported_version' | 'update_mode'>
const values = (policy: AdminGlobalPolicy): Values => ({ kill_switch_enabled: policy.kill_switch_enabled === 1, mandatory_update_enabled: policy.mandatory_update_enabled === 1, minimum_supported_version: policy.minimum_supported_version || '', update_mode: policy.update_mode })
const same = (a: Values, b: Values) => Object.keys(a).every((key) => a[key as keyof Values] === b[key as keyof Values])

const retainGlobalSave = (route: AppRoute) => adminPolicyTab(route.state) === 'global'

export function AdminGlobalPolicy({ canManage, active }: { canManage: boolean; active: boolean }) {
  const { admin } = useAdapters(); const { locale } = useExperience()
  const resource = useAsyncData((signal) => admin.getGlobalPolicy(signal), [admin])
  return <section className="admin-policy-editor">
    <div className="admin-policy-heading"><h2>{text(locale, 'Global access policy', 'سياسة الوصول العامة')}</h2><Button size="sm" onClick={resource.reload} disabled={resource.loading || resource.refreshing}>{text(locale, 'Refresh saved policy', 'تحديث السياسة المحفوظة')}</Button></div>
    {resource.error ? <Alert tone={resource.data ? 'warning' : 'danger'} title={text(locale, 'The saved policy could not be checked.', 'تعذّر التحقق من السياسة المحفوظة.')}>{resource.data ? text(locale, 'Your edits are still here. Refresh before applying them.', 'تعديلاتك موجودة. حدّث السياسة قبل تطبيقها.') : text(locale, 'Retry to view the current settings.', 'أعد المحاولة لعرض الإعدادات الحالية.')}</Alert> : null}
    {resource.data ? <PolicyForm policy={resource.data} canManage={canManage} active={active} stale={Boolean(resource.error || resource.refreshing)} reload={resource.reload} /> : resource.loading ? <SkeletonStack rows={5} /> : null}
  </section>
}

function PolicyForm({ policy, canManage, active, stale, reload }: { policy: AdminGlobalPolicy; canManage: boolean; active: boolean; stale: boolean; reload: () => void }) {
  const { admin } = useAdapters(); const { locale } = useExperience()
  const [session, setSession] = useState<{ base: AdminGlobalPolicy; draft: Values; reason: string } | null>(null)
  const [review, setReview] = useState<AdminGlobalPolicyChange | null>(null)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [busy, setBusy] = useState(false); const guard = useRef(false)
  const [failure, setFailure] = useState('')
  const [confirmedSource, setConfirmedSource] = useState<AdminGlobalPolicy | null>(null)
  const base = session?.base || policy; const draft = session?.draft || values(policy); const reason = session?.reason || ''
  const dirty = !same(draft, values(base)); const changed = base.revision !== policy.revision
  const awaitingRead = confirmedSource === policy
  const frozen = busy || Boolean(review) || awaitingRead
  const versionValid = !draft.minimum_supported_version || (draft.minimum_supported_version.length <= 80 && /^v?\d+(?:\.\d+){0,3}(?:[-+][a-zA-Z0-9.-]+)?$/.test(draft.minimum_supported_version))
  const protection = !canManage ? null : busy ? 'saving' : dirty || reason.trim() ? 'draft' : null
  useAdminNavigationProtection('policies', protection, busy ? retainGlobalSave : undefined)
  const edit = (next: Partial<Values>) => { setFailure(''); setConfirmedSource(null); setSession({ base, draft: { ...draft, ...next }, reason }) }
  const label = (key: keyof Values) => ({ kill_switch_enabled: text(locale, 'Global access stop', 'إيقاف الوصول العام'), mandatory_update_enabled: text(locale, 'Require available update', 'إلزام التحديث المتاح'), minimum_supported_version: text(locale, 'Minimum supported version', 'أقل إصدار مدعوم'), update_mode: text(locale, 'Update mode', 'وضع التحديث') })[key]
  const display = (key: keyof Values, value: boolean | string) => typeof value === 'boolean' ? value ? text(locale, 'Enabled', 'مفعّل') : text(locale, 'Disabled', 'معطّل') : key === 'update_mode' ? value === 'optional' ? text(locale, 'Optional', 'اختياري') : text(locale, 'Mandatory', 'إجباري') : value || text(locale, 'Not set', 'غير محدد')
  const changes = (Object.keys(draft) as Array<keyof Values>).filter((key) => draft[key] !== values(base)[key])
  const apply = async () => {
    if (!review || !canManage || stale || changed || guard.current) return
    guard.current = true; setBusy(true); setFailure('')
    try {
      await admin.updateGlobalPolicy(review)
      setSession(null); setReview(null); setConfirmedSource(policy); reload()
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      setFailure(['policy_state_changed', 'policy_request_conflict'].includes(code) ? 'changed' : 'uncertain')
      if (code === 'policy_state_changed') reload()
    } finally { guard.current = false; setBusy(false) }
  }
  return <>
    {confirmedSource ? <Alert tone="success" title={text(locale, 'Policy saved.', 'تم حفظ السياسة.')} /> : null}
    {changed ? <Alert tone="warning" title={text(locale, 'The policy changed after you started editing.', 'تغيّرت السياسة بعد بدء التعديل.')}>{text(locale, 'Your draft was kept. Load the latest values and review your changes again.', 'احتفظنا بتعديلاتك. اعرض القيم الأحدث وراجع التغييرات من جديد.')}<Button onClick={() => setDiscardOpen(true)} disabled={busy}>{text(locale, 'Load latest values', 'عرض القيم الأحدث')}</Button></Alert> : null}
    <p className="secondary">{text(locale, 'These settings apply when clients refresh their access policy. They do not delete stored data.', 'تُطبّق هذه الإعدادات عند تحديث سياسة الوصول لدى العميل. لا تحذف البيانات المحفوظة.')}</p>
    {canManage ? <form className="settings-form" onSubmit={(event) => { event.preventDefault(); if (!dirty || !versionValid || reason.trim().length < 3 || stale || changed || frozen) return; setFailure(''); setReview({ ...draft, reason: reason.trim(), expected_revision: base.revision, request_id: crypto.randomUUID() }) }}>
      <fieldset disabled={frozen} className="admin-policy-fields"><legend>{text(locale, 'Update requirements', 'متطلبات التحديث')}</legend><div className="form-grid">
        <FormField label={label('update_mode')} htmlFor="global-policy-mode"><Select id="global-policy-mode" value={draft.update_mode} onChange={(event) => edit({ update_mode: event.target.value as Values['update_mode'] })}><option value="optional">{text(locale, 'Optional', 'اختياري')}</option><option value="mandatory">{text(locale, 'Mandatory', 'إجباري')}</option>{['force', 'required'].includes(draft.update_mode) ? <option value={draft.update_mode}>{text(locale, 'Mandatory (saved setting)', 'إجباري (الإعداد المحفوظ)')}</option> : null}</Select></FormField>
        <FormField label={label('minimum_supported_version')} htmlFor="global-policy-version"><Input id="global-policy-version" dir="ltr" value={draft.minimum_supported_version} maxLength={80} aria-invalid={!versionValid} aria-describedby="global-policy-version-help" onChange={(event) => edit({ minimum_supported_version: event.target.value.trim() })} /><small id="global-policy-version-help" className={versionValid ? 'secondary' : 'ui-field__error'}>{versionValid ? text(locale, 'Older versions must update. Leave empty to remove the minimum.', 'يلزم تحديث الإصدارات الأقدم. اتركه فارغًا لإلغاء الحد الأدنى.') : text(locale, 'Enter a version such as 1.2.32.', 'أدخل إصدارًا مثل 1.2.32.')}</small></FormField>
      </div><Checkbox checked={draft.mandatory_update_enabled} onChange={(event) => edit({ mandatory_update_enabled: event.target.checked })} label={label('mandatory_update_enabled')} /><p className="secondary">{text(locale, 'Either mandatory update mode or this setting requests the available update.', 'الوضع الإجباري أو تفعيل هذا الإعداد يكفي لطلب التحديث المتاح.')}</p></fieldset>
      <fieldset disabled={frozen} className="admin-policy-fields"><legend>{text(locale, 'Access', 'الوصول')}</legend><Checkbox checked={draft.kill_switch_enabled} onChange={(event) => edit({ kill_switch_enabled: event.target.checked })} label={label('kill_switch_enabled')} />{draft.kill_switch_enabled ? <Alert tone="warning" title={text(locale, 'Clients will receive a global access-stop decision.', 'سيتلقى العملاء قرارًا بإيقاف الوصول العام.')} /> : null}</fieldset>
      <FormField label={text(locale, 'Reason for change', 'سبب التغيير')} htmlFor="global-policy-reason" required><Textarea id="global-policy-reason" required minLength={3} maxLength={1000} disabled={frozen} value={reason} onChange={(event) => setSession({ base, draft, reason: event.target.value })} /></FormField>
      <div className="cluster"><Button variant="primary" disabled={!dirty || !versionValid || reason.trim().length < 3 || stale || changed || frozen}>{text(locale, 'Review changes', 'مراجعة التغييرات')}</Button><Button type="button" disabled={!session || frozen} onClick={() => setDiscardOpen(true)}>{text(locale, 'Discard changes', 'إلغاء التعديلات')}</Button>{dirty ? <span className="secondary">{text(locale, 'Unsaved changes', 'تعديلات غير محفوظة')}</span> : null}</div>
    </form> : <dl className="detail-list">{(Object.keys(draft) as Array<keyof Values>).map((key) => <div key={key}><dt>{label(key)}</dt><dd>{display(key, draft[key])}</dd></div>)}</dl>}
    <Modal open={active && Boolean(review)} onClose={() => { if (!busy) { setReview(null); setFailure('') } }} closeDisabled={busy} closeLabel={text(locale, 'Close', 'إغلاق')} title={text(locale, 'Review policy changes', 'مراجعة تغييرات السياسة')} footer={<><Button onClick={() => { setReview(null); setFailure('') }} disabled={busy}>{text(locale, 'Back to editing', 'العودة للتعديل')}</Button><Button variant={draft.kill_switch_enabled ? 'danger' : 'primary'} loading={busy} onClick={apply} disabled={stale || changed || failure === 'changed'}>{failure === 'uncertain' ? text(locale, 'Retry same change', 'إعادة محاولة نفس التغيير') : text(locale, 'Apply policy', 'تطبيق السياسة')}</Button></>}>
      <div className="stack"><div className="table-scroll"><table className="admin-policy-diff"><thead><tr><th>{text(locale, 'Setting', 'الإعداد')}</th><th>{text(locale, 'Saved', 'المحفوظ')}</th><th>{text(locale, 'After applying', 'بعد التطبيق')}</th></tr></thead><tbody>{changes.map((key) => <tr key={key}><th>{label(key)}</th><td>{display(key, values(base)[key])}</td><td>{display(key, draft[key])}</td></tr>)}</tbody></table></div><p>{reason}</p>{draft.kill_switch_enabled ? <Alert tone="warning" title={text(locale, 'This applies to all clients using the global policy.', 'يشمل هذا التغيير كل العملاء الذين يستخدمون السياسة العامة.')} /> : <Badge>{text(locale, 'Existing feature and limit settings are unchanged.', 'إعدادات الخصائص والحدود الموجودة لن تتغيّر.')}</Badge>}{failure ? <Alert tone="danger" title={failure === 'changed' ? text(locale, 'The saved policy changed. Review the latest values first.', 'تغيّرت السياسة المحفوظة. راجع القيم الأحدث أولًا.') : text(locale, 'Saving could not be confirmed. Retry the same change without submitting a new one.', 'تعذّر تأكيد الحفظ. أعد محاولة نفس التغيير دون إرسال تغيير جديد.')} /> : null}</div>
    </Modal>
    <Modal open={active && discardOpen} onClose={() => setDiscardOpen(false)} title={text(locale, 'Discard this draft?', 'إلغاء هذه التعديلات؟')} closeLabel={text(locale, 'Close', 'إغلاق')} footer={<><Button onClick={() => setDiscardOpen(false)}>{text(locale, 'Keep editing', 'متابعة التعديل')}</Button><Button variant="danger" onClick={() => { setSession(null); setReview(null); setFailure(''); setDiscardOpen(false); setConfirmedSource(null) }}>{text(locale, 'Discard changes', 'إلغاء التعديلات')}</Button></>}><p>{text(locale, 'The form will return to the latest loaded policy. Nothing will be sent to clients.', 'سيعود النموذج إلى آخر سياسة تم تحميلها. لن يُرسل أي تغيير للعملاء.')}</p></Modal>
  </>
}
