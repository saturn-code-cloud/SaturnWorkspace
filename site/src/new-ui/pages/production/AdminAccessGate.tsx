import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { RefreshCcw, ShieldCheck } from 'lucide-react'
import type { AdminSession } from '../../../api/admin'
import { useAdapters } from '../../adapters/AdapterProvider'
import { useExperience } from '../../app/ExperienceProvider'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/DataDisplay'
import { Alert } from '../../components/ui/Feedback'
import { FormField, Input, PasswordInput } from '../../components/ui/FormControls'
import { GoogleIcon } from '../../components/icons/GoogleIcon'
import { Brand, LocaleControl, ThemeControl } from '../../layouts/SharedChrome'
import { adminLoginIssue, readAdminAccess, type AdminAccessState, type AdminLoginIssue } from './adminAccessState'

export function AdminAccessGate({ children }: { children: (session: AdminSession) => ReactNode }) {
  const { admin } = useAdapters()
  const { locale, t } = useExperience()
  const copy = (en: string, ar: string) => locale === 'ar' ? ar : en
  const [access, setAccess] = useState<AdminAccessState>({ status: 'checking' })
  const [attempt, setAttempt] = useState(0)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [issue, setIssue] = useState<AdminLoginIssue | null>(null)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const mounted = useRef(false)
  const submission = useRef<AbortController | null>(null)
  const checkRun = useRef(0)
  const recheck = useCallback(() => {
    checkRun.current += 1
    setIssue(null)
    setAccess({ status: 'checking' })
    setAttempt((value) => value + 1)
  }, [])

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; submission.current?.abort() }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const run = ++checkRun.current
    let active = true
    const timeout = window.setTimeout(() => controller.abort(), 15_000)
    void readAdminAccess(admin, controller.signal)
      .then((result) => { if (active && run === checkRun.current) setAccess(result) })
      .catch(() => { if (active && run === checkRun.current) setAccess({ status: 'unavailable' }) })
      .finally(() => window.clearTimeout(timeout))
    return () => { active = false; controller.abort(); window.clearTimeout(timeout) }
  }, [admin, attempt])

  useEffect(() => access.status === 'ready' ? admin.onIdentityChanged(recheck) : undefined, [access.status, admin, recheck])

  const signIn = async (event?: FormEvent) => {
    event?.preventDefault()
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setIssue(null)
    const credentials = access.status === 'preauth'
    const controller = new AbortController()
    submission.current = controller
    const timeout = credentials ? window.setTimeout(() => controller.abort(), 15_000) : undefined
    try {
      if (credentials) {
        const result = await admin.submitPreauth({ username: username.trim(), password }, controller.signal)
        if (!result.authenticated) { if (mounted.current) setIssue('credentials'); return }
        if (mounted.current) setPassword('')
      } else {
        await admin.signInWithGoogle()
      }
      if (mounted.current) recheck()
    } catch (error) {
      if (mounted.current) setIssue(adminLoginIssue(error))
    } finally {
      window.clearTimeout(timeout)
      if (submission.current === controller) submission.current = null
      inFlight.current = false
      if (mounted.current) setBusy(false)
    }
  }

  if (access.status === 'ready') return children(access.session)
  const issueText = issue === 'credentials' ? copy('The username or password is incorrect.', 'اسم المستخدم أو كلمة المرور غير صحيحة.')
    : issue === 'rate' ? copy('Too many attempts. Wait before trying again.', 'محاولات كثيرة. انتظر قليلًا ثم حاول مرة أخرى.')
    : issue === 'popup' ? copy('Allow pop-ups for this site, then try again.', 'اسمح بالنوافذ المنبثقة لهذا الموقع ثم حاول مرة أخرى.')
    : issue === 'cancelled' ? copy('Sign-in was not completed. You can try again.', 'لم يكتمل تسجيل الدخول. يمكنك المحاولة مرة أخرى.')
    : copy('Could not complete sign-in. Check your connection and try again.', 'تعذّر إكمال تسجيل الدخول. تحقّق من اتصالك وحاول مرة أخرى.')
  const denied = access.status === 'denied'
  const originDenied = denied && access.reason === 'origin'
  const title = access.status === 'checking' ? copy('Checking admin access', 'جار التحقق من صلاحية الإدارة')
    : access.status === 'unavailable' ? copy('Could not verify admin access', 'تعذّر التحقق من صلاحية الإدارة')
    : denied ? copy('Admin access unavailable', 'الدخول للإدارة غير متاح') : t('adminConsole')
  const body = access.status === 'checking' ? copy('Connecting to the admin service.', 'جار الاتصال بخدمة الإدارة.')
    : access.status === 'unavailable' ? copy('The service could not be reached or its response could not be verified. Check your connection and try again.', 'تعذّر الاتصال بالخدمة أو التحقق من ردّها. تحقّق من اتصالك وحاول مرة أخرى.')
    : originDenied ? copy('Open the admin console at admin.saturnws.com.', 'افتح لوحة الإدارة من admin.saturnws.com.')
    : denied && access.reason === 'unverified' ? copy('Verify the email for your Google account, then check access again.', 'أكّد بريد حساب Google ثم أعد التحقق من الصلاحية.')
    : denied ? copy('This account does not have admin access. Use an authorized Google account.', 'هذا الحساب لا يملك صلاحية الإدارة. استخدم حساب Google مخوّلًا.')
    : access.status === 'preauth' ? copy('Enter your admin credentials to continue.', 'أدخل بيانات الإدارة للمتابعة.')
    : copy('Continue with your authorized Google account.', 'تابع باستخدام حساب Google المخوّل للإدارة.')

  return <main className="admin-login" aria-busy={busy || access.status === 'checking'}>
    <header><Brand /><div className="cluster"><LocaleControl /><ThemeControl /></div></header>
    <Card className="admin-login__card">
      <span className="auth-icon" aria-hidden="true"><ShieldCheck size={23} /></span>
      <h1>{title}</h1><p role={access.status === 'checking' ? 'status' : undefined}>{body}</p>
      {access.status === 'preauth' ? <form className="stack" onSubmit={(event) => { void signIn(event) }}>
        <FormField label={copy('Admin username', 'اسم مستخدم الإدارة')} htmlFor="admin-user"><Input id="admin-user" autoComplete="username" required value={username} disabled={busy} aria-invalid={issue === 'credentials'} aria-describedby={issue ? 'admin-login-error' : undefined} onChange={(event) => { setUsername(event.target.value); setIssue(null) }} /></FormField>
        <FormField label={t('password')} htmlFor="admin-pass"><PasswordInput id="admin-pass" autoComplete="current-password" required value={password} disabled={busy} aria-invalid={issue === 'credentials'} aria-describedby={issue ? 'admin-login-error' : undefined} onChange={(event) => { setPassword(event.target.value); setIssue(null) }} /></FormField>
        {issue ? <div id="admin-login-error"><Alert title={issueText} tone="danger" /></div> : null}
        <Button type="submit" variant="primary" fullWidth loading={busy}>{t('continue')}</Button>
      </form> : <>
        {issue ? <Alert title={issueText} tone="danger" /> : null}
        {access.status === 'unavailable' || (denied && !originDenied) ? <Button type="button" variant={denied && access.reason === 'permission' ? 'secondary' : 'primary'} fullWidth disabled={busy} leadingIcon={<RefreshCcw size={16} />} onClick={recheck}>{t('retry')}</Button> : null}
        {access.status === 'signin' || (denied && !originDenied) ? <Button type="button" variant={denied && access.reason === 'unverified' ? 'secondary' : 'primary'} fullWidth loading={busy} leadingIcon={<GoogleIcon />} onClick={() => { void signIn() }}>{denied ? copy('Use another Google account', 'استخدام حساب Google آخر') : copy('Continue with Google', 'المتابعة عبر Google')}</Button> : null}
        {originDenied ? <a className="ui-button ui-button--primary ui-button--md ui-button--full" href="https://admin.saturnws.com/">admin.saturnws.com</a> : null}
      </>}
    </Card>
  </main>
}
