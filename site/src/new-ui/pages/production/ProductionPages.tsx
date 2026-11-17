import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, Archive, Bell, Check, CheckCheck, CreditCard, Download, KeyRound, LayoutDashboard, LifeBuoy, Mail, Monitor, ReceiptText, Settings, ShieldAlert, ShieldCheck, WalletCards } from 'lucide-react'
import type { AccountDeletionStatusResult, AccountSession, AccountSubscription } from '../../../api/account'
import { useAdapters } from '../../adapters/AdapterProvider'
import type { AccountNotification, CustomerSupportThread, PlanInfo, ReleaseInfo } from '../../adapters/contracts'
import { useExperience } from '../../app/ExperienceProvider'
import { activationFromQuery, clearActivationPayload, readActivationPayload, rememberActivationPayload, type ActivationPayload } from '../../app/desktopActivation'
import { createAuthRoute, createPricingReturnState, currentInternalLocation, readAuthIntent, readCheckoutPlan } from '../../app/navigationIntent'
import { routeFromInternalUrl } from '../../app/productionRouter'
import { Button } from '../../components/ui/Button'
import { CheckoutDialog } from '../../components/CheckoutDialog'
import { GoogleIcon } from '../../components/icons/GoogleIcon'
import { Card, DataTable, PageHeader, SectionHeader, TableToolbar, type Column } from '../../components/ui/DataDisplay'
import { Alert, Badge, CardSkeleton, EmptyState, FullPageState, Skeleton, SkeletonStack } from '../../components/ui/Feedback'
import { Checkbox, FormField, Input, OTPInput, PasswordInput, Select, Textarea } from '../../components/ui/FormControls'
import { Accordion } from '../../components/ui/Navigation'
import { ConfirmDialog, Drawer } from '../../components/ui/Overlays'
import { DownloadCard, PricingCard, SubscriptionCard } from '../../components/ui/ProductCards'
import { publicCopy } from '../../content/publicCopy'
import { CURRENT_TERMS_VERSION } from '../../content/legalContent'
import { isProductionFeatureEnabled } from '../../adapters/productionFeatureFlags'
import { PublicLayout, WorkspaceShell, type NavigationGroup } from '../../layouts/WorkspaceShell'
import { Brand, LocaleControl, ThemeControl } from '../../layouts/SharedChrome'
import appIcon from '../../assets/saturnws-app-icon.png'
import type { Navigate } from '../../app/routes'
import type { MessageKey } from '../../i18n/messages'
import { useAuthState } from '../../hooks/useAuthState'
import { useAsyncData } from '../../hooks/useAsyncData'
import { copyByLocale, formatBytes, formatDisplayDate } from './productionPresentation'
import { ErrorBlock } from './ProductionErrorBlock'
import { stableTicketNumber, supportErrorMessage, supportSenderRole, supportStatusLabel, supportStatusTone } from './productionSupport'
import { SupportThreadMessage } from './ProductionSupportMessage'
const PENDING_EMAIL_VERIFICATION_KEY = 'saturnws.production.pendingEmailVerification.v1'
const SIGNUP_PREFILL_KEY = 'saturnws.production.signupPrefill.v1'
const AUTH_BASE = 'https://auth.saturnws.com'

type PendingEmailVerificationContext = {
  kind: 'registration' | 'account'
  email: string
  registrationId?: string
  displayName?: string
  locale?: 'ar' | 'en'
  termsAccepted?: boolean
  termsVersion?: string
  termsAcceptedAt?: string
  verifiedAt?: string
  finalizationToken?: string
  finalizationExpiresAt?: string
  createdAt: string
}

type SignupPrefill = {
  email?: string
  displayName?: string
  termsAccepted?: boolean
}

type DeviceActivationFailurePayload = {
  error: string
  device_code?: string
  current_device_name?: string | null
  current_bound_at?: string | null
  request_status?: string | null
  request_id?: string | null
}

class DeviceActivationError extends Error {
  payload: DeviceActivationFailurePayload

  constructor(payload: DeviceActivationFailurePayload) {
    super(payload.error)
    this.name = 'DeviceActivationError'
    this.payload = payload
  }
}


function emailRequiredMessage(locale: 'ar' | 'en') {
  return copyByLocale(locale, 'Enter your email address.', 'اكتب البريد الإلكتروني.')
}

function secondsUntilResend(createdAt?: string, cooldownSeconds = 45): number {
  const created = Date.parse(String(createdAt || ''))
  if (!Number.isFinite(created)) return 0
  const elapsed = Math.floor((Date.now() - created) / 1000)
  return Math.max(0, cooldownSeconds - elapsed)
}

function retryAfterSecondsFromError(error: unknown): number | null {
  const direct = Number((error as { retryAfterSeconds?: unknown } | null)?.retryAfterSeconds)
  if (Number.isFinite(direct) && direct > 0) return Math.ceil(direct)
  const payload = (error as { payload?: unknown } | null)?.payload
  if (payload && typeof payload === 'object' && 'retry_after_seconds' in payload) {
    const value = Number((payload as { retry_after_seconds?: unknown }).retry_after_seconds)
    if (Number.isFinite(value) && value > 0) return Math.ceil(value)
  }
  return null
}

function formatWaitTime(locale: 'ar' | 'en', seconds: number): string {
  const safeSeconds = Math.max(1, Math.ceil(seconds))
  if (safeSeconds < 60) return locale === 'ar' ? `${safeSeconds} ثانية` : `${safeSeconds} seconds`
  const minutes = Math.ceil(safeSeconds / 60)
  return locale === 'ar' ? `${minutes} دقيقة` : `${minutes} minutes`
}

function normalizeEmailInput(value: unknown): string {
  return String(value || '').trim().toLowerCase()
}

function loadPendingEmailVerification(): PendingEmailVerificationContext | null {
  if (typeof window === 'undefined') return null
  const raw = window.sessionStorage.getItem(PENDING_EMAIL_VERIFICATION_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<PendingEmailVerificationContext>
    const email = normalizeEmailInput(parsed.email)
    if (!email || !email.includes('@')) return null
    const kind = parsed.kind === 'account' ? 'account' : 'registration'
    return {
      kind,
      email,
      registrationId: typeof parsed.registrationId === 'string' ? parsed.registrationId : undefined,
      displayName: typeof parsed.displayName === 'string' ? parsed.displayName : undefined,
      locale: parsed.locale === 'en' ? 'en' : 'ar',
      termsAccepted: Boolean(parsed.termsAccepted),
      termsVersion: typeof parsed.termsVersion === 'string' ? parsed.termsVersion : undefined,
      termsAcceptedAt: typeof parsed.termsAcceptedAt === 'string' ? parsed.termsAcceptedAt : undefined,
      verifiedAt: typeof parsed.verifiedAt === 'string' ? parsed.verifiedAt : undefined,
      finalizationToken: typeof parsed.finalizationToken === 'string' ? parsed.finalizationToken : undefined,
      finalizationExpiresAt: typeof parsed.finalizationExpiresAt === 'string' ? parsed.finalizationExpiresAt : undefined,
      createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date().toISOString(),
    }
  } catch {
    const email = normalizeEmailInput(raw)
    if (!email || !email.includes('@')) return null
    return { kind: 'account', email, createdAt: new Date().toISOString() }
  }
}

function savePendingEmailVerification(context: PendingEmailVerificationContext) {
  if (typeof window === 'undefined') return
  window.sessionStorage.setItem(PENDING_EMAIL_VERIFICATION_KEY, JSON.stringify({ ...context, email: normalizeEmailInput(context.email) }))
}

function clearPendingEmailVerification() {
  if (typeof window === 'undefined') return
  window.sessionStorage.removeItem(PENDING_EMAIL_VERIFICATION_KEY)
}

function loadSignupPrefill(): SignupPrefill | null {
  if (typeof window === 'undefined') return null
  const raw = window.sessionStorage.getItem(SIGNUP_PREFILL_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as SignupPrefill
    return {
      email: typeof parsed.email === 'string' ? parsed.email : undefined,
      displayName: typeof parsed.displayName === 'string' ? parsed.displayName : undefined,
      termsAccepted: Boolean(parsed.termsAccepted),
    }
  } catch {
    return null
  }
}

function saveSignupPrefill(input: SignupPrefill) {
  if (typeof window === 'undefined') return
  window.sessionStorage.setItem(SIGNUP_PREFILL_KEY, JSON.stringify(input))
}

function clearSignupPrefill() {
  if (typeof window === 'undefined') return
  window.sessionStorage.removeItem(SIGNUP_PREFILL_KEY)
}

async function completeDeviceActivation(idToken: string, activation: ActivationPayload) {
  const response = await fetch(`${AUTH_BASE}/device/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      id_token: idToken,
      ticket: activation.ticket,
      device_code: activation.ticket,
      user_code: activation.legacyCode || undefined,
    }),
  })
  const payload = await response.json().catch(() => null) as ({ success?: boolean } & Partial<DeviceActivationFailurePayload>) | null
  if (!response.ok || !payload?.success) {
    throw new DeviceActivationError({
      error: String(payload?.error || `device_link_failed_${response.status}`),
      device_code: payload?.device_code,
      current_device_name: payload?.current_device_name,
      current_bound_at: payload?.current_bound_at,
      request_status: payload?.request_status,
      request_id: payload?.request_id,
    })
  }
  clearActivationPayload()
  return payload
}

async function completeDeviceActivationWithCurrentToken(
  getIdToken: (forceRefresh?: boolean) => Promise<string | null>,
  activation: ActivationPayload,
) {
  let token = await getIdToken(false)
  if (!token) throw new Error('not_authenticated')
  try {
    return await completeDeviceActivation(token, activation)
  } catch (error) {
    const activationError = error instanceof DeviceActivationError
      ? String(error.payload.error || '').trim().toLowerCase()
      : ''
    if (activationError !== 'account_token_refresh_required') throw error
    token = await getIdToken(true)
    if (!token) throw new Error('not_authenticated', { cause: error })
    return completeDeviceActivation(token, activation)
  }
}









function deviceActivationErrorMessage(error: unknown, locale: 'ar' | 'en') {
  const raw = String(error instanceof Error ? error.message : error || '').trim()
  const key = raw.toLowerCase()
  if (key.includes('network') || key.includes('failed to fetch')) {
    return copyByLocale(locale, 'Unable to reach the account linking server. Try again from the desktop app.', 'تعذر الوصول إلى خادم ربط الحساب. حاول مرة أخرى من أداة سطح المكتب.')
  }
  if (key.includes('subscription')) {
    return copyByLocale(locale, 'This account does not have an active subscription for the desktop app.', 'هذا الحساب لا يملك اشتراكًا نشطًا لاستخدام أداة سطح المكتب.')
  }
  if (key === 'device_change_required') {
    return copyByLocale(locale, 'This account is already linked to another desktop device.', 'هذا الحساب مرتبط بالفعل بجهاز سطح مكتب آخر.')
  }
  if (key === 'account_token_refresh_required' || key === 'account_reauth_required') {
    return copyByLocale(locale, 'Your account session must be refreshed before linking. Sign in again from this page.', 'يلزم تجديد جلسة حسابك قبل الربط. سجّل الدخول مرة أخرى من هذه الصفحة.')
  }
  if (key === 'email_verification_required') {
    return copyByLocale(locale, 'Verify your email address before linking the desktop app.', 'أكّد بريدك الإلكتروني قبل ربط أداة سطح المكتب.')
  }
  if (key === 'profile_terms_required') {
    return copyByLocale(locale, 'Finish creating your Saturn account and accept the current terms before linking.', 'أكمل إنشاء حساب Saturn ووافق على الشروط الحالية قبل الربط.')
  }
  if (key === 'device_policy_unavailable') {
    return copyByLocale(locale, 'Device linking is temporarily unavailable. Try again shortly from the desktop app.', 'ربط الجهاز غير متاح مؤقتًا. حاول بعد قليل من أداة سطح المكتب.')
  }
  if (key === 'device_code_already_used') {
    return copyByLocale(locale, 'This desktop linking attempt was already completed. Start a new sign-in from the desktop app.', 'اكتملت محاولة ربط الأداة هذه بالفعل. ابدأ تسجيل دخول جديدًا من أداة سطح المكتب.')
  }
  if (key.includes('device_code_expired') || key.includes('not_found')) {
    return copyByLocale(locale, 'This desktop linking session expired. Start sign-in again from the desktop app.', 'انتهت صلاحية جلسة ربط الأداة. ابدأ تسجيل الدخول مرة أخرى من أداة سطح المكتب.')
  }
  return copyByLocale(locale, 'The desktop app could not be linked to this account. Try again from the desktop app.', 'تعذر ربط أداة سطح المكتب بهذا الحساب. حاول مرة أخرى من الأداة.')
}






function LoadingBlock({ label }: { label: string }) {
  void label
  return <Card><SkeletonStack rows={4} /></Card>
}

function PageHeaderSkeleton({ actions = false, description = false }: { actions?: boolean; description?: boolean }) {
  return <div aria-busy="true" className="skeleton-frame"><PageHeader title={<Skeleton width="180px" height={32} />} description={description ? <Skeleton width="360px" height={16} /> : undefined} actions={actions ? <Skeleton width="130px" height={40} /> : undefined} /></div>
}

function SectionHeaderSkeleton({ action = false, description = false }: { action?: boolean; description?: boolean }) {
  return <div aria-busy="true" className="skeleton-frame"><SectionHeader title={<Skeleton width="170px" height={23} />} description={description ? <Skeleton width="290px" height={15} /> : undefined} action={action ? <Skeleton width="76px" height={34} /> : undefined} /></div>
}

function SubscriptionSummarySkeleton() {
  return <div aria-busy="true" className="skeleton-frame"><SubscriptionCard title={<Skeleton width="150px" height={13} />} status={<Skeleton width="210px" height={28} />} tone="neutral" badgeLabel={<Skeleton width="86px" height={22} />} details={Array.from({ length: 4 }).map((_, index) => ({ label: <Skeleton width="68px" height={12} />, value: <Skeleton width={index % 2 ? '72%' : '86%'} height={18} /> }))} action={<Skeleton width="118px" height={40} />} /></div>
}

function DownloadCardSkeleton() {
  return <div aria-busy="true" className="skeleton-frame"><DownloadCard title={<Skeleton width="210px" height={23} />} version={<Skeleton width="160px" height={16} />} meta={[<Skeleton width="84px" height={20} />, <Skeleton width="112px" height={20} />]} buttonLabel={<Skeleton width="92px" height={16} />} disabled /></div>
}

function TablePanelSkeleton({ columns = 5, rows = 5 }: { columns?: number; rows?: number }) {
  return <div className="ui-table-wrap" aria-busy="true"><table className="ui-table"><thead><tr>{Array.from({ length: columns }).map((_, index) => <th key={index}><Skeleton width={index === 0 ? '48%' : '38%'} height={12} /></th>)}</tr></thead><tbody>{Array.from({ length: rows }).map((_, rowIndex) => <tr key={rowIndex}>{Array.from({ length: columns }).map((__, colIndex) => <td key={colIndex}><Skeleton width={colIndex === 0 ? '72%' : '56%'} height={14} /></td>)}</tr>)}</tbody></table></div>
}

function PortalOverviewSkeleton() {
  return <><PageHeaderSkeleton /><div className="portal-overview-grid"><div className="stack"><SubscriptionSummarySkeleton /><DownloadCardSkeleton /></div><aside className="portal-notices"><SectionHeaderSkeleton /><article><Skeleton width="30px" height={30} /><div><Skeleton width="120px" height={16} /><Skeleton width="180px" height={13} /></div></article></aside></div></>
}

function PortalSubscriptionSkeleton() {
  return <><PageHeaderSkeleton /><SubscriptionSummarySkeleton /></>
}

function PortalDownloadsSkeleton() {
  return <><PageHeaderSkeleton /><DownloadCardSkeleton /></>
}

function PortalSupportSkeleton() {
  return <><PageHeaderSkeleton /><div className="portal-two-column"><Card><SectionHeaderSkeleton /><div className="settings-form"><Skeleton width="100%" height={44} /><Skeleton width="100%" height={112} /><Skeleton width="132px" height={40} /></div></Card><Card><SectionHeaderSkeleton /><div className="ui-table-toolbar"><Skeleton width="260px" height={38} /><Skeleton width="140px" height={38} /></div><TablePanelSkeleton columns={5} rows={4} /></Card></div></>
}

function PortalSettingsSkeleton() {
  return <><PageHeaderSkeleton /><div className="settings-sections"><Card><SectionHeaderSkeleton /><div className="settings-form"><Skeleton width="100%" height={44} /><Skeleton width="100%" height={44} /><Skeleton width="140px" height={40} /></div></Card><Card><SectionHeaderSkeleton /><Skeleton width="180px" height={40} /></Card></div></>
}






function authErrorMessage(error: unknown, t: (key: MessageKey) => string, locale: 'ar' | 'en') {
  const raw = error instanceof Error ? error.message : String(error || '')
  const key = raw.toLowerCase()
  if (key.includes('auth_email_already_used') || key.includes('email-already-in-use')) return copyByLocale(locale, 'This email is already used.', 'هذا البريد مستخدم بالفعل.')
  if (key.includes('auth_weak_password') || key.includes('weak-password')) return copyByLocale(locale, 'The password is too weak.', 'كلمة المرور ضعيفة.')
  if (key.includes('auth_invalid_email') || key.includes('invalid-email')) return copyByLocale(locale, 'Enter a valid email address.', 'البريد الإلكتروني غير صحيح.')
  if (key.includes('auth_too_many_attempts') || key.includes('too-many-requests')) return copyByLocale(locale, 'Too many attempts. Try again later.', 'تمت محاولات كثيرة. حاول لاحقًا.')
  if (key.includes('auth_provider_collision')) return copyByLocale(locale, 'This email already has a password account. Enter its password to sign in and link Google.', 'هذا البريد مرتبط بحساب يستخدم كلمة مرور. اكتب كلمة المرور لتسجيل الدخول وربط Google بالحساب نفسه.')
  if (key.includes('auth_signup_required')) return copyByLocale(locale, 'No Saturn Workspace account exists for this Google address yet. Create an account first.', 'لا يوجد حساب Saturn Workspace لهذا البريد بعد. أنشئ حسابًا أولًا.')
  if (key.includes('verification_delivery_temporary_failure')) return copyByLocale(locale, 'The code could not be sent right now. Try again.', 'تعذر إرسال الرمز الآن. حاول مرة أخرى.')
  if (key.includes('verification_delivery_disabled') || key.includes('verification_delivery_not_configured') || key.includes('verification_delivery_configuration_error') || key.includes('verification_delivery_failed')) return copyByLocale(locale, 'Email verification is unavailable right now. Try again later.', 'التحقق بالبريد غير متاح حاليًا. حاول لاحقًا.')
  if (key.includes('auth_provider_server_create_not_configured') || key.includes('auth_provider_unavailable') || key.includes('registration_finalization_failed')) return copyByLocale(locale, 'Account creation is unavailable right now. Try again later.', 'إنشاء الحساب غير متاح حاليًا. حاول لاحقًا.')
  if (key.includes('verification_code_invalid') || key.includes('email_code_invalid')) return t('codeInvalid')
  if (key.includes('verification_code_expired') || key.includes('email_code_expired')) return t('codeExpired')
  if (key.includes('verification_rate_limited') || key.includes('email_resend_limited')) {
    const seconds = retryAfterSecondsFromError(error)
    return seconds
      ? copyByLocale(locale, `Too many attempts. Try again after ${formatWaitTime(locale, seconds)}.`, `محاولات كثيرة. حاول مرة أخرى بعد ${formatWaitTime(locale, seconds)}.`)
      : t('tooManyAttempts')
  }
  if (key.includes('profile_provisioning_failed')) return copyByLocale(locale, 'The account could not be prepared. Review the details and try again.', 'تعذر تجهيز الحساب. راجع البيانات وحاول مرة أخرى.')
  if (key.includes('invalid-credential') || key.includes('user-not-found') || key.includes('wrong-password') || key.includes('invalid_credentials')) return t('invalidCredentials')
  if (key.includes('email_verification_required')) return t('verificationBody')
  if (key.includes('network') || key.includes('failed to fetch') || key.includes('auth/network-request-failed')) return t('authUnavailable')
  return t('failed')
}

export function PublicProductionPages({ page, routeState, navigate }: { page: string; routeState?: string; navigate: Navigate }) {
  const { t, locale } = useExperience()
  const adapters = useAdapters()
  const { ready, user } = useAuthState()
  const c = publicCopy[locale]
  const plans = useAsyncData(() => adapters.plans.listPlans(locale), [adapters, locale])
  const release = useAsyncData(() => adapters.releases.getLatest('beta'), [adapters])
  let content: ReactNode
  if (page === 'pricing') content = <PricingSection page={page} routeState={routeState} plans={plans.data || []} loading={plans.loading} error={plans.error} reload={plans.reload} navigate={navigate} />
  else if (page === 'product' || page === 'features') content = <ProductDetailsSection />
  else if (page === 'download') content = <DownloadSection release={release.data} loading={release.loading} error={release.error} reload={release.reload} navigate={navigate} />
  else if (page === 'releases' || page === 'changelog') content = <ReleaseNotes release={release.data} loading={release.loading} error={release.error} />
  else if (page === 'faq') content = <FaqSection />
  else if (page === 'contact' || page === 'support') content = <PublicContact navigate={navigate} />
  else if (['privacy', 'terms', 'refund', 'acceptable-use', 'cookies'].includes(page)) content = <LegalSection page={page} />
  else if (page === '404') content = <FullPageState icon={ShieldAlert} title={t('system404')} body={t('systemBody')} primaryLabel={t('back')} onPrimary={() => navigate({ surface: 'public', page: 'home' })} />
  else {
    const primaryLabel = ready && user ? t('account') : c.heroPrimary
    const primaryAction = () => ready && user ? navigate({ surface: 'portal', page: 'overview' }) : navigate(createAuthRoute('signup', { returnTo: currentInternalLocation() }))
    content = <><section className="marketing-hero"><div className="container"><div className="marketing-hero__copy"><span className="announcement">{c.announcement}</span><h1>{c.heroTitle}</h1><p>{c.heroBody}</p><div className="hero-actions"><Button size="lg" variant="primary" disabled={!ready} onClick={primaryAction}>{primaryLabel}</Button><Button size="lg" variant="ghost" onClick={() => navigate({ surface: 'public', page: 'pricing' })}>{t('pricing')}</Button></div><ul><li><Monitor size={15} />{c.proofOne}</li><li><ShieldCheck size={15} />{c.proofTwo}</li><li><Download size={15} />{c.proofThree}</li></ul></div><Card className="hero-product-reveal"><SectionHeader title={c.sessionsTitle} description={c.sessionsBody} /><div className="value-line"><span>{c.stepAccount}</span><span>{c.stepProfile}</span><span>{c.stepLaunch}</span></div></Card></div></section><section className="marketing-section"><div className="container split-feature"><div><span className="section-index">01</span><SectionHeader title={c.accountsTitle} description={c.accountsBody} /></div><Card><SectionHeader title={c.backupTitle} description={c.backupBody} /></Card></div></section><PricingSection page={page} routeState={routeState} plans={plans.data || []} loading={plans.loading} error={plans.error} reload={plans.reload} navigate={navigate} compact /><section className="final-cta"><div className="container"><div><h2>{c.finalTitle}</h2><p>{c.finalBody}</p></div><Button size="lg" variant="primary" disabled={!ready} onClick={primaryAction}>{primaryLabel}</Button></div></section></>
  }
  return <PublicLayout navigate={navigate}>{content}</PublicLayout>
}

function ProductDetailsSection() {
  const { locale } = useExperience()
  const c = publicCopy[locale]
  const sections = [
    { title: c.sessionsTitle, body: c.sessionsBody },
    { title: c.accountsTitle, body: c.accountsBody },
    { title: c.backupTitle, body: c.backupBody },
    { title: c.proxyTitle, body: c.proxyBody },
  ]
  return <section className="marketing-section page-enter"><div className="container"><header className="marketing-heading marketing-heading--center marketing-heading--wide"><h1>{c.productPageTitle}</h1><p>{c.productPageBody}</p></header><div className="feature-grid">{sections.map((section) => <Card key={section.title}><SectionHeader title={section.title} description={section.body} /></Card>)}</div></div></section>
}

function PricingSection({ page, routeState, plans, loading, error, reload, navigate, compact = false }: { page: string; routeState?: string; plans: PlanInfo[]; loading: boolean; error: string | null; reload: () => void; navigate: Navigate; compact?: boolean }) {
  const { t, locale } = useExperience()
  const { ready, user } = useAuthState()
  const c = publicCopy[locale]
  const checkoutFeaturesForPlan = (plan: PlanInfo | null) => plan ? [c.featureWorkspace] : []
  const [selectedPlan, setSelectedPlan] = useState<PlanInfo | null>(null)
  const requestedPlan = readCheckoutPlan(routeState)
  const requestedCheckoutPlan = ready && user && requestedPlan && !loading
    ? plans.find((plan) => plan.id === requestedPlan) ?? null
    : null
  const activeCheckoutPlan = selectedPlan ?? requestedCheckoutPlan
  const choosePlan = (plan: PlanInfo) => {
    if (!ready || !plan.enabled || !plan.checkoutEnabled) return
    if (!user) {
      navigate(createAuthRoute('signup', { returnTo: currentInternalLocation().split('?')[0], plan: plan.id, checkout: true }))
      return
    }
    setSelectedPlan(plan)
  }
  const closeCheckout = () => {
    setSelectedPlan(null)
    if (requestedPlan) navigate({ surface: 'public', page })
  }
  const getCta = (plan: PlanInfo) => {
    if (!ready) return t('loading')
    if (!plan.enabled || !plan.checkoutEnabled) return copyByLocale(locale, 'Not available', 'غير متاح حاليًا')
    return user ? copyByLocale(locale, 'Subscribe', 'اشترك') : t('signUp')
  }
  const trialNoteForPlan = (plan: PlanInfo) => {
    if (plan.id !== 'monthly' && plan.id !== 'annual') return ''
    const days = Number(plan.trialDays || 0)
    if (!Number.isFinite(days) || days <= 0) return ''
    return copyByLocale(locale, `${days} days free trial`, `${days} أيام تجربة مجانية`)
  }
  return <section className={`marketing-section pricing-section${compact ? '' : ' pricing-page'}`}><div className="container"><header className="marketing-heading marketing-heading--center marketing-heading--wide">{compact ? <h2>{c.pricingTitle}</h2> : <h1>{c.pricingTitle}</h1>}<p>{c.pricingBody}</p></header>{loading ? <LoadingBlock label={t('loading')} /> : error ? <EmptyState icon={CreditCard} title={copyByLocale(locale, 'Prices could not be loaded', 'تعذر تحميل الأسعار')} body={copyByLocale(locale, 'Try again to load the available plans.', 'أعد المحاولة لتحميل الخطط المتاحة.')} action={<Button onClick={reload}>{t('retry')}</Button>} /> : plans.length ? <div className="pricing-grid">{plans.map((plan) => {
    return <PricingCard key={`${plan.id}:${plan.version}`} name={plan.name} price={plan.price} originalPrice={plan.originalPrice} period={plan.period} note={trialNoteForPlan(plan)} features={[]} cta={getCta(plan)} featured={plan.id === 'monthly'} featuredLabel={c.recommended} disabled={!ready || !plan.enabled || !plan.checkoutEnabled} onClick={() => choosePlan(plan)} />
  })}</div> : <EmptyState icon={CreditCard} title={copyByLocale(locale, 'No plans are published', 'لا توجد خطط منشورة')} body="" />}</div><CheckoutDialog open={Boolean(activeCheckoutPlan)} plan={activeCheckoutPlan} user={user} features={checkoutFeaturesForPlan(activeCheckoutPlan)} onClose={closeCheckout} /></section>
}

function FaqSection() {
  const { locale } = useExperience()
  const c = publicCopy[locale]
  const items = [
    { id: 'windows', title: c.faqWindows, body: c.faqWindowsBody },
    { id: 'profiles', title: c.faqProfiles, body: c.faqProfilesBody },
    { id: 'backup', title: c.faqBackup, body: c.faqBackupBody },
    { id: 'proxy', title: c.faqProxy, body: c.faqProxyBody },
  ]
  return <section className="marketing-section faq-section page-enter"><div className="container narrow-page"><header className="marketing-heading marketing-heading--center"><h1>{c.faqTitle}</h1></header><Accordion items={items} /></div></section>
}

function DownloadSection({ release, loading, error, reload, navigate }: { release: ReleaseInfo | null; loading: boolean; error: string | null; reload: () => void; navigate: Navigate }) {
  const { t, locale } = useExperience()
  const adapters = useAdapters()
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')
  if (loading) return <div className="marketing-section"><div className="container narrow-page"><LoadingBlock label={t('loading')} /></div></div>
  const meta = [
    release?.version ? `${t('version')}: ${release.version}` : '',
    release?.architecture || '',
    formatBytes(release?.sizeBytes),
    release?.filename || '',
  ].filter(Boolean)
  const startDownload = async () => {
    if (!release?.releaseId) return
    setDownloading(true)
    setDownloadError('')
    try {
      await adapters.releases.download(release.releaseId, release.filename)
    } catch {
      setDownloadError(t('downloadError'))
    } finally {
      setDownloading(false)
    }
  }
  const unavailableAction = release?.accessState === 'signed_out'
    ? <Button onClick={() => navigate(createAuthRoute('signin', { returnTo: '/download' }))}>{t('signIn')}</Button>
    : release?.accessState === 'not_entitled'
      ? <Button onClick={() => navigate({ surface: 'public', page: 'pricing' })}>{t('pricing')}</Button>
      : <Button onClick={reload}>{t('retry')}</Button>
  return <div className="marketing-section page-enter"><div className="container narrow-page"><header className="marketing-heading marketing-heading--center"><img className="download-product-icon" src={appIcon} alt="" /><h1>{t('downloadTitle')}</h1><p>{t('downloadBody')}</p></header>{error ? <ErrorBlock error={error} onRetry={reload} /> : release?.available && release.releaseId ? <><Card className="download-simple-card"><div><span className="download-simple-card__mark"><Download size={25} /></span><h2>{t('downloadForWindows')}</h2><p>{copyByLocale(locale, 'Get the current Windows package published for Saturn Workspace.', 'نزّل حزمة Windows الحالية المنشورة لـ Saturn Workspace.')}</p><div className="download-simple-card__meta">{meta.map((item) => <span key={item}>{item}</span>)}</div></div><Button size="lg" variant="primary" leadingIcon={<Download size={17} />} loading={downloading} onClick={() => void startDownload()}>{t('downloadForWindows')}</Button></Card>{downloadError ? <Alert title={t('downloadError')} tone="danger">{downloadError}</Alert> : null}</> : <EmptyState icon={Download} title={t('noRelease')} body={release?.accessState === 'not_entitled' ? t('subscriptionReviewBody') : t('releaseUnavailable')} action={unavailableAction} />}</div></div>
}

function ReleaseNotes({ release, loading, error }: { release: ReleaseInfo | null; loading: boolean; error: string | null }) {
  const { t } = useExperience()
  return <div className="marketing-section page-enter"><div className="container narrow-page"><header className="marketing-heading marketing-heading--center"><h1>{t('releases')}</h1></header>{loading ? <LoadingBlock label={t('loading')} /> : error ? <ErrorBlock error={error} /> : <Card><dl className="detail-list"><div><dt>{t('version')}</dt><dd>{release?.version || t('unavailable')}</dd></div><div><dt>{t('status')}</dt><dd>{release?.available ? t('active') : t('unavailable')}</dd></div><div><dt>{t('releaseNotes')}</dt><dd>{release?.notes || t('releaseUnavailable')}</dd></div></dl></Card>}</div></div>
}

function PublicContact({ navigate }: { navigate: Navigate }) {
  const { t, locale } = useExperience()
  const { ready, user } = useAuthState()
  const supportRoute = ready && user ? { surface: 'portal' as const, page: 'support' } : createAuthRoute('signin', { returnTo: '/account/support' })
  const channels = [
    { title: copyByLocale(locale, 'Billing', 'الفوترة'), body: copyByLocale(locale, 'Invoices, renewal, and subscription questions.', 'الفواتير والتجديد وأسئلة الاشتراك.'), email: 'billing@saturnws.com', icon: CreditCard },
    { title: copyByLocale(locale, 'Security', 'الأمان'), body: copyByLocale(locale, 'Account access, device activity, and privacy concerns.', 'الوصول للحساب ونشاط الأجهزة وطلبات الخصوصية.'), email: 'security@saturnws.com', icon: ShieldCheck },
    { title: copyByLocale(locale, 'General', 'استفسار عام'), body: copyByLocale(locale, 'Product questions before creating an account.', 'أسئلة المنتج قبل إنشاء الحساب.'), email: 'hello@saturnws.com', icon: Mail },
  ]
  return <div className="marketing-section page-enter"><div className="container contact-page"><header className="marketing-heading marketing-heading--center"><LifeBuoy size={28} /><h1>{t('contact')}</h1><p>{copyByLocale(locale, 'Choose the topic that matches your request.', 'اختر الموضوع المناسب لطلبك.')}</p></header><div className="contact-grid">{channels.map(({ title, body, email, icon: Icon }) => <Card key={title}><SectionHeader title={title} description={<>{body}<a className="contact-email" href={`mailto:${email}`}>{email}</a></>} action={<Icon size={18} />} /></Card>)}<Card className="contact-support-card"><SectionHeader title={t('support')} description={copyByLocale(locale, 'For account help, create a ticket after signing in.', 'للمساعدة المتعلقة بالحساب، أنشئ تذكرة بعد تسجيل الدخول.')} /><div className="cluster"><Button variant="primary" disabled={!ready} onClick={() => navigate(supportRoute)}>{t('createTicket')}</Button><Button variant="secondary" onClick={() => navigate({ surface: 'public', page: 'faq' })}>{t('faq')}</Button></div></Card></div></div></div>
}

function LegalSection({ page }: { page: string }) {
  const { t, locale } = useExperience()
  const adapters = useAdapters()
  const legal = useAsyncData(() => adapters.content.getLegalPage(page, locale), [adapters, page, locale])
  return <div className="marketing-section page-enter"><article className="container legal-document">{legal.loading ? <LoadingBlock label={t('loading')} /> : legal.error ? <ErrorBlock error={legal.error} /> : <><h1>{legal.data?.title}</h1><p>{legal.data?.body}</p></>}</article></div>
}

export function AuthProductionPages({ page, routeState, navigate }: { page: string; routeState?: string; navigate: Navigate }) {
  if (page === 'linked') return <DeviceLinkedProductionPage navigate={navigate} />
  if (page === 'verify') return <EmailVerificationProductionPage routeState={routeState} navigate={navigate} />
  return <EmailPasswordProductionPage page={page} routeState={routeState} navigate={navigate} />
}

function ProductionAuthShell({ children, navigate }: { children: ReactNode; navigate: Navigate }) {
  const { t, locale } = useExperience()
  const Arrow = locale === 'ar' ? ArrowRight : ArrowLeft
  return <main className="auth-shell"><header className="auth-header"><Brand onClick={() => navigate({ surface: 'public', page: 'home' })} /><div><LocaleControl /><ThemeControl /></div></header><section className="auth-main"><div className="auth-form-wrap">{children}</div><Button className="auth-back" variant="ghost" leadingIcon={<Arrow size={16} />} onClick={() => navigate({ surface: 'public', page: 'home' })}>{t('back')}</Button></section></main>
}

function destinationAfterAuth(routeState?: string) {
  const intent = readAuthIntent(routeState)
  const destination = routeFromInternalUrl(intent.returnTo || '/account')
  if (intent.checkout && intent.plan) return { ...destination, state: createPricingReturnState(intent.plan) }
  return destination
}

function DeviceLinkedProductionPage({ navigate }: { navigate: Navigate }) {
  const { t, locale } = useExperience()
  return <ProductionAuthShell navigate={navigate}><div className="auth-card"><div className="auth-form auth-form--center"><span className="auth-icon"><Check size={23} /></span><header><h1>{copyByLocale(locale, 'Desktop app linked', 'تم ربط أداة سطح المكتب')}</h1><p>{copyByLocale(locale, 'You can now return to Saturn Workspace or close this page.', 'يمكنك الآن الرجوع إلى Saturn Workspace أو إغلاق هذه الصفحة.')}</p></header><Button variant="primary" size="lg" fullWidth onClick={() => navigate({ surface: 'portal', page: 'overview' })}>{t('continue')}</Button></div></div></ProductionAuthShell>
}

function EmailPasswordProductionPage({ page, routeState, navigate }: { page: string; routeState?: string; navigate: Navigate }) {
  const { t, locale } = useExperience()
  const { auth, account } = useAdapters()
  const authState = useAuthState()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const [deviceChange, setDeviceChange] = useState<DeviceActivationFailurePayload | null>(null)
  const [deviceChangeReason, setDeviceChangeReason] = useState('')
  const [deviceChangeSubmitted, setDeviceChangeSubmitted] = useState(false)
  const signup = page === 'signup'
  const activationPayload = useMemo(() => readActivationPayload(routeState), [routeState])
  useEffect(() => {
    const incoming = activationFromQuery(routeState)
    if (incoming) rememberActivationPayload(incoming)
  }, [routeState])
  const completionStartedRef = useRef(false)
  const captureActivationError = useCallback((err: unknown) => {
    if (err instanceof DeviceActivationError && err.payload.error === 'device_change_required') {
      setDeviceChange(err.payload)
      setDeviceChangeSubmitted(err.payload.request_status === 'pending')
    }
    return deviceActivationErrorMessage(err, locale)
  }, [locale])
  const finishActivationIfNeeded = useCallback(async () => {
    if (!activationPayload) return false
    if (completionStartedRef.current) return true
    completionStartedRef.current = true
    try {
      await completeDeviceActivationWithCurrentToken(
        (forceRefresh) => auth.getIdToken(forceRefresh),
        activationPayload,
      )
    } catch (err) {
      captureActivationError(err)
      throw err
    }
    navigate({ surface: 'auth', page: 'linked' })
    return true
  }, [activationPayload, auth, captureActivationError, navigate])
  useEffect(() => {
    if (!signup) return
    const prefill = loadSignupPrefill()
    if (!prefill) return
    let active = true
    queueMicrotask(() => {
      if (!active) return
      setFullName(prefill.displayName || '')
      setEmail(prefill.email || '')
      setAcceptedTerms(Boolean(prefill.termsAccepted))
      clearSignupPrefill()
    })
    return () => {
      active = false
    }
  }, [signup])
  useEffect(() => {
    if (!activationPayload || !authState.ready || !authState.user || completionStartedRef.current) return
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setLoading(true)
      setError('')
      finishActivationIfNeeded()
        .catch((err) => {
          completionStartedRef.current = false
          if (!cancelled) setError(captureActivationError(err))
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    })
    return () => {
      cancelled = true
    }
  }, [activationPayload, authState.ready, authState.user, captureActivationError, finishActivationIfNeeded])
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (signup && !fullName.trim()) {
      setError(locale === 'ar' ? 'اكتب الاسم الكامل.' : 'Full name is required.')
      return
    }
    if (signup && !acceptedTerms) {
      setError(locale === 'ar' ? 'يجب الموافقة على شروط الخدمة وسياسة الخصوصية.' : 'You must agree to the Terms of Service and Privacy Policy.')
      return
    }
    setLoading(true)
    try {
      if (signup) {
        const termsAcceptedAt = new Date().toISOString()
        const registration = await auth.startEmailRegistration({
          displayName: fullName,
          email,
          locale,
          termsAccepted: acceptedTerms,
          termsVersion: CURRENT_TERMS_VERSION,
          termsAcceptedAt,
        })
        if (!registration.success || !registration.registrationId) throw new Error(registration.error || 'email_verification_failed')
        savePendingEmailVerification({
          kind: 'registration',
          email: registration.email || email,
          registrationId: registration.registrationId,
          displayName: fullName,
          locale,
          termsAccepted: acceptedTerms,
          termsVersion: CURRENT_TERMS_VERSION,
          termsAcceptedAt,
          createdAt: new Date().toISOString(),
        })
        navigate({ surface: 'auth', page: 'verify', state: routeState })
        return
      } else {
        await auth.signInWithEmail(email, password)
      }
      if (await finishActivationIfNeeded()) return
      navigate(destinationAfterAuth(routeState))
    } catch (err) {
      setError(activationPayload ? captureActivationError(err) : authErrorMessage(err, t, locale))
    } finally {
      setLoading(false)
    }
  }
  const reset = async () => {
    if (!email.trim()) {
      setError(emailRequiredMessage(locale))
      return
    }
    setLoading(true)
    setError('')
    try {
      await auth.sendPasswordReset(email)
      setNotice(locale === 'ar' ? 'أرسلنا رابط استعادة كلمة المرور إلى بريدك إذا كان الحساب مسجلًا.' : 'A password reset link was sent if this email is registered.')
    } catch (err) {
      setError(authErrorMessage(err, t, locale))
    } finally {
      setLoading(false)
    }
  }
  const submitDeviceChange = async (event: FormEvent) => {
    event.preventDefault()
    const deviceCode = String(deviceChange?.device_code || activationPayload?.ticket || '').trim()
    if (!deviceCode) {
      setError(deviceActivationErrorMessage(new Error('device_code_not_found'), locale))
      return
    }
    setLoading(true)
    setError('')
    try {
      await account.requestDeviceChange(deviceCode, deviceChangeReason.trim())
      setDeviceChangeSubmitted(true)
      clearActivationPayload()
    } catch (err) {
      setError(deviceActivationErrorMessage(err, locale))
    } finally {
      setLoading(false)
    }
  }
  if (deviceChange && authState.user) {
    return <ProductionAuthShell navigate={navigate}><div className="auth-card"><div className="auth-form"><header><h1>{copyByLocale(locale, 'Change desktop device', 'تغيير جهاز سطح المكتب')}</h1></header><dl className="detail-list"><div><dt>{copyByLocale(locale, 'Current device', 'الجهاز الحالي')}</dt><dd>{deviceChange.current_device_name || copyByLocale(locale, 'Desktop device', 'جهاز سطح مكتب')}</dd></div>{deviceChange.current_bound_at ? <div><dt>{copyByLocale(locale, 'Linked since', 'مرتبط منذ')}</dt><dd>{formatDisplayDate(deviceChange.current_bound_at, locale)}</dd></div> : null}</dl>{deviceChangeSubmitted ? <Alert title={copyByLocale(locale, 'Request pending', 'الطلب قيد المراجعة')} tone="info">{copyByLocale(locale, 'Keep Saturn Workspace open. The new device will continue automatically after approval.', 'اترك Saturn Workspace مفتوحًا. سيكمل الجهاز الجديد تلقائيًا بعد الموافقة.')}</Alert> : <form className="stack" onSubmit={submitDeviceChange}><FormField label={copyByLocale(locale, 'Reason (optional)', 'السبب (اختياري)')} htmlFor="device-change-reason"><Textarea id="device-change-reason" value={deviceChangeReason} maxLength={500} onChange={(event) => setDeviceChangeReason(event.target.value)} /></FormField>{error ? <Alert title={t('failed')} tone="danger">{error}</Alert> : null}<Button type="submit" variant="primary" size="lg" fullWidth loading={loading}>{copyByLocale(locale, 'Request device change', 'إرسال طلب تغيير الجهاز')}</Button></form>}</div></div></ProductionAuthShell>
  }
  return <ProductionAuthShell navigate={navigate}><div className={`auth-card auth-card--${signup ? 'signup' : 'signin'}`}><div className="auth-form"><header>{signup ? <span>{copyByLocale(locale, 'Create your workspace access', 'ابدأ إعداد مساحة عملك')}</span> : null}<h1>{signup ? t('signUpTitle') : t('signInTitle')}</h1><p>{activationPayload ? copyByLocale(locale, 'Sign in to link this desktop app session to your account.', 'سجّل الدخول لربط جلسة أداة سطح المكتب بحسابك.') : signup ? copyByLocale(locale, 'Create one account for subscriptions, downloads, support, and your desktop sign-in.', 'أنشئ حسابًا واحدًا للاشتراك والتنزيلات والدعم وتسجيل الدخول إلى الأداة.') : t('signInBody')}</p></header>{activationPayload ? <Alert title={copyByLocale(locale, 'Desktop linking', 'ربط أداة سطح المكتب')} tone="info">{copyByLocale(locale, 'After sign-in, Saturn Workspace will be linked automatically.', 'بعد تسجيل الدخول سيتم ربط Saturn Workspace تلقائيًا.')}</Alert> : null}<form className="stack" onSubmit={submit} noValidate>{signup ? <FormField label={locale === 'ar' ? 'الاسم الكامل' : 'Full name'} htmlFor="auth-full-name" required><Input id="auth-full-name" type="text" autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} required /></FormField> : null}<FormField label={t('email')} htmlFor="auth-email" required><Input id="auth-email" type="email" autoComplete="email" placeholder={locale === 'ar' ? 'name@example.com' : 'name@example.com'} value={email} onChange={(event) => setEmail(event.target.value)} required /></FormField>{!signup ? <FormField label={t('password')} htmlFor="auth-password" required><PasswordInput id="auth-password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></FormField> : null}{signup ? <><Checkbox checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} required label={<span>{locale === 'ar' ? 'أوافق على ' : 'I agree to the '}<a href="/terms">{t('terms')}</a>{locale === 'ar' ? ' و' : ' and the '}<a href="/privacy">{t('privacy')}</a></span>} /></> : <div className="auth-form__options"><Button type="button" variant="text" onClick={reset}>{t('forgotPassword')}</Button></div>}{error ? <Alert title={t('failed')} tone="danger">{error}</Alert> : null}{notice ? <Alert title={t('success')} tone="success">{notice}</Alert> : null}<Button type="submit" variant="primary" size="lg" fullWidth loading={loading}>{signup ? t('signUp') : t('signIn')}</Button></form><div className="auth-divider"><span>{t('orContinue')}</span></div><Button type="button" fullWidth size="lg" leadingIcon={<GoogleIcon />} onClick={async () => { setLoading(true); setError(''); try { if (signup && !acceptedTerms) { setError(locale === 'ar' ? 'يجب الموافقة على شروط الخدمة وسياسة الخصوصية.' : 'You must agree to the Terms of Service and Privacy Policy.'); return } await auth.signInWithGoogle(signup ? { locale, termsAccepted: acceptedTerms, termsVersion: CURRENT_TERMS_VERSION } : undefined); if (await finishActivationIfNeeded()) return; navigate(destinationAfterAuth(routeState)) } catch (err) { const collisionEmail = String(err instanceof Error ? err.message : '').match(/^AUTH_PROVIDER_COLLISION:(.+)$/i)?.[1]; if (collisionEmail) setEmail(collisionEmail); setError(activationPayload ? deviceActivationErrorMessage(err, locale) : authErrorMessage(err, t, locale)) } finally { setLoading(false) } }}>{t('continueGoogle')}</Button><p className="auth-switch">{signup ? t('haveAccount') : t('noAccount')} <button type="button" onClick={() => navigate({ surface: 'auth', page: signup ? 'signin' : 'signup', state: routeState })}>{signup ? t('signIn') : t('signUp')}</button></p></div></div></ProductionAuthShell>
}

function EmailVerificationProductionPage({ routeState, navigate }: { routeState?: string; navigate: Navigate }) {
  const { t, locale } = useExperience()
  const { auth } = useAdapters()
  const [pending, setPending] = useState<PendingEmailVerificationContext | null>(() => loadPendingEmailVerification())
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(() => secondsUntilResend(pending?.createdAt))
  const email = pending?.email || ''
  const passwordLongEnough = password.length >= 6
  const passwordsMatch = Boolean(confirmPassword) && password === confirmPassword
  const waitingForPassword = pending?.kind === 'registration' && Boolean(pending.finalizationToken && pending.registrationId)
  useEffect(() => {
    let active = true
    queueMicrotask(() => {
      if (active) setResendCooldown(secondsUntilResend(pending?.createdAt))
    })
    return () => {
      active = false
    }
  }, [pending?.createdAt, pending?.email])
  useEffect(() => {
    if (resendCooldown <= 0) return undefined
    const timer = window.setInterval(() => {
      setResendCooldown((value) => Math.max(0, value - 1))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [resendCooldown])
  const verify = async () => {
    if (!pending) {
      setError(copyByLocale(locale, 'Start registration again to request a new code.', 'ابدأ التسجيل مرة أخرى لطلب رمز جديد.'))
      return
    }
    setLoading(true)
    setError('')
    try {
      const result = await auth.verifyEmailCode({ email, code, registrationId: pending.registrationId })
      if (!result.success) throw new Error(result.error || 'EMAIL_CODE_INVALID')
      if (pending.kind === 'registration') {
        if (!result.finalizationToken || !result.registrationId) throw new Error('registration_finalization_failed')
        const next = {
          ...pending,
          registrationId: result.registrationId,
          verifiedAt: result.verifiedAt,
          finalizationToken: result.finalizationToken,
          finalizationExpiresAt: result.finalizationExpiresAt,
        }
        savePendingEmailVerification(next)
        setPending(next)
        setCode('')
        setNotice(t('success'))
        return
      }
      if (auth.provisionProfile) {
        await auth.provisionProfile({ locale: pending.locale || locale })
      }
      clearPendingEmailVerification()
      navigate(destinationAfterAuth(routeState))
    } catch (err) {
      setError(authErrorMessage(err, t, locale))
    } finally {
      setLoading(false)
    }
  }
  const finalize = async () => {
    if (!pending?.registrationId || !pending.finalizationToken) {
      setError(copyByLocale(locale, 'Verify your email before setting a password.', 'تحقق من البريد أولًا قبل تعيين كلمة المرور.'))
      return
    }
    if (!passwordLongEnough) {
      setError(copyByLocale(locale, 'Password must contain at least 6 characters.', 'يجب أن تتكون كلمة المرور من 6 أحرف على الأقل.'))
      return
    }
    if (!passwordsMatch) {
      setError(copyByLocale(locale, 'Passwords do not match.', 'كلمتا المرور غير متطابقتين.'))
      return
    }
    setLoading(true)
    setError('')
    try {
      await auth.finalizeEmailRegistration({ email, password, registrationId: pending.registrationId, finalizationToken: pending.finalizationToken })
      clearPendingEmailVerification()
      navigate(destinationAfterAuth(routeState))
    } catch (err) {
      setError(authErrorMessage(err, t, locale))
    } finally {
      setLoading(false)
    }
  }
  const resend = async () => {
    if (!pending) {
      setError(copyByLocale(locale, 'Start registration again to request a new code.', 'ابدأ التسجيل مرة أخرى لطلب رمز جديد.'))
      return
    }
    if (waitingForPassword) return
    if (resendCooldown > 0) {
      setNotice(copyByLocale(locale, `You can request a new code after ${formatWaitTime(locale, resendCooldown)}.`, `يمكنك طلب رمز جديد بعد ${formatWaitTime(locale, resendCooldown)}.`))
      return
    }
    setLoading(true)
    setError('')
    setNotice('')
    try {
      if (pending.kind === 'registration') {
        const result = await auth.startEmailRegistration({
          email,
          displayName: pending.displayName || '',
          locale: pending.locale || locale,
          termsAccepted: Boolean(pending.termsAccepted),
          termsVersion: pending.termsVersion,
          termsAcceptedAt: pending.termsAcceptedAt,
        })
        if (!result.success) throw new Error(result.error || 'EMAIL_RESEND_LIMITED')
        if (result.registrationId) {
          const next = { ...pending, registrationId: result.registrationId, finalizationToken: undefined, finalizationExpiresAt: undefined, verifiedAt: undefined, createdAt: new Date().toISOString() }
          savePendingEmailVerification(next)
          setPending(next)
        }
        setResendCooldown(result.resendAfterSeconds || 45)
      } else {
        const result = await auth.requestEmailVerification(email)
        if (!result.success) throw new Error(result.error || 'EMAIL_RESEND_LIMITED')
        const next = { ...pending, createdAt: new Date().toISOString() }
        savePendingEmailVerification(next)
        setPending(next)
        setResendCooldown(result.resendAfterSeconds || 45)
      }
      setNotice(t('success'))
    } catch (err) {
      const seconds = retryAfterSecondsFromError(err)
      if (seconds) setResendCooldown(seconds)
      setError(authErrorMessage(err, t, locale))
    } finally {
      setLoading(false)
    }
  }
  const changeEmail = async () => {
    if (!pending) {
      navigate({ surface: 'auth', page: 'signup', state: routeState })
      return
    }
    setLoading(true)
    setError('')
    try {
      if (!auth.cancelEmailVerification) throw new Error('verification_cancel_unavailable')
      const cancelled = await auth.cancelEmailVerification({ email, registrationId: pending.registrationId })
      if (!cancelled.success) throw new Error(cancelled.error || 'verification_cancel_failed')
      saveSignupPrefill({
        email,
        displayName: pending.displayName,
        termsAccepted: pending.termsAccepted,
      })
      clearPendingEmailVerification()
      setPending(null)
      if (pending.kind === 'account') await auth.signOut()
      navigate({ surface: 'auth', page: 'signup', state: routeState })
    } catch (err) {
      setError(authErrorMessage(err, t, locale))
    } finally {
      setLoading(false)
    }
  }
  if (!pending) {
    return <ProductionAuthShell navigate={navigate}><div className="auth-card"><div className="auth-form auth-form--center"><span className="auth-icon"><Mail size={23} /></span><header><h1>{t('verificationTitle')}</h1><p>{copyByLocale(locale, 'Create an account or sign in to request a verification code.', 'أنشئ حسابًا أو سجّل الدخول لطلب رمز تحقق.')}</p></header>{error ? <Alert title={t('failed')} tone="danger">{error}</Alert> : null}<Button type="button" variant="primary" size="lg" fullWidth onClick={() => navigate({ surface: 'auth', page: 'signup', state: routeState })}>{t('signUp')}</Button><Button type="button" variant="text" onClick={() => navigate({ surface: 'auth', page: 'signin', state: routeState })}>{t('signIn')}</Button></div></div></ProductionAuthShell>
  }
  return <ProductionAuthShell navigate={navigate}><div className="auth-card"><div className="auth-form auth-form--center"><span className="auth-icon"><Mail size={23} /></span><header><h1>{t('verificationTitle')}</h1><p>{waitingForPassword ? copyByLocale(locale, 'Set a password to finish creating your account.', 'عيّن كلمة مرور لإكمال إنشاء الحساب.') : t('verificationBody')}</p><div className="verification-destination"><span>{t('email')}</span><strong>{email}</strong></div></header><form className="stack" onSubmit={(event) => { event.preventDefault(); void (waitingForPassword ? finalize() : verify()) }}>{waitingForPassword ? <><FormField label={t('password')} htmlFor="registration-password" required><PasswordInput id="registration-password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></FormField><FormField label={t('confirmPassword')} htmlFor="registration-confirm-password" required error={confirmPassword && !passwordsMatch ? copyByLocale(locale, 'Passwords do not match.', 'كلمتا المرور غير متطابقتين.') : undefined}><PasswordInput id="registration-confirm-password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></FormField><div className="password-requirements" aria-live="polite"><strong>{copyByLocale(locale, 'Password requirements', 'متطلبات كلمة المرور')}</strong><span className={passwordLongEnough ? 'is-valid' : ''}><Check size={14} />{copyByLocale(locale, 'At least 6 characters', '6 أحرف على الأقل')}</span><span className={passwordsMatch ? 'is-valid' : ''}><Check size={14} />{copyByLocale(locale, 'Both passwords match', 'تطابق كلمتي المرور')}</span></div></> : <OTPInput value={code} onChange={setCode} label={t('codeLabel')} />}{error ? <Alert title={t('failed')} tone="danger">{error}</Alert> : null}{notice ? <Alert title={t('success')} tone="success">{notice}</Alert> : null}<Button type="submit" variant="primary" size="lg" fullWidth loading={loading} disabled={waitingForPassword ? !passwordLongEnough || !passwordsMatch : code.length !== 6}>{t('continue')}</Button>{!waitingForPassword ? <div className="cluster"><Button type="button" variant="text" onClick={resend} disabled={loading || resendCooldown > 0}>{resendCooldown > 0 ? copyByLocale(locale, `Resend after ${formatWaitTime(locale, resendCooldown)}`, `إعادة الإرسال بعد ${formatWaitTime(locale, resendCooldown)}`) : t('resend')}</Button><Button type="button" variant="text" onClick={() => void changeEmail()} disabled={loading}>{t('changeEmail')}</Button></div> : null}</form></div></div></ProductionAuthShell>
}

export function PortalProductionPages({ page, navigate }: { page: string; navigate: Navigate }) {
  const { t, locale } = useExperience()
  const authState = useAuthState()
  const groups = useMemo<NavigationGroup[]>(() => [{ items: [
    { id: 'overview', label: t('overview'), icon: LayoutDashboard },
    { id: 'subscription', label: t('subscription'), icon: CreditCard },
    { id: 'payments', label: t('payments'), icon: WalletCards },
    { id: 'downloads', label: t('downloads'), icon: Download },
    { id: 'devices', label: t('devices'), icon: Monitor },
    { id: 'notifications', label: t('notifications'), icon: Bell },
    { id: 'support', label: t('support'), icon: LifeBuoy },
    { id: 'security', label: t('security'), icon: ShieldCheck },
    { id: 'settings', label: t('settings'), icon: Settings },
  ] }], [t])
  const title = groups[0].items.find((item) => item.id === page)?.label || t('overview')
  if (!authState.ready) return <WorkspaceShell surface="portal" page={page} title={title} groups={groups} navigate={navigate}><PortalRouteSkeleton page={page} /></WorkspaceShell>
  if (!authState.user) return <FullPageState icon={KeyRound} title={t('signIn')} body={t('signInBody')} primaryLabel={t('signIn')} onPrimary={() => navigate(createAuthRoute('signin', { returnTo: currentInternalLocation() }))} secondaryLabel={t('signUp')} onSecondary={() => navigate(createAuthRoute('signup', { returnTo: currentInternalLocation() }))} />
  if (isProductionFeatureEnabled('emailVerification') && authState.emailVerificationState && !['verified', 'not_required'].includes(authState.emailVerificationState)) {
    return <FullPageState icon={Mail} title={t('verificationTitle')} body={copyByLocale(locale, 'Enter the code sent to your email to continue.', 'أدخل رمز التحقق المرسل إلى بريدك للمتابعة.')} primaryLabel={t('continue')} onPrimary={() => { savePendingEmailVerification({ kind: 'account', email: authState.user?.email || '', locale, createdAt: new Date().toISOString() }); navigate(createAuthRoute('verify', { returnTo: currentInternalLocation() })) }} />
  }
  return <WorkspaceShell surface="portal" page={page} title={title} groups={groups} navigate={navigate}>{page === 'subscription' ? <PortalSubscription /> : page === 'downloads' ? <PortalDownloads /> : page === 'support' ? <PortalSupport /> : page === 'security' || page === 'settings' ? <PortalSettings /> : page === 'payments' ? <PortalPayments /> : page === 'devices' ? <PortalDevices /> : page === 'notifications' ? <PortalNotifications navigate={navigate} /> : <PortalOverview navigate={navigate} />}</WorkspaceShell>
}

function PortalRouteSkeleton({ page }: { page: string }) {
  if (page === 'overview') return <PortalOverviewSkeleton />
  if (page === 'subscription') return <PortalSubscriptionSkeleton />
  if (page === 'downloads') return <PortalDownloadsSkeleton />
  if (page === 'support') return <PortalSupportSkeleton />
  if (page === 'security' || page === 'settings') return <PortalSettingsSkeleton />
  return <><PageHeaderSkeleton /><div className="portal-mini-grid"><CardSkeleton rows={4} /><CardSkeleton rows={4} /></div></>
}

function PortalOverview({ navigate }: { navigate: Navigate }) {
  const { t, locale } = useExperience()
  const adapters = useAdapters()
  const subscription = useAsyncData(() => adapters.account.getSubscription(), [adapters])
  const release = useAsyncData(() => adapters.releases.getLatest('beta'), [adapters])
  const notifications = useAsyncData(() => adapters.notifications.list({ limit: 3 }), [adapters])
  return <><PageHeader title={t('overview')} />{subscription.error ? <ErrorBlock error={subscription.error} onRetry={subscription.reload} /> : null}<div className="portal-overview-grid"><div className="stack"><SubscriptionSummary data={subscription.data} loading={subscription.loading} navigate={navigate} />{subscription.refreshing ? <Alert title={copyByLocale(locale, 'Refreshing account data', 'يتم تحديث بيانات الحساب')} tone="info" /> : null}<Card><SectionHeader title={t('latestRelease')} action={<Button variant="text" onClick={() => navigate({ surface: 'portal', page: 'downloads' })}>{t('viewAll')}</Button>} />{release.loading ? <SkeletonStack rows={4} /> : release.error ? <ErrorBlock error={release.error} onRetry={release.reload} /> : <DownloadCard title={t('downloadForWindows')} version={release.data?.version || t('unavailable')} meta={[release.data?.available ? t('active') : t('unavailable')]} buttonLabel={t('downloads')} disabled={!release.data?.available} onClick={() => navigate({ surface: 'portal', page: 'downloads' })} />}</Card></div><aside className="portal-notices"><SectionHeader title={t('notifications')} action={<Button variant="text" onClick={() => navigate({ surface: 'portal', page: 'notifications' })}>{t('viewAll')}</Button>} />{notifications.loading ? <SkeletonStack rows={3} /> : notifications.error ? <ErrorBlock error={notifications.error} onRetry={notifications.reload} /> : notifications.data?.items.length ? notifications.data.items.map((item) => <NotificationSummary key={item.id} item={item} locale={locale} />) : <Alert title={t('noNotifications')} tone="info">{copyByLocale(locale, 'Important account messages will appear here.', 'ستظهر رسائل الحساب المهمة هنا.')}</Alert>}</aside></div></>
}

function SubscriptionSummary({ data, loading, navigate }: { data: AccountSubscription | null; loading: boolean; navigate?: Navigate }) {
  const { t, locale } = useExperience()
  if (loading) return <SubscriptionSummarySkeleton />
  const sub = data?.current_subscription ?? data?.subscription
  const projection = data?.subscription_projection
  const noActiveSubscription = projection?.entitlement === 'no_subscription' || projection?.existence === 'none' || !sub
  if (noActiveSubscription) {
    return <SubscriptionCard title={t('subscriptionStatus')} status={copyByLocale(locale, 'No active subscription', 'لا يوجد اشتراك نشط')} tone="warning" badgeLabel={copyByLocale(locale, 'Not active', 'غير نشط')} details={[{ label: t('email'), value: data?.user?.email || '—' }]} action={navigate ? <Button variant="primary" onClick={() => navigate({ surface: 'public', page: 'pricing' })}>{t('pricing')}</Button> : undefined} />
  }
  return <SubscriptionCard title={t('subscriptionStatus')} status={sub?.plan || sub?.tier || projection?.plan_term || t('active')} tone={projection?.entitlement === 'payment_required' ? 'warning' : 'success'} badgeLabel={projection?.entitlement || sub?.status || t('active')} details={[{ label: t('email'), value: data?.user?.email || sub?.user_email || '—' }, { label: t('plan'), value: sub?.plan || sub?.tier || projection?.plan_term || t('planUnavailable') }, { label: t('expiresOn'), value: formatDisplayDate(sub?.expires_at || projection?.expires_at, locale) }, { label: t('status'), value: projection?.lifecycle || sub?.status || data?.status || '—' }]} />
}


function PortalSubscription() {
  const { t } = useExperience()
  const adapters = useAdapters()
  const subscription = useAsyncData(() => adapters.account.getSubscription(), [adapters])
  return <><PageHeader title={t('subscription')} />{subscription.error ? <ErrorBlock error={subscription.error} onRetry={subscription.reload} /> : <SubscriptionSummary data={subscription.data} loading={subscription.loading} />}</>
}

function PortalDownloads() {
  const { t } = useExperience()
  const adapters = useAdapters()
  const release = useAsyncData(() => adapters.releases.getLatest('beta'), [adapters])
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')
  const startDownload = async () => {
    if (!release.data?.releaseId) return
    setDownloading(true)
    setDownloadError('')
    try {
      await adapters.releases.download(release.data.releaseId, release.data.filename)
    } catch {
      setDownloadError(t('downloadError'))
    } finally {
      setDownloading(false)
    }
  }
  return <><PageHeader title={t('downloads')} />{release.loading ? <DownloadCardSkeleton /> : release.error ? <ErrorBlock error={release.error} onRetry={release.reload} /> : <><DownloadCard title={t('downloadForWindows')} version={release.data?.version || t('unavailable')} meta={[release.data?.filename || t('fileSize'), release.data?.sha256 || t('releaseNotes')]} buttonLabel={t('downloads')} disabled={!release.data?.available || downloading} onClick={() => void startDownload()} />{downloadError ? <Alert title={t('downloadError')} tone="danger">{downloadError}</Alert> : null}</>}</>
}

function PortalPayments() {
  const { t, locale } = useExperience()
  return <><PageHeader title={t('payments')} /><EmptyState icon={ReceiptText} title={t('noInvoices')} body={copyByLocale(locale, 'Contact support if you need help with a payment.', 'تواصل مع الدعم إذا احتجت مساعدة بخصوص دفعة.')} /></>
}

function PortalDevices() {
  const { t, locale } = useExperience()
  const adapters = useAdapters()
  const resource = useAsyncData(() => adapters.account.listSessions(), [adapters])
  const [target, setTarget] = useState<{ scope: 'session' | 'all'; session?: AccountSession } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const runRevoke = async () => {
    if (!target) return
    setBusy(true)
    setError('')
    try {
      if (target.scope === 'all') await adapters.account.revokeAllSessions()
      else if (target.session) await adapters.account.revokeSession(target.session.id, 'session')
      setTarget(null)
      resource.reload()
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err || 'REQUEST_FAILED'))
    } finally {
      setBusy(false)
    }
  }
  const sessions = resource.data?.sessions || []
  const binding = resource.data?.device_binding || null
  const changeRequests = resource.data?.device_change_requests || []
  const activeSessions = sessions.filter((session) => session.status === 'active')
  return <><PageHeader title={t('devices')} />{error ? <ErrorBlock error={error} onRetry={() => setError('')} /> : null}{resource.loading ? <SkeletonStack rows={5} /> : resource.error ? <ErrorBlock error={resource.error} onRetry={resource.reload} /> : !binding && sessions.length === 0 ? <EmptyState icon={Monitor} title={copyByLocale(locale, 'No desktop device linked', 'لا يوجد جهاز سطح مكتب مرتبط')} body={copyByLocale(locale, 'Link Saturn Workspace from the desktop app. One desktop device can be linked to each account.', 'اربط Saturn Workspace من أداة سطح المكتب. يمكن ربط جهاز سطح مكتب واحد بكل حساب.')} /> : <div className="stack"><section><SectionHeader title={copyByLocale(locale, 'Current desktop device', 'جهاز سطح المكتب الحالي')} action={activeSessions.length ? <Button size="sm" variant="danger" onClick={() => setTarget({ scope: 'all' })}>{copyByLocale(locale, 'End sessions', 'إنهاء الجلسات')}</Button> : undefined} />{binding ? <div className="device-row device-row--large"><span><Monitor size={20} /></span><div><strong>{binding.device_name || copyByLocale(locale, 'Desktop device', 'جهاز سطح مكتب')}</strong><small>{[binding.platform, binding.os_version, binding.app_version].filter(Boolean).join(' · ')}{binding.last_seen_at ? ` · ${copyByLocale(locale, 'Last activity', 'آخر نشاط')}: ${formatDisplayDate(binding.last_seen_at, locale)}` : ''}</small></div><Badge tone={activeSessions.length ? 'success' : 'neutral'}>{activeSessions.length ? copyByLocale(locale, 'Connected', 'متصل') : copyByLocale(locale, 'No active session', 'لا توجد جلسة نشطة')}</Badge></div> : null}</section>{sessions.length ? <section><SectionHeader title={copyByLocale(locale, 'Desktop sessions', 'جلسات سطح المكتب')} /><div className="settings-list">{sessions.map((session) => <div key={session.id} className="device-row device-row--large"><span><Monitor size={20} /></span><div><strong>{session.device_name}</strong><small>{copyByLocale(locale, 'Last activity', 'آخر نشاط')}: {formatDisplayDate(session.last_activity_at, locale)}{session.app_version ? ` · ${session.app_version}` : ''}</small></div><Badge tone={session.status === 'active' ? 'success' : session.status === 'expired' ? 'warning' : 'neutral'}>{session.status === 'active' ? copyByLocale(locale, 'Connected', 'متصل') : session.status === 'expired' ? copyByLocale(locale, 'Expired', 'منتهية') : copyByLocale(locale, 'Revoked', 'ملغاة')}</Badge>{session.status === 'active' ? <Button size="sm" variant="secondary" onClick={() => setTarget({ scope: 'session', session })}>{copyByLocale(locale, 'End session', 'إنهاء الجلسة')}</Button> : null}</div>)}</div></section> : null}{changeRequests.length ? <section><SectionHeader title={copyByLocale(locale, 'Device change requests', 'طلبات تغيير الجهاز')} /><div className="settings-list">{changeRequests.map((request) => <div key={request.id} className="device-row device-row--large"><span><Monitor size={20} /></span><div><strong>{request.device_name || copyByLocale(locale, 'New desktop device', 'جهاز سطح مكتب جديد')}</strong><small>{formatDisplayDate(request.requested_at, locale)}{request.resolution_note ? ` · ${request.resolution_note}` : ''}</small></div><Badge tone={request.status === 'approved' ? 'success' : request.status === 'pending' ? 'warning' : request.status === 'rejected' ? 'danger' : 'neutral'}>{request.status === 'approved' ? copyByLocale(locale, 'Approved', 'تمت الموافقة') : request.status === 'pending' ? copyByLocale(locale, 'Pending', 'قيد المراجعة') : request.status === 'rejected' ? copyByLocale(locale, 'Rejected', 'مرفوض') : copyByLocale(locale, 'Cancelled', 'ملغى')}</Badge></div>)}</div></section> : null}</div>}<ConfirmDialog open={Boolean(target)} onClose={() => { if (!busy) setTarget(null) }} title={target?.scope === 'all' ? copyByLocale(locale, 'End all desktop sessions?', 'إنهاء كل جلسات سطح المكتب؟') : copyByLocale(locale, 'End this session?', 'إنهاء هذه الجلسة؟')} body={copyByLocale(locale, 'Saturn Workspace will require sign-in again.', 'سيطلب Saturn Workspace تسجيل الدخول من جديد.')} confirmLabel={busy ? copyByLocale(locale, 'Ending…', 'جارٍ الإنهاء…') : copyByLocale(locale, 'Confirm', 'تأكيد')} cancelLabel={t('cancel')} destructive onConfirm={() => { void runRevoke() }} /></>
}

function notificationText(item: AccountNotification, locale: 'ar' | 'en') {
  return {
    title: locale === 'ar' ? item.titleAr || item.title : item.title,
    body: locale === 'ar' ? item.bodyAr || item.body : item.body,
  }
}

function NotificationSummary({ item, locale }: { item: AccountNotification; locale: 'ar' | 'en' }) {
  const content = notificationText(item, locale)
  return <article className={item.readAt ? 'is-read' : ''}><span><Bell size={17} /></span><div><strong>{content.title}</strong><p>{content.body}</p><small>{formatDisplayDate(item.createdAt, locale)}</small></div></article>
}

function PortalNotifications({ navigate }: { navigate: Navigate }) {
  const { t, locale } = useExperience()
  const { notifications } = useAdapters()
  const resource = useAsyncData(() => notifications.list({ limit: 20 }), [notifications])
  const [extraItems, setExtraItems] = useState<AccountNotification[]>([])
  const [paginationCursor, setPaginationCursor] = useState<string | null | undefined>()
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const items = [...(resource.data?.items || []), ...extraItems]
  const nextCursor = paginationCursor === undefined ? resource.data?.nextCursor : paginationCursor || undefined
  const refresh = () => {
    setExtraItems([])
    setPaginationCursor(undefined)
    resource.reload()
  }
  const markRead = async (item: AccountNotification) => {
    if (item.readAt || busy) return
    setBusy(item.id)
    setError('')
    try {
      await notifications.markRead(item.id)
      refresh()
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err || 'notification_update_failed'))
    } finally {
      setBusy('')
    }
  }
  const markAll = async () => {
    setBusy('all')
    setError('')
    try {
      await notifications.markAllRead()
      refresh()
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err || 'notification_update_failed'))
    } finally {
      setBusy('')
    }
  }
  const archive = async (item: AccountNotification) => {
    setBusy(`archive:${item.id}`)
    setError('')
    try {
      await notifications.archive(item.id)
      refresh()
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err || 'notification_update_failed'))
    } finally {
      setBusy('')
    }
  }
  const loadMore = async () => {
    if (!nextCursor || busy) return
    setBusy('more')
    setError('')
    try {
      const page = await notifications.list({ cursor: nextCursor, limit: 20 })
      setExtraItems((current) => [...current, ...page.items])
      setPaginationCursor(page.nextCursor || null)
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err || 'notification_load_failed'))
    } finally {
      setBusy('')
    }
  }

  return <><PageHeader title={t('notifications')} actions={resource.data?.unreadCount ? <Button size="sm" leadingIcon={<CheckCheck size={15} />} loading={busy === 'all'} onClick={() => { void markAll() }}>{copyByLocale(locale, 'Mark all as read', 'تحديد الكل كمقروء')}</Button> : undefined} />{error ? <ErrorBlock error={error} onRetry={() => setError('')} /> : null}{resource.loading ? <SkeletonStack rows={5} /> : resource.error ? <ErrorBlock error={resource.error} onRetry={resource.reload} /> : items.length === 0 ? <EmptyState icon={Bell} title={t('noNotifications')} body={copyByLocale(locale, 'Important account messages will appear here.', 'ستظهر رسائل الحساب المهمة هنا.')} /> : <div className="notification-list">{items.map((item) => { const content = notificationText(item, locale); return <Card key={item.id} padding="sm" className={item.readAt ? 'is-read' : ''}><div className="notification-row"><span><Bell size={18} /></span><button type="button" className="notification-copy" onClick={() => { void markRead(item) }} disabled={Boolean(busy)}><strong>{content.title}</strong><p>{content.body}</p><small>{formatDisplayDate(item.createdAt, locale)}</small></button><div className="cluster">{!item.readAt ? <Badge tone="info">{copyByLocale(locale, 'New', 'جديد')}</Badge> : null}{item.linkedResourceType === 'support_ticket' ? <Button size="sm" variant="text" onClick={() => navigate({ surface: 'portal', page: 'support' })}>{t('support')}</Button> : null}<Button size="sm" variant="text" leadingIcon={<Archive size={14} />} loading={busy === `archive:${item.id}`} onClick={() => { void archive(item) }}>{copyByLocale(locale, 'Dismiss', 'إخفاء')}</Button></div></div></Card>})}{nextCursor ? <Button variant="secondary" loading={busy === 'more'} onClick={() => { void loadMore() }}>{copyByLocale(locale, 'Load more', 'عرض المزيد')}</Button> : null}</div>}</>
}

function PortalSupport() {
  const { t, locale } = useExperience()
  const { support } = useAdapters()
  const [selected, setSelected] = useState<CustomerSupportThread | null>(null)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [reply, setReply] = useState('')
  const [ticketFiles, setTicketFiles] = useState<File[]>([])
  const [replyFiles, setReplyFiles] = useState<File[]>([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const threads = useAsyncData(() => support.listThreads(), [support])
  const thread = useAsyncData(() => selected ? support.getThread(selected.id) : Promise.resolve({ messages: [] }), [support, selected?.id])
  const visibleThreads = useMemo(() => {
    const query = search.trim().toLowerCase()
    return (threads.data || []).filter((row) => {
      const ticketNumber = stableTicketNumber(row.id, row.updatedAt)
      const status = String(row.status || 'open').toLowerCase()
      const matchesStatus = !statusFilter || status === statusFilter || (statusFilter === 'awaiting_customer' && ['waiting_for_customer', 'answered'].includes(status)) || (statusFilter === 'awaiting_support' && status === 'waiting_for_support')
      const matchesSearch = !query || row.subject.toLowerCase().includes(query) || ticketNumber.toLowerCase().includes(query)
      return matchesStatus && matchesSearch
    })
  }, [threads.data, search, statusFilter])

  const createTicket = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await support.createTicket({ subject, body, attachments: ticketFiles })
      if (!result.success) throw new Error(result.error || 'support_ticket_failed')
      setSubject('')
      setBody('')
      setTicketFiles([])
      setNotice(t('success'))
      threads.reload()
      if (result.threadId) setSelected({ id: result.threadId, subject, status: 'open', updatedAt: new Date().toISOString() })
    } catch (err) {
      setError(supportErrorMessage(err, locale))
    } finally {
      setBusy(false)
    }
  }

  const sendReply = async (event: FormEvent) => {
    event.preventDefault()
    if (!selected) return
    setBusy(true)
    setError('')
    try {
      const result = await support.replyThread(selected.id, reply, replyFiles)
      if (!result.success) throw new Error(result.error || 'support_reply_failed')
      setReply('')
      setReplyFiles([])
      setNotice(t('success'))
      thread.reload()
      threads.reload()
    } catch (err) {
      setError(supportErrorMessage(err, locale))
    } finally {
      setBusy(false)
    }
  }

  const setSelectedStatus = async (status: 'open' | 'closed') => {
    if (!selected) return
    setBusy(true)
    setError('')
    try {
      const result = await support.setThreadStatus(selected.id, status)
      if (!result.success) throw new Error(result.error || 'support_status_failed')
      setSelected({ ...selected, status: result.status || status, updatedAt: new Date().toISOString() })
      setNotice(t('success'))
      thread.reload()
      threads.reload()
    } catch (err) {
      setError(supportErrorMessage(err, locale))
    } finally {
      setBusy(false)
    }
  }

  const columns: Column<CustomerSupportThread>[] = [
    { key: 'ticket', header: '#', render: (row) => <strong>{stableTicketNumber(row.id, row.updatedAt)}</strong> },
    { key: 'subject', header: t('support'), render: (row) => <div><strong>{row.subject}</strong><small className="muted">{formatDisplayDate(row.lastMessageAt || row.updatedAt, locale)}</small></div> },
    { key: 'status', header: t('status'), render: (row) => <Badge tone={supportStatusTone(row.status)}>{supportStatusLabel(row.status, locale)}</Badge> },
    { key: 'unread', header: t('notifications'), render: (row) => row.unreadCount ? <Badge tone="info">{row.unreadCount}</Badge> : '0' },
    { key: 'updated', header: t('date'), render: (row) => formatDisplayDate(row.updatedAt, locale) },
  ]

  return (
    <>
      <PageHeader title={t('support')} />
      <div className="portal-two-column">
        <Card>
          <SectionHeader title={t('createTicket')} description={copyByLocale(locale, 'Use one ticket per issue.', 'استخدم تذكرة واحدة لكل طلب.')} />
          <form className="settings-form" onSubmit={createTicket}>
            <FormField label={t('details')} htmlFor="support-subject" required><Input id="support-subject" value={subject} maxLength={160} onChange={(event) => setSubject(event.target.value)} required /></FormField>
            <FormField label={t('support')} htmlFor="support-body" required><Textarea id="support-body" value={body} maxLength={4000} onChange={(event) => setBody(event.target.value)} required /></FormField>
            <FormField label={copyByLocale(locale, 'Attachments', 'المرفقات')} htmlFor="support-attachments"><Input id="support-attachments" type="file" accept="image/png,image/jpeg,application/pdf,text/plain" multiple onChange={(event) => setTicketFiles(Array.from(event.target.files || []).slice(0, 3))} /></FormField>
            <Button type="submit" variant="primary" loading={busy}>{t('createTicket')}</Button>
          </form>
        </Card>
        <Card>
          <SectionHeader title={t('recentSupport')} />
          <TableToolbar searchLabel={t('search')} searchValue={search} onSearch={setSearch} filters={<Select aria-label={t('status')} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">{t('status')}</option><option value="open">{supportStatusLabel('open', locale)}</option><option value="awaiting_support">{supportStatusLabel('awaiting_support', locale)}</option><option value="awaiting_customer">{supportStatusLabel('awaiting_customer', locale)}</option><option value="reopened">{supportStatusLabel('reopened', locale)}</option><option value="closed">{supportStatusLabel('closed', locale)}</option><option value="blocked">{supportStatusLabel('blocked', locale)}</option></Select>} />
          {threads.error ? <ErrorBlock error={supportErrorMessage(threads.error, locale)} onRetry={threads.reload} /> : <DataTable columns={columns} rows={visibleThreads} loading={threads.loading} rowKey={(row) => row.id} emptyTitle={t('tableEmpty')} emptyBody={copyByLocale(locale, 'Create a ticket when you need help.', 'أنشئ تذكرة عندما تحتاج إلى مساعدة.')} onRowClick={(row) => { setSelected(row); setError(''); setNotice('') }} rowAction={{ header: t('actions'), label: t('open'), accessibleLabel: (row) => copyByLocale(locale, `Open ticket ${row.subject}`, `فتح تذكرة ${row.subject}`) }} />}
        </Card>
      </div>
      {error ? <Alert title={t('failed')} tone="danger">{error}</Alert> : null}
      {notice ? <Alert title={t('success')} tone="success">{notice}</Alert> : null}
      <Drawer open={Boolean(selected)} onClose={() => setSelected(null)} title={selected ? stableTicketNumber(selected.id, selected.updatedAt) : t('support')} description={selected?.subject} closeLabel={t('close')}>
        <div className="support-ticket-meta"><Badge tone={supportStatusTone(thread.data?.thread?.status || selected?.status)}>{supportStatusLabel(thread.data?.thread?.status || selected?.status, locale)}</Badge><span>{formatDisplayDate(thread.data?.thread?.updatedAt || selected?.updatedAt, locale)}</span></div>
        {thread.error ? <ErrorBlock error={supportErrorMessage(thread.error, locale)} onRetry={thread.reload} /> : null}
        <div className="support-thread">{thread.loading ? <LoadingBlock label={t('loading')} /> : thread.data?.messages.filter((message) => supportSenderRole(message.sender, message.senderRole) !== 'internal_note').map((message) => <SupportThreadMessage key={message.id} message={message} locale={locale} />)}</div>
        {(thread.data?.thread?.status || selected?.status) === 'closed' ? <Alert title={supportStatusLabel('closed', locale)} tone="info" action={<Button size="sm" onClick={() => setSelectedStatus('open')} loading={busy}>{copyByLocale(locale, 'Reopen', 'إعادة فتح')}</Button>}>{copyByLocale(locale, 'This ticket is closed. Reopen it if you need to add another reply.', 'هذه التذكرة مغلقة. أعد فتحها إذا كنت تريد إضافة رد جديد.')}</Alert> : <form className="settings-form" onSubmit={sendReply}><FormField label={t('reply')} htmlFor="support-reply"><Textarea id="support-reply" value={reply} maxLength={4000} onChange={(event) => setReply(event.target.value)} required /></FormField><FormField label={copyByLocale(locale, 'Attachments', 'المرفقات')} htmlFor="support-reply-attachments"><Input id="support-reply-attachments" type="file" accept="image/png,image/jpeg,application/pdf,text/plain" multiple onChange={(event) => setReplyFiles(Array.from(event.target.files || []).slice(0, 3))} /></FormField><div className="cluster"><Button type="submit" variant="primary" loading={busy}>{t('reply')}</Button>{selected ? <Button type="button" onClick={() => setSelectedStatus('closed')} loading={busy}>{t('close')}</Button> : null}</div></form>}
      </Drawer>
    </>
  )
}

function PortalSettings() {
  const { t, locale } = useExperience()
  const { account } = useAdapters()
  const { user } = useAuthState()
  const [name, setName] = useState(user?.displayName || '')
  const [message, setMessage] = useState('')
  const [deletion, setDeletion] = useState<AccountDeletionStatusResult['deletion'] | null>(null)
  const [deletionLoading, setDeletionLoading] = useState(true)
  const [deletionBusy, setDeletionBusy] = useState(false)
  const [deletionReason, setDeletionReason] = useState('')
  const [error, setError] = useState('')

  const loadDeletion = useCallback(async () => {
    setDeletionLoading(true)
    setError('')
    try {
      const result = await account.getDeletionStatus()
      setDeletion(result.deletion)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'account_deletion_status_failed')
    } finally {
      setDeletionLoading(false)
    }
  }, [account])

  useEffect(() => {
    let active = true
    queueMicrotask(() => {
      if (active) void loadDeletion()
    })
    return () => {
      active = false
    }
  }, [loadDeletion])

  async function requestDeletion() {
    setDeletionBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await account.requestDeletion(deletionReason)
      setDeletion(result.deletion)
      setMessage(copyByLocale(locale, 'Account deletion request saved.', 'تم تسجيل طلب حذف الحساب.'))
    } catch (err) {
      const raw = String(err instanceof Error ? err.message : err || '')
      setError(raw === 'RECENT_AUTH_REQUIRED'
        ? copyByLocale(locale, 'Sign in again before requesting account deletion.', 'سجّل الدخول مرة أخرى قبل طلب حذف الحساب.')
        : raw)
    } finally {
      setDeletionBusy(false)
    }
  }

  async function cancelDeletion() {
    setDeletionBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await account.cancelDeletion()
      setDeletion(result.deletion)
      setMessage(copyByLocale(locale, 'Account deletion request cancelled.', 'تم إلغاء طلب حذف الحساب.'))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'account_deletion_cancel_failed')
    } finally {
      setDeletionBusy(false)
    }
  }

  const deletionState = String(deletion?.state || 'none')
  const deletionUnavailable = deletionState === 'unavailable'
  const pendingDeletion = deletionState === 'pending_deletion' || deletionState === 'deletion_due' || deletionState === 'on_hold'

  return <><PageHeader title={t('settings')} /><div className="settings-sections"><Card><SectionHeader title={t('profile')} /><form className="settings-form" onSubmit={async (event) => { event.preventDefault(); const next = await account.updateProfile({ displayName: name }); setName(next.displayName || ''); setMessage(t('success')) }}><FormField label={t('name')} htmlFor="profile-name"><Input id="profile-name" value={name} onChange={(event) => setName(event.target.value)} /></FormField><FormField label={t('email')} htmlFor="profile-email"><Input id="profile-email" value={user?.email || ''} readOnly /></FormField><Button variant="primary">{t('save')}</Button>{message ? <Alert title={message} tone="success" /> : null}</form></Card><Card><SectionHeader title={t('security')} /><Button onClick={async () => { await account.sendPasswordReset(); setMessage(t('passwordUpdated')) }}>{t('forgotPassword')}</Button></Card><Card><SectionHeader title={t('deleteAccount')} description={copyByLocale(locale, 'Request cancellation first. Final irreversible deletion is not available without a separate destructive approval.', 'ابدأ بطلب الحذف فقط. الحذف النهائي غير القابل للتراجع غير متاح بدون موافقة مدمّرة مستقلة.')} />{deletionLoading ? <SkeletonStack rows={3} /> : deletionUnavailable ? <Alert title={copyByLocale(locale, 'Account deletion is not available yet.', 'حذف الحساب غير متاح حاليًا.')} tone="warning">{copyByLocale(locale, 'The deletion request system is prepared but still waiting for its production database migration.', 'نظام طلبات الحذف جاهز في الواجهة لكنه بانتظار ترحيل قاعدة البيانات الإنتاجية.')}</Alert> : pendingDeletion ? <div className="stack"><Alert title={copyByLocale(locale, 'Deletion request pending', 'طلب الحذف قيد الانتظار')} tone={deletionState === 'on_hold' ? 'warning' : 'danger'}>{copyByLocale(locale, 'The account is marked pending deletion. You can cancel the request before final processing.', 'الحساب معلّم كطلب حذف قيد الانتظار. يمكنك إلغاء الطلب قبل المعالجة النهائية.')}</Alert><dl className="detail-list"><div><dt>{copyByLocale(locale, 'Requested', 'تاريخ الطلب')}</dt><dd>{formatDisplayDate(deletion?.request?.requested_at, locale)}</dd></div><div><dt>{copyByLocale(locale, 'Cooling-off ends', 'نهاية مهلة التراجع')}</dt><dd>{formatDisplayDate(deletion?.request?.cooling_off_until, locale)}</dd></div><div><dt>{copyByLocale(locale, 'Final purge', 'الحذف النهائي')}</dt><dd>{copyByLocale(locale, 'Disabled until explicit destructive approval.', 'معطّل حتى موافقة مدمّرة صريحة.')}</dd></div></dl><Button variant="secondary" loading={deletionBusy} onClick={() => void cancelDeletion()}>{copyByLocale(locale, 'Cancel deletion request', 'إلغاء طلب الحذف')}</Button></div> : <div className="stack"><FormField label={copyByLocale(locale, 'Reason (optional)', 'السبب (اختياري)')} htmlFor="deletion-reason"><Textarea id="deletion-reason" value={deletionReason} maxLength={500} onChange={(event) => setDeletionReason(event.target.value)} /></FormField><Button variant="danger" loading={deletionBusy} onClick={() => void requestDeletion()}>{t('deleteAccount')}</Button><Alert title={copyByLocale(locale, 'No immediate deletion', 'لا يوجد حذف فوري')} tone="info">{copyByLocale(locale, 'This creates a cancellable request and signs out linked desktop sessions. It does not purge user data.', 'هذا ينشئ طلبًا قابلًا للإلغاء وينهي جلسات سطح المكتب المرتبطة. لا يحذف بيانات المستخدم نهائيًا.')}</Alert></div>}{error ? <Alert title={t('failed')} tone="danger">{error}</Alert> : null}</Card></div></>
}







export function SystemProductionPages({ page, navigate }: { page: string; navigate: Navigate }) {
  const { t } = useExperience()
  const title = page === '403' ? t('system403') : page === '503' ? t('system503') : page === '500' ? t('system500') : t('system404')
  return <FullPageState icon={ShieldAlert} title={title} body={t('systemBody')} primaryLabel={t('back')} onPrimary={() => navigate({ surface: 'public', page: 'home' })} />
}
