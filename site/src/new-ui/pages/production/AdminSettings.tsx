import { useState } from 'react'
import type { AdminSession } from '../../../api/admin'
import { useExperience } from '../../app/ExperienceProvider'
import { PageHeader } from '../../components/ui/DataDisplay'
import { Alert, Badge } from '../../components/ui/Feedback'
import { Button } from '../../components/ui/Button'
import { LocaleControl, ThemeControl } from '../../layouts/SharedChrome'
import { hasAdminPermission } from './adminAccess'

type Locale = 'ar' | 'en'
const text = (locale: Locale, en: string, ar: string) => locale === 'ar' ? ar : en
const ROLES: Record<AdminSession['role'], [string, string]> = { super_admin: ['Administrator', 'مدير كامل الصلاحيات'], support: ['Support', 'الدعم'], billing: ['Billing', 'الفوترة'], release_manager: ['Release manager', 'إدارة الإصدارات'], security_auditor: ['Security auditor', 'مراجعة الأمان'], read_only: ['Read only', 'عرض فقط'] }
const DOMAINS = [
  { name: ['Accounts and devices', 'الحسابات والأجهزة'], read: 'users:read', write: 'users:write' },
  { name: ['Subscriptions', 'الاشتراكات'], read: 'subscriptions:read', write: 'subscriptions:write' },
  { name: ['Support', 'الدعم'], read: 'admin:read', write: 'support:write' },
  { name: ['Email operations', 'عمليات البريد'], read: 'admin:read', write: 'communications:write' },
  { name: ['Promotion codes', 'الأكواد الترويجية'], read: 'admin:read', write: 'promotions:write' },
  { name: ['Orders and payments', 'الطلبات والمدفوعات'], read: 'commerce:read' },
  { name: ['Releases', 'الإصدارات'], read: 'releases:read', write: 'releases:write' },
  { name: ['Diagnostics and data', 'التشخيصات والبيانات'], read: 'diagnostics:read', write: 'diagnostics:write' },
  { name: ['Policies', 'السياسات'], read: 'policies:read', write: 'policies:write' },
  { name: ['Admin activity', 'سجل الإدارة'], read: 'audit:read' },
] as const

export function AdminSettings({ session }: { session: AdminSession }) {
  const { locale } = useExperience(); const [copyFailed, setCopyFailed] = useState(false)
  const language = locale === 'ar' ? 1 : 0
  const allowed = (permission: string) => hasAdminPermission(session.permissions, permission)
  return <div className="admin-settings stack">
    <PageHeader title={text(locale, 'Admin settings', 'إعدادات الإدارة')} />
    <section className="admin-settings-section" aria-labelledby="admin-settings-identity"><div><h2 id="admin-settings-identity">{text(locale, 'Account', 'الحساب')}</h2></div><div>
      <dl className="detail-list"><div><dt>{text(locale, 'Signed in as', 'مسجّل الدخول باسم')}</dt><dd><bdi>{session.email}</bdi></dd></div><div><dt>{text(locale, 'Role', 'الدور')}</dt><dd><Badge>{ROLES[session.role][language]}</Badge></dd></div></dl>
      <Button size="sm" onClick={async () => { try { await navigator.clipboard.writeText(session.email); setCopyFailed(false) } catch { setCopyFailed(true) } }}>{text(locale, 'Copy email', 'نسخ البريد')}</Button>
      {copyFailed ? <Alert tone="warning" title={text(locale, 'Copying is unavailable. Select the email above to copy it.', 'النسخ غير متاح. حدّد البريد بالأعلى لنسخه.')} /> : null}
    </div></section>
    <section className="admin-settings-section" aria-labelledby="admin-settings-appearance"><div><h2 id="admin-settings-appearance">{text(locale, 'Appearance and language', 'المظهر واللغة')}</h2><p className="secondary">{text(locale, 'Saved automatically in this browser.', 'تُحفظ تلقائيًا في هذا المتصفح.')}</p></div><div className="admin-settings-preferences"><div><span>{text(locale, 'Language', 'اللغة')}</span><LocaleControl /></div><div><span>{text(locale, 'Theme', 'المظهر')}</span><ThemeControl /></div></div></section>
    <section className="admin-settings-section" aria-labelledby="admin-settings-permissions"><div><h2 id="admin-settings-permissions">{text(locale, 'Account permissions', 'صلاحيات الحساب')}</h2><p className="secondary">{text(locale, 'Assigned by the server. These cannot be changed here.', 'يحددها إعداد الخادم، ولا تتغيّر من هذه الصفحة.')}</p></div><div className="stack">
      <table className="admin-settings-permissions"><caption className="sr-only">{text(locale, 'Read and change permissions by area', 'صلاحيات العرض والتغيير حسب القسم')}</caption><thead><tr><th scope="col">{text(locale, 'Area', 'القسم')}</th><th scope="col">{text(locale, 'View', 'عرض')}</th><th scope="col">{text(locale, 'Change', 'تغيير')}</th></tr></thead><tbody>{DOMAINS.map((domain) => <tr key={domain.read + domain.name[0]}><th scope="row">{domain.name[language]}</th><td>{allowed(domain.read) ? text(locale, 'Allowed', 'مسموح') : text(locale, 'Not allowed', 'غير مسموح')}</td><td>{'write' in domain ? allowed(domain.write) ? text(locale, 'Allowed', 'مسموح') : text(locale, 'Not allowed', 'غير مسموح') : text(locale, 'Read only', 'عرض فقط')}</td></tr>)}</tbody></table>
      <p>{text(locale, 'End desktop sessions:', 'إنهاء جلسات سطح المكتب:')} {allowed('sessions:revoke') ? text(locale, 'allowed', 'مسموح') : text(locale, 'not allowed', 'غير مسموح')}</p>
      <details><summary>{text(locale, 'Technical permission names', 'أسماء الصلاحيات التقنية')}</summary><ul className="admin-settings-technical">{session.permissions.map((permission) => <li key={permission}><bdi>{permission}</bdi></li>)}</ul></details>
    </div></section>
  </div>
}
