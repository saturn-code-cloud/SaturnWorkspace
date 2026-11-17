import { formatMoneyMinor } from '../../lib/money'
import {
  GoogleAuthProvider,
  linkWithCredential,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from 'firebase/auth'
import { cancelAccountDeletion, fetchAccountDeletionStatus, fetchAccountSessions, fetchAccountSubscription, provisionAccountProfile, requestAccountDeletion, requestAccountDeviceChange, revokeAccountSession, revokeAllAccountSessions } from '../../api/account'
import {
  createSubscription,
  createPromoCode,
  updatePromoCodeState,
  executeManualSubscriptionGrant,
  fetchPendingSubscriptionGrantPage,
  cancelPendingSubscriptionGrant as cancelPendingSubscriptionGrantRequest,
  fetchAdminDashboard,
  fetchAdminCommercePage,
  fetchAdminCommerceConfiguration,
  fetchAdminCommerceOrder,
  fetchAdminUsers,
  fetchAdminDeviceChangeRequests,
  fetchAdminDeviceChangeRequest,
  fetchAdminPreauthState,
  fetchAdminSession,
  fetchAuditLog,
  fetchDiagnosticTriage,
  fetchDiagnosticCoverage,
  fetchCrashLog,
  fetchCrashLogs,
  fetchAdminEmailConfiguration,
  fetchAdminEmailActivity,
  fetchAdminEmailJob,
  fetchAdminPromoDirectory,
  fetchRemoteControls,
  fetchCurrentAdminRelease,
  fetchStagedAdminRelease,
  fetchSubscriptions,
  fetchAdminSupportConversation,
  fetchAdminSupportHistory,
  markAdminSupportMessagesRead,
  fetchSupportInbox,
  downloadAdminSupportAttachment,
  fetchUserDetail,
  fetchAdminReadiness,
  createAdminInvite,
  fetchAdminInviteDirectory,
  fetchAdminInviteDetail,
  revokeAdminInvite,
  fetchAdminPolicyDirectory,
  fetchAdminPolicyVersion,
  fetchAdminPolicyPlan,
  fetchAdminGlobalPolicy,
  updateAdminDisabledVersion,
  updateAdminGlobalPolicy,
  fetchTamperAlerts,
  executeAccessRevocation as executeAccessRevocationRequest,
  executeAccountLifecycle as executeAccountLifecycleRequest,
  executeSubscriptionTransition as executeSubscriptionTransitionRequest,
  previewAccessRevocation as previewAccessRevocationRequest,
  previewAccountLifecycle as previewAccountLifecycleRequest,
  previewSubscriptionTransition as previewSubscriptionTransitionRequest,
  previewAdminDeviceChange,
  executeAdminDeviceChange,
  previewAdminDeviceReset,
  executeAdminDeviceReset,
  resolveTamperAlert as resolveTamperAlertRequest,
  updateCrashGroupState as updateCrashGroupStateRequest,
  publishRelease,
  resetSubscriptionHwid,
  sendSupportReply,
  sendAdminTestEmail as sendAdminTestEmailRequest,
  setSupportBlocked,
  processEmailOutbox as processEmailOutboxRequest,
  retryEmailJob as retryEmailJobRequest,
  updateAdminSupportStatus,
  updateAdminSupportPriority,
  submitAdminPreauth,
  updateRemoteControls,
  uploadReleaseBinary,
  patchSubscriptionStatus,
  previewManualSubscriptionGrant,
} from '../../api/admin'
import { createPaymentIntent, fetchPlanCatalog, type PlanCatalogItem } from '../../api/payments'
import { fetchProtectedReleaseCatalog, fetchProtectedReleaseFile, type ProtectedRelease } from '../../api/downloads'
import { archivePortalNotification, fetchPortalNotifications, markAllPortalNotificationsRead, markPortalNotificationRead } from '../../api/notifications'
import {
  cancelEmailRegistrationCode as cancelEmailRegistrationRequest,
  cancelEmailVerificationCode,
  finalizeEmailRegistration as finalizeEmailRegistrationRequest,
  requestEmailVerificationCode,
  startEmailRegistration as startEmailRegistrationRequest,
  verifyEmailRegistrationCode,
  verifyEmailVerificationCode,
} from '../../api/emailVerification'
import {
  createWebSupportTicket,
  fetchWebSupportThread,
  fetchWebSupportThreads,
  uploadWebSupportAttachment,
  downloadWebSupportAttachment,
  replyWebSupportThread,
  updateWebSupportStatus,
} from '../../api/support'
import { firebaseAuth, firebaseAuthPersistenceReady } from '../../lib/firebase'
import { publicCopy } from '../content/publicCopy'
import { legalPageContent } from '../content/legalContent'
import { isProductionFeatureEnabled, productionFeatureFlags } from './productionFeatureFlags'
import type { AccountSubscription } from '../../api/account'
import type { AdminEmailProcessingResult } from '../../api/admin'
import type { AppAdapters, AppUser, AuthState, PlanInfo, ReleaseInfo, SignUpWithEmailInput, SupportSenderRole } from './contracts'

function emailProcessingResult(value: unknown, single = false): AdminEmailProcessingResult {
  if (!value || typeof value !== 'object') throw new Error('email_action_unconfirmed')
  const result = value as AdminEmailProcessingResult
  if (![result.processed, result.sent, result.skipped].every((count) => Number.isSafeInteger(count) && count >= 0)) throw new Error('email_action_unconfirmed')
  // A single-message result counts attempts; a batch result counts jobs selected.
  const valid = single
    ? (result.processed === 1 && result.skipped === 0 && result.sent <= 1) ||
      (result.processed === 0 && result.sent === 0 && result.skipped === 1)
    : result.sent <= result.processed - result.skipped
  if (!valid) throw new Error('email_action_unconfirmed')
  return result
}

function confirmedOperation(
  data: { success: boolean; result: Record<string, unknown> } | null | undefined,
  requestId: string,
  matches: (result: Record<string, unknown>) => boolean,
) {
  if (data?.success !== true || data.result?.request_id !== requestId || !matches(data.result)) throw new Error('admin_operation_unconfirmed')
  return data.result
}

function userFromFirebase(user: typeof firebaseAuth.currentUser): AppUser {
  if (!user?.email) throw new Error('auth_user_missing_email')
  const authProviders = user.providerData
    .map((provider) => String(provider.providerId || '').trim().toLowerCase())
    .filter(Boolean)
  const trustedEmailIdentity = Boolean(user.emailVerified && authProviders.includes('google.com'))
  return {
    id: user.uid,
    email: user.email,
    displayName: user.displayName,
    emailVerified: user.emailVerified,
    authProviders,
    trustedEmailIdentity,
  }
}

type PendingProviderLink = {
  email: string
  credential: NonNullable<ReturnType<typeof GoogleAuthProvider.credentialFromError>>
}

let pendingProviderLink: PendingProviderLink | null = null

function providerCollisionError(error: unknown): Error | null {
  const raw = String((error as { code?: string })?.code || '').toLowerCase()
  if (!raw.includes('account-exists-with-different-credential')) return null
  const credential = GoogleAuthProvider.credentialFromError(error as never)
  const customData = (error as { customData?: { email?: string } })?.customData
  const email = String(customData?.email || '').trim().toLowerCase()
  if (credential && email) pendingProviderLink = { credential, email }
  const collision = new Error(`AUTH_PROVIDER_COLLISION${email ? `:${email}` : ''}`)
  collision.name = 'AuthProviderCollisionError'
  return collision
}

function mapFirebaseAuthError(error: unknown): Error {
  const raw = String((error as { code?: string; message?: string })?.code || (error as { message?: string })?.message || error || '').toLowerCase()
  if (raw.includes('email-already-in-use')) return new Error('AUTH_EMAIL_ALREADY_USED')
  if (raw.includes('weak-password')) return new Error('AUTH_WEAK_PASSWORD')
  if (raw.includes('invalid-email')) return new Error('AUTH_INVALID_EMAIL')
  if (raw.includes('too-many-requests')) return new Error('AUTH_TOO_MANY_ATTEMPTS')
  if (raw.includes('account-exists-with-different-credential')) return new Error('AUTH_PROVIDER_COLLISION')
  if (raw.includes('wrong-password') || raw.includes('invalid-credential') || raw.includes('user-not-found')) return new Error('AUTH_INVALID_CREDENTIALS')
  if (raw.includes('network')) return new Error('NETWORK_UNAVAILABLE')
  return error instanceof Error ? error : new Error('REQUEST_FAILED')
}

function supportSenderRole(sender: string | null | undefined): SupportSenderRole {
  const normalized = String(sender || '').trim().toLowerCase()
  if (normalized === 'admin' || normalized === 'support' || normalized === 'support_agent' || normalized === 'agent') return 'support_agent'
  if (normalized === 'internal' || normalized === 'internal_note') return 'internal_note'
  if (normalized === 'system') return 'system'
  return 'customer'
}

type AccountBootstrap = {
  uid: string
  user: AppUser
  account: AccountSubscription
  fetchedAt: number
}

let accountBootstrapCache: AccountBootstrap | null = null
let accountBootstrapInflight: Promise<AccountBootstrap> | null = null

function clearAccountBootstrap() {
  accountBootstrapCache = null
  accountBootstrapInflight = null
}

function currentPerformanceNow() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

async function refreshAuthenticatedAccountState(forceRefresh = true): Promise<void> {
  const user = firebaseAuth.currentUser
  if (!user?.email) return
  const baseUser = userFromFirebase(user)
  publishAuthState({
    ready: false,
    user: baseUser,
    status: 'refreshing',
    profileState: 'provisioning',
    emailVerificationState: 'verification_pending',
    sessionState: 'refresh_required',
    error: null,
  })
  try {
    const account = await loadAccountBootstrap(forceRefresh)
    const profile = account.user.profile || null
    publishAuthState({
      ready: true,
      user: account.user,
      status: 'authenticated',
      profileState: profile?.account_status === 'suspended' ? 'disabled' : profile ? 'ready' : 'missing',
      emailVerificationState: profile?.email_verified || baseUser.trustedEmailIdentity ? 'verified' : 'unverified',
      sessionState: 'valid',
      error: null,
    })
  } catch (error) {
    publishAuthState({
      ready: true,
      user: baseUser,
      status: 'authenticated',
      profileState: 'failed_recoverable',
      emailVerificationState: baseUser.trustedEmailIdentity ? 'verified' : 'unverified',
      sessionState: 'refresh_required',
      error: String(error instanceof Error ? error.message : error || 'PROFILE_PROVISIONING_FAILED'),
    })
  }
}

async function loadAccountBootstrap(forceRefresh = false): Promise<AccountBootstrap> {
  const user = firebaseAuth.currentUser
  if (!user?.email) throw new Error('not_authenticated')
  const uid = user.uid
  if (!forceRefresh && accountBootstrapCache?.uid === uid) return accountBootstrapCache
  if (!forceRefresh && accountBootstrapInflight) return accountBootstrapInflight
  const startedAt = currentPerformanceNow()
  accountBootstrapInflight = (async () => {
    let token = await user.getIdToken(forceRefresh)
    try {
      return await fetchAccountSubscription(token)
    } catch (error) {
      const code = String(error instanceof Error ? error.message : error || '')
      if (code !== 'ACCOUNT_TOKEN_REFRESH_REQUIRED') throw error
      token = await user.getIdToken(true)
      clearAccountBootstrap()
      return fetchAccountSubscription(token)
    }
  })()
    .then((account) => {
      const profile = account.user?.profile || null
      const bootstrapped: AccountBootstrap = {
        uid,
        account,
        user: { ...userFromFirebase(user), displayName: profile?.display_name || user.displayName || null, profile, emailVerified: Boolean(profile?.email_verified) },
        fetchedAt: Date.now(),
      }
      accountBootstrapCache = bootstrapped
      if (typeof console !== 'undefined' && typeof console.info === 'function') {
        console.info('saturnws:account_bootstrap', { duration_ms: Math.round(currentPerformanceNow() - startedAt), source: 'network' })
      }
      return bootstrapped
    })
    .finally(() => {
      accountBootstrapInflight = null
    })
  return accountBootstrapInflight
}

async function provisionCurrentFirebaseUser(input: {
  displayName?: string
  locale?: 'ar' | 'en'
  termsAccepted?: boolean
  termsVersion?: string
} = {}): Promise<AppUser> {
  const user = firebaseAuth.currentUser
  if (!user) throw new Error('not_authenticated')
  if (input.displayName !== undefined && input.displayName.trim() !== (user.displayName || '')) {
    await updateProfile(user, { displayName: input.displayName.trim() || null })
  }
  const token = await user.getIdToken(false)
  const provisioned = await provisionAccountProfile(token, {
    displayName: input.displayName ?? user.displayName ?? undefined,
    locale: input.locale,
    termsAccepted: input.termsAccepted,
    termsVersion: input.termsVersion,
    termsAcceptedAt: input.termsAccepted ? new Date().toISOString() : undefined,
  })
  if (!provisioned.success || !provisioned.profile) throw new Error(provisioned.error || 'PROFILE_PROVISIONING_FAILED')
  if (provisioned.token_refresh_required) {
    await user.getIdToken(true)
  }
  clearAccountBootstrap()
  return { ...userFromFirebase(user), profile: provisioned.profile, emailVerified: Boolean(provisioned.profile.email_verified) }
}

const authSubscribers = new Set<(state: AuthState) => void>()
let authUnsubscribe: (() => void) | null = null
let currentAuthState: AuthState = {
  ready: false,
  user: null,
  status: 'initializing',
  profileState: 'missing',
  emailVerificationState: 'not_required',
  sessionState: 'refresh_required',
  error: null,
}

function publishAuthState(state: AuthState) {
  currentAuthState = state
  authSubscribers.forEach((subscriber) => subscriber(state))
}

function ensureAuthListener() {
  if (authUnsubscribe) return
  authUnsubscribe = onAuthStateChanged(firebaseAuth, (user) => {
    if (!user?.email) {
      publishAuthState({
        ready: true,
        user: null,
        status: 'unauthenticated',
        profileState: 'missing',
        emailVerificationState: 'not_required',
        sessionState: 'expired',
        error: null,
      })
      clearAccountBootstrap()
      return
    }
    const baseUser = userFromFirebase(user)
    publishAuthState({
      ready: false,
      user: baseUser,
      status: 'refreshing',
      profileState: 'provisioning',
      emailVerificationState: 'verification_pending',
      sessionState: 'refresh_required',
      error: null,
    })
    refreshAuthenticatedAccountState(false)
  })
}

function normalizeProtectedRelease(release: ProtectedRelease): ReleaseInfo {
  return {
    available: true,
    releaseId: release.id,
    accessState: 'available',
    version: release.version,
    channel: release.channel,
    filename: release.filename,
    sha256: release.sha256,
    sizeBytes: release.size_bytes,
    architecture: release.architecture,
    notes: release.release_notes,
    raw: release,
  }
}


function catalogPeriod(plan: PlanCatalogItem, locale: 'ar' | 'en') {
  const labels = {
    ar: { week: 'أسبوعيًا', month: 'شهريًا', year: 'سنويًا', once: 'مرة واحدة', custom: '' },
    en: { week: 'per week', month: 'per month', year: 'per year', once: 'one time', custom: '' },
  }
  return labels[locale][plan.interval as keyof typeof labels.ar] || ''
}

function mapCatalogPlan(plan: PlanCatalogItem, locale: 'ar' | 'en'): PlanInfo {
  const localized = plan.localizations?.[locale] || {}
  return {
    id: plan.id,
    version: plan.version,
    name: localized.name || plan.name,
    price: formatMoneyMinor(plan.amount_minor, plan.currency, locale),
    originalPrice: plan.original_amount_minor == null
      ? undefined
      : formatMoneyMinor(plan.original_amount_minor, plan.currency, locale),
    period: catalogPeriod(plan, locale),
    description: localized.description || plan.description,
    trialDays: plan.trial_days,
    features: plan.features,
    visible: plan.visible,
    active: plan.active,
    purchasable: plan.purchasable,
    providerReady: plan.provider_ready,
    enabled: plan.active && plan.visible,
    checkoutEnabled: plan.checkout_enabled,
  }
}

function checkoutIdempotencyKey(plan: string, email: string): string {
  const normalizedEmail = email.trim().toLowerCase()
  const storageKey = `saturnws.checkout.idempotency.${plan}.${normalizedEmail || 'anonymous'}`
  if (typeof window === 'undefined') return crypto.randomUUID()
  const existing = window.sessionStorage.getItem(storageKey)
  if (existing) return existing
  const next = crypto.randomUUID()
  window.sessionStorage.setItem(storageKey, next)
  return next
}

export const productionAdapters: AppAdapters = {
  mode: 'production',
  auth: {
    subscribe(callback) {
      ensureAuthListener()
      authSubscribers.add(callback)
      callback(currentAuthState)
      return () => {
        authSubscribers.delete(callback)
      }
    },
    async signInWithEmail(email, password) {
      try {
        await firebaseAuthPersistenceReady
        const result = await signInWithEmailAndPassword(firebaseAuth, email.trim(), password)
        const normalizedEmail = String(result.user.email || email).trim().toLowerCase()
        if (pendingProviderLink?.email === normalizedEmail) {
          try {
            const linked = await linkWithCredential(result.user, pendingProviderLink.credential)
            pendingProviderLink = null
            clearAccountBootstrap()
            return userFromFirebase(linked.user)
          } catch (error) {
            await signOut(firebaseAuth).catch(() => undefined)
            throw error
          }
        }
        return userFromFirebase(result.user)
      } catch (error) {
        throw mapFirebaseAuthError(error)
      }
    },
    async startEmailRegistration(input: SignUpWithEmailInput) {
      const result = await startEmailRegistrationRequest({
        email: input.email.trim(),
        displayName: input.displayName,
        locale: input.locale,
        termsAccepted: input.termsAccepted,
        termsVersion: input.termsVersion,
        termsAcceptedAt: input.termsAcceptedAt,
      })
      return {
        success: result.success,
        status: result.status,
        registrationId: result.registration_id,
        email: result.email,
        expiresAt: result.expires_at,
        resendAfterSeconds: result.resend_after_seconds,
        retryAfterSeconds: result.retry_after_seconds,
        error: result.error,
      }
    },
    async finalizeEmailRegistration(input) {
      const finalized = await finalizeEmailRegistrationRequest({
        registrationId: input.registrationId,
        email: input.email,
        finalizationToken: input.finalizationToken,
        password: input.password,
      })
      if (!finalized.success) throw new Error(finalized.error || 'registration_finalization_failed')
      try {
        await firebaseAuthPersistenceReady
        const result = await signInWithEmailAndPassword(firebaseAuth, input.email.trim(), input.password)
        clearAccountBootstrap()
        await refreshAuthenticatedAccountState(true)
        return userFromFirebase(result.user)
      } catch (error) {
        throw mapFirebaseAuthError(error)
      }
    },
    async signInWithGoogle(input = {}) {
      try {
        await firebaseAuthPersistenceReady
        const provider = new GoogleAuthProvider()
        if (input.selectAccount) provider.setCustomParameters({ prompt: 'select_account' })
        const result = await signInWithPopup(firebaseAuth, provider)
        const shouldProvisionProfile = input.provisionProfile !== false || Boolean(input.termsAccepted)
        if (!shouldProvisionProfile) return userFromFirebase(result.user)
        try {
          return await provisionCurrentFirebaseUser({
            locale: input.locale,
            termsAccepted: input.termsAccepted,
            termsVersion: input.termsVersion || '2026-06',
          })
        } catch (error) {
          const code = String(error instanceof Error ? error.message : error || '').toLowerCase()
          if (code.includes('profile_terms_required')) {
            await signOut(firebaseAuth).catch(() => undefined)
            throw new Error('AUTH_SIGNUP_REQUIRED', { cause: error })
          }
          throw error
        }
      } catch (error) {
        const collision = providerCollisionError(error)
        if (collision) throw collision
        throw mapFirebaseAuthError(error)
      }
    },
    async provisionProfile(input = {}) {
      return provisionCurrentFirebaseUser(input)
    },
    async sendPasswordReset(email) {
      await sendPasswordResetEmail(firebaseAuth, email.trim())
    },
    async requestEmailVerification(email, input = {}) {
      const token = await productionAdapters.auth.getIdToken(false)
      if (!token) return { success: false, error: 'not_authenticated' }
      const result = await requestEmailVerificationCode(token, email.trim(), input)
      return { success: result.success, status: result.status, expiresAt: result.expires_at, resendAfterSeconds: result.resend_after_seconds, retryAfterSeconds: result.retry_after_seconds, error: result.error }
    },
    async verifyEmailCode(input) {
      let result
      if (input.registrationId) {
        result = await verifyEmailRegistrationCode({ registrationId: input.registrationId, email: input.email.trim(), code: input.code })
      } else {
        const token = await productionAdapters.auth.getIdToken(false)
        if (!token) return { success: false, error: 'not_authenticated' }
        result = await verifyEmailVerificationCode(token, input.email.trim(), input.code)
      }
      if (result.success) {
        clearAccountBootstrap()
        await refreshAuthenticatedAccountState(true)
      }
      return {
        success: result.success,
        status: result.status,
        verifiedAt: result.verified_at,
        registrationId: result.registration_id,
        finalizationToken: result.finalization_token,
        finalizationExpiresAt: result.finalization_expires_at,
        retryAfterSeconds: result.retry_after_seconds,
        error: result.error,
      }
    },
    async cancelEmailVerification(input) {
      const result = input.registrationId
        ? await cancelEmailRegistrationRequest({ registrationId: input.registrationId, email: input.email.trim() })
        : await (async () => {
          const token = await productionAdapters.auth.getIdToken(false)
          if (!token) return { success: false, error: 'not_authenticated' }
          return cancelEmailVerificationCode(token, input.email.trim())
        })()
      return { success: result.success, status: result.status, error: result.error }
    },
    async signOut() {
      publishAuthState({ ...currentAuthState, status: 'signing_out' })
      clearAccountBootstrap()
      pendingProviderLink = null
      await signOut(firebaseAuth)
    },
    async getIdToken(forceRefresh = false) {
      return firebaseAuth.currentUser ? firebaseAuth.currentUser.getIdToken(forceRefresh) : null
    },
  },
  account: {
    async getSubscription() {
      return loadAccountBootstrap(false).then((bootstrap) => bootstrap.account)
    },
    async getSubscriptionProjection() {
      const result = await loadAccountBootstrap(false).then((bootstrap) => bootstrap.account)
      return result.subscription_projection || null
    },
    async updateProfile(input) {
      if (!firebaseAuth.currentUser) throw new Error('not_authenticated')
      await updateProfile(firebaseAuth.currentUser, { displayName: input.displayName.trim() || null })
      clearAccountBootstrap()
      return userFromFirebase(firebaseAuth.currentUser)
    },
    async sendPasswordReset() {
      const email = firebaseAuth.currentUser?.email
      if (!email) throw new Error('not_authenticated')
      await sendPasswordResetEmail(firebaseAuth, email)
    },
    async listSessions() {
      const token = await productionAdapters.auth.getIdToken(false)
      if (!token) throw new Error('not_authenticated')
      return fetchAccountSessions(token)
    },
    async requestDeviceChange(deviceCode, reason) {
      const token = await productionAdapters.auth.getIdToken(true)
      if (!token) throw new Error('not_authenticated')
      return requestAccountDeviceChange(token, deviceCode, reason)
    },
    async revokeSession(sessionId, scope) {
      const token = await productionAdapters.auth.getIdToken(true)
      if (!token) throw new Error('not_authenticated')
      await revokeAccountSession(token, sessionId, scope)
    },
    async revokeAllSessions() {
      const token = await productionAdapters.auth.getIdToken(true)
      if (!token) throw new Error('not_authenticated')
      await revokeAllAccountSessions(token)
    },
    async getDeletionStatus() {
      const token = await productionAdapters.auth.getIdToken(false)
      if (!token) throw new Error('not_authenticated')
      return fetchAccountDeletionStatus(token)
    },
    async requestDeletion(reason) {
      const token = await productionAdapters.auth.getIdToken(true)
      if (!token) throw new Error('not_authenticated')
      clearAccountBootstrap()
      return requestAccountDeletion(token, reason)
    },
    async cancelDeletion() {
      const token = await productionAdapters.auth.getIdToken(true)
      if (!token) throw new Error('not_authenticated')
      clearAccountBootstrap()
      return cancelAccountDeletion(token)
    },
  },
  releases: {
    async getLatest(channel = 'beta') {
      const user = firebaseAuth.currentUser
      if (!user) return { available: false, accessState: 'signed_out' }
      const token = await user.getIdToken(false)
      try {
        const catalog = await fetchProtectedReleaseCatalog(token)
        const release = catalog.releases.find((item) => item.channel === channel) || catalog.releases[0]
        return release ? normalizeProtectedRelease(release) : { available: false, accessState: 'unavailable' }
      } catch (error) {
        const code = String((error as Error)?.message || error || '')
        if (code.includes('download_not_entitled')) return { available: false, accessState: 'not_entitled' }
        throw error
      }
    },
    async download(releaseId, filename = 'SaturnWorkspace.exe') {
      const user = firebaseAuth.currentUser
      if (!user) throw new Error('not_authenticated')
      const token = await user.getIdToken(false)
      const blob = await fetchProtectedReleaseFile(releaseId, token)
      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = filename
      link.rel = 'noopener'
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000)
    },
  },
  plans: {
    async listPlans(locale) {
      const catalog = await fetchPlanCatalog()
      return catalog.plans.map((plan) => mapCatalogPlan(plan, locale))
    },
  },
  payments: {
    isCheckoutEnabled() {
      return isProductionFeatureEnabled('payments') && isProductionFeatureEnabled('publicCheckout')
    },
    async createIntent(input) {
      if (!this.isCheckoutEnabled()) {
        return { success: false, status: 'failed', reason: productionFeatureFlags.payments.reason || productionFeatureFlags.publicCheckout.reason || 'payment_disabled' }
      }
      const token = await productionAdapters.auth.getIdToken(false).catch(() => null)
      const result = await createPaymentIntent({
        plan: input.plan,
        plan_version: input.planVersion,
        id_token: token || undefined,
        idempotency_key: checkoutIdempotencyKey(input.plan, input.email || ''),
        customer: { email: input.email },
        locale: input.locale,
      })
      return {
        success: result.success,
        status: result.status || 'failed',
        orderId: result.order_id,
        hostedUrl: result.hosted_url,
      }
    },
  },
  support: {
    isCustomerWebSupportEnabled() {
      return isProductionFeatureEnabled('customerSupport')
    },
    async createTicket(input) {
      const token = await productionAdapters.auth.getIdToken(false)
      if (!token) return { success: false, error: 'not_authenticated' }
      const uploaded = []
      for (const file of input.attachments || []) uploaded.push((await uploadWebSupportAttachment(token, file)).attachment)
      const result = await createWebSupportTicket(token, { subject: input.subject, body: input.body, attachmentIds: uploaded.map((item) => item.id), idempotencyKey: crypto.randomUUID() })
      return { success: result.success, threadId: result.thread_id, error: result.error }
    },
    async listThreads() {
      const token = await productionAdapters.auth.getIdToken(false)
      if (!token) throw new Error('not_authenticated')
      const data = await fetchWebSupportThreads(token)
      return (data.threads || []).map((thread) => ({
        id: thread.id,
        subject: thread.subject,
        status: thread.status,
        updatedAt: thread.updated_at || thread.last_message_at || undefined,
        lastMessageAt: thread.last_message_at || undefined,
        lastMessageSender: thread.last_message_sender || undefined,
        unreadCount: thread.unread_count,
      }))
    },
    async getThread(threadId) {
      const token = await productionAdapters.auth.getIdToken(false)
      if (!token) throw new Error('not_authenticated')
      const data = await fetchWebSupportThread(token, threadId)
      return {
        thread: data.thread
          ? {
              id: data.thread.id,
              subject: data.thread.subject,
              status: data.thread.status,
              updatedAt: data.thread.updated_at || data.thread.last_message_at || undefined,
              lastMessageAt: data.thread.last_message_at || undefined,
              lastMessageSender: data.thread.last_message_sender || undefined,
              unreadCount: data.thread.unread_count,
            }
          : undefined,
        messages: (data.messages || []).map((message) => ({
          id: message.id,
          sender: message.sender,
          senderRole: supportSenderRole(message.sender),
              body: message.body,
              createdAt: message.created_at,
              attachments: (message.attachments || []).map((attachment) => ({ id: attachment.id, filename: attachment.filename, mimeType: attachment.mime_type, sizeBytes: attachment.size_bytes, status: attachment.status })),
        })),
      }
    },
    async replyThread(threadId, body, attachments = []) {
      const token = await productionAdapters.auth.getIdToken(false)
      if (!token) return { success: false, error: 'not_authenticated' }
      const uploaded = []
      for (const file of attachments) uploaded.push((await uploadWebSupportAttachment(token, file, threadId)).attachment)
      return replyWebSupportThread(token, threadId, body, crypto.randomUUID(), uploaded.map((item) => item.id))
    },
    async downloadAttachment(attachment) {
      const token = await productionAdapters.auth.getIdToken(false)
      if (!token) throw new Error('not_authenticated')
      await downloadWebSupportAttachment(token, { id: attachment.id, filename: attachment.filename, mime_type: attachment.mimeType, size_bytes: attachment.sizeBytes, status: attachment.status, download_url: '' })
    },
    async setThreadStatus(threadId, status) {
      const token = await productionAdapters.auth.getIdToken(false)
      if (!token) return { success: false, error: 'not_authenticated' }
      return updateWebSupportStatus(token, threadId, status)
    },
  },
  notifications: {
    async list(input = {}) {
      const token = await productionAdapters.auth.getIdToken(false)
      if (!token) throw new Error('not_authenticated')
      const data = await fetchPortalNotifications(token, input)
      return {
        items: (data.items || []).map((item) => ({
          id: item.id,
          type: item.type,
          title: item.title,
          body: item.body,
          titleAr: item.title_ar || undefined,
          bodyAr: item.body_ar || undefined,
          linkedResourceType: item.linked_resource_type || undefined,
          linkedResourceId: item.linked_resource_id || undefined,
          portalStatus: item.portal_status,
          emailStatus: item.email_status,
          readAt: item.read_at || undefined,
          createdAt: item.created_at,
        })),
        unreadCount: Number(data.unread_count || 0),
        nextCursor: data.next_cursor || undefined,
      }
    },
    async markRead(notificationId) {
      const token = await productionAdapters.auth.getIdToken(false)
      if (!token) throw new Error('not_authenticated')
      await markPortalNotificationRead(token, notificationId)
    },
    async markAllRead() {
      const token = await productionAdapters.auth.getIdToken(false)
      if (!token) throw new Error('not_authenticated')
      const result = await markAllPortalNotificationsRead(token)
      return Number(result.updated || 0)
    },
    async archive(notificationId) {
      const token = await productionAdapters.auth.getIdToken(false)
      if (!token) throw new Error('not_authenticated')
      await archivePortalNotification(token, notificationId)
    },
  },
  admin: {
    onIdentityChanged(callback) {
      let previous: string | null | undefined
      return onAuthStateChanged(firebaseAuth, (user) => {
        const next = user?.uid || null
        if (previous !== undefined && next !== previous) callback()
        previous = next
      })
    },
    async getPreauthState(signal) {
      const state = await fetchAdminPreauthState(signal)
      return { authenticated: state.authenticated }
    },
    async submitPreauth(input, signal) {
      const state = await submitAdminPreauth(input, signal)
      return { authenticated: state.authenticated }
    },
    async signInWithGoogle() {
      const user = await productionAdapters.auth.signInWithGoogle({ provisionProfile: false, selectAccount: true })
      return user
    },
    async getSession(signal) {
      const session = await fetchAdminSession(signal)
      return session
    },
    async getDashboard(signal) {
      const data = await fetchAdminDashboard(signal)
      return { kpis: data.kpis, recentActivity: data.recent_activity, degradedResources: data.degraded_resources, subscriptionCountLimited: data.subscription_count_limited }
    },
    getCommercePage: fetchAdminCommercePage,
    getCommerceConfiguration: fetchAdminCommerceConfiguration,
    getCommerceOrder: fetchAdminCommerceOrder,
    async listUsers(input = {}, signal) {
      const data = await fetchAdminUsers(input, signal)
      return { items: data.items, total: data.total, page: data.page, limit: data.limit }
    },
    async listSubscriptions(input = {}, signal) {
      const query = { ...input, id: input.id?.toLowerCase(), page: input.page ?? 1, limit: input.limit ?? 25 }
      const data = await fetchSubscriptions(query, signal, true)
      if (data?.success !== true || data.view !== 'directory' || data.page !== query.page || data.limit !== query.limit ||
          !Number.isSafeInteger(data.total) || data.total < 0 || !Array.isArray(data.items) ||
          data.items.length !== Math.min(query.limit, Math.max(0, data.total - (query.page - 1) * query.limit)) ||
          !data.items.every((item) => typeof item?.id === 'string' && item.id && typeof item.user_email === 'string' && typeof item.is_current_record === 'boolean') ||
          new Set(data.items.map(({ id }) => id)).size !== data.items.length ||
          (query.id && (data.total > 1 || data.items.some((row) => row.id !== query.id)))) throw new Error('subscriptions_unavailable')
      return { items: data.items, total: data.total, page: data.page, limit: data.limit }
    },
    async createSubscription(input) {
      const data = await createSubscription(input)
      return data.item
    },
    async previewManualGrant(input) {
      const data = await previewManualSubscriptionGrant(input)
      return data.preview
    },
    async executeManualGrant(input) {
      const data = await executeManualSubscriptionGrant(input)
      const email = (input.target_email || '').trim().toLowerCase()
      const item = data?.item
      const pending = data?.pending_grant
      const returnedEmail = item?.user_email || pending?.normalized_email
      const recordId = item?.id || pending?.id
      const matches = input.target_firebase_uid
        ? item?.firebase_user_id === input.target_firebase_uid
        : Boolean(email) && typeof returnedEmail === 'string' && returnedEmail.trim().toLowerCase() === email
      if (data?.success !== true || typeof data.request_id !== 'string' || !data.request_id.trim() ||
          typeof recordId !== 'string' || !recordId || Boolean(item) === Boolean(pending) || !matches) throw new Error('admin_operation_unconfirmed')
      return data
    },
    listPendingSubscriptionGrants: fetchPendingSubscriptionGrantPage,
    async cancelPendingSubscriptionGrant(grantId, reason) {
      const data = await cancelPendingSubscriptionGrantRequest({ grant_id: grantId, reason })
      if (data?.success !== true || data.item?.id !== grantId || data.item.status !== 'cancelled') throw new Error('admin_operation_unconfirmed')
      return data.item
    },
    listDeviceChangeRequests: fetchAdminDeviceChangeRequests,
    getDeviceChangeRequest: fetchAdminDeviceChangeRequest,
    async previewDeviceChange(requestId, input) {
      return (await previewAdminDeviceChange(requestId, input)).preview
    },
    async executeDeviceChange(requestId, input) {
      const data = await executeAdminDeviceChange(requestId, input)
      const status = input.action === 'approve' ? 'approved' : 'rejected'
      if (data?.success !== true || data.result?.item?.id !== requestId || data.result.item.status !== status || typeof data.result.idempotent !== 'boolean') throw new Error('admin_operation_unconfirmed')
      return data.result
    },
    async previewDeviceReset(firebaseUid, reason) {
      return (await previewAdminDeviceReset(firebaseUid, reason)).preview
    },
    async executeDeviceReset(firebaseUid, input) {
      const data = await executeAdminDeviceReset(firebaseUid, input)
      if (data?.success !== true || data.result?.reset !== true || typeof data.result.idempotent !== 'boolean') throw new Error('admin_operation_unconfirmed')
      return data.result
    },
    async updateSubscriptionStatus(id, status) {
      const data = await patchSubscriptionStatus(id, status)
      return data.item
    },
    async previewAccountLifecycle(firebaseUid, input) {
      return (await previewAccountLifecycleRequest(firebaseUid, input)).preview
    },
    async executeAccountLifecycle(firebaseUid, input) {
      const data = await executeAccountLifecycleRequest(firebaseUid, input)
      const status = input.action === 'suspend' ? 'suspended' : input.action === 'reactivate' ? 'active' : 'pending_deletion'
      return confirmedOperation(data, input.request_id, (result) => {
        const account = result.account as { firebase_uid?: string; account_status?: string } | null
        return account?.firebase_uid === firebaseUid && account.account_status === status
      })
    },
    async previewAccessRevocation(firebaseUid, input) {
      return (await previewAccessRevocationRequest(firebaseUid, input)).preview
    },
    async executeAccessRevocation(firebaseUid, input) {
      const data = await executeAccessRevocationRequest(firebaseUid, input)
      return confirmedOperation(data, input.request_id, (result) => result.scope === input.scope &&
        [result.sessions_revoked, result.device_requests_revoked].every((count) => typeof count === 'number' && Number.isSafeInteger(count) && count >= 0))
    },
    async previewSubscriptionTransition(subscriptionId, input) {
      return (await previewSubscriptionTransitionRequest(subscriptionId, input)).preview
    },
    async executeSubscriptionTransition(subscriptionId, input) {
      const data = await executeSubscriptionTransitionRequest(subscriptionId, input)
      return confirmedOperation(data, input.request_id, (result) =>
        (result.subscription as { id?: string } | null)?.id === subscriptionId)
    },
    async resetHwid(id) {
      const data = await resetSubscriptionHwid(id)
      return data.item
    },
    listPromoDirectory: fetchAdminPromoDirectory,
    async createPromoCode(input) {
      const result = await createPromoCode(input)
      if (result?.success !== true || result.item?.code !== input.code.trim() || !result.item.id || !Number.isFinite(Date.parse(result.item.updated_at || ''))) throw new Error('promo_save_unconfirmed')
      return result.item
    },
    async updatePromoCodeState(id, active, reason, expectedUpdatedAt) {
      const result = await updatePromoCodeState(id, active, reason, expectedUpdatedAt)
      if (result?.success !== true || result.item?.id !== id || result.item.is_active !== active || !Number.isFinite(Date.parse(result.item.updated_at || ''))) throw new Error('promo_save_unconfirmed')
      return result.item
    },
    async listReleases(channel = 'beta', signal) {
      const data = await fetchCurrentAdminRelease(channel, signal)
      const artifacts = data?.item?.artifacts
      if (data?.success !== true || data.channel !== channel || data.item?.channel !== channel ||
          typeof data.item.available !== 'boolean' || typeof data.item.version !== 'string' ||
          typeof data.item.disabled !== 'boolean' || typeof data.item.disabled_reason !== 'string' ||
          typeof data.item.mandatory !== 'boolean' || typeof data.item.notes !== 'string' ||
          (['filename', 'download_url', 'download_sha256'] as const).some((key) => typeof data.item[key] !== 'string') ||
          (data.item.published_at !== null && (typeof data.item.published_at !== 'string' || !Number.isFinite(Date.parse(data.item.published_at)))) ||
          !artifacts || Array.isArray(artifacts) || (['installed', 'portable'] as const).some((kind) => {
            const artifact = artifacts[kind]
            return artifact !== undefined && (!artifact || typeof artifact !== 'object' || Array.isArray(artifact) ||
              (['filename', 'url', 'sha256', 'package_type'] as const).some((key) => Object.hasOwn(artifact, key) && typeof artifact[key] !== 'string') ||
              artifact.size_bytes !== undefined && (!Number.isSafeInteger(artifact.size_bytes) || artifact.size_bytes < 0))
          })) {
        throw new Error('release_channel_unavailable')
      }
      return [data.item]
    },
    async getStagedRelease(channel, version, signal) {
      const data = await fetchStagedAdminRelease(channel, version, signal)
      if (!data?.success || data.channel !== channel || data.version !== version || !data.artifacts ||
          (['portable', 'installed'] as const).some((kind) => {
            const artifact = data.artifacts[kind]
            return artifact !== null && (!artifact || typeof artifact.filename !== 'string' || !artifact.filename ||
              !Number.isSafeInteger(artifact.size_bytes) || artifact.size_bytes < 0 || !/^[a-f0-9]{64}$/.test(artifact.revision))
          })) throw new Error('release_staging_unavailable')
      return data.artifacts
    },
    async uploadRelease(input) {
      const data = await uploadReleaseBinary({ file: input.file, version: input.version, channel: input.channel, artifact_type: input.artifactType })
      if (!data?.success || data.artifact_type !== input.artifactType || data.release?.version !== input.version ||
          data.release.channel !== input.channel || data.release.size !== input.file.size ||
          !/^[a-f0-9]{64}$/i.test(data.release.sha256) || !data.staged_artifact ||
          data.staged_artifact.filename !== data.release.filename || data.staged_artifact.size_bytes !== input.file.size ||
          !/^[a-f0-9]{64}$/.test(data.staged_artifact.revision)) throw new Error('release_upload_unconfirmed')
      return data.staged_artifact
    },
    async publishRelease(input) {
      const data = await publishRelease({
        version: input.version,
        channel: input.channel,
        notes: input.notes,
        mandatory: input.mandatory,
        update_mode: input.updateMode,
        reviewed_artifacts: input.reviewedArtifacts,
        target_scope: input.targetScope,
        target_user_emails: input.targetUserEmails,
      })
      const published = data?.manifest?.channels?.[input.channel]
      if (!data?.success || !data.manifest || (input.targetScope !== 'selected' &&
          (published?.version !== input.version || !published.available))) throw new Error('release_publish_unconfirmed')
      return data.manifest
    },
    async getRemoteControls(channel = 'beta') {
      const data = await fetchRemoteControls(channel)
      return data.controls
    },
    async updateRemoteControls(input) {
      const data = await updateRemoteControls(input)
      return data.controls
    },
    listSupportInbox: fetchSupportInbox,
    async downloadSupportAttachment(attachment) {
      await downloadAdminSupportAttachment(attachment)
    },
    getSupportConversation: fetchAdminSupportConversation,
    getSupportHistory: fetchAdminSupportHistory,
    markSupportMessagesRead: markAdminSupportMessagesRead,
    async sendSupportReply(threadId, body, options = {}) {
      const result = await sendSupportReply({ thread_id: threadId, body, internal_note: options.internal, email_requested: options.emailRequested, idempotency_key: options.idempotencyKey })
      if (result?.success !== true) throw new Error('support_reply_failed')
      return { emailQueued: typeof result.email_queued === 'boolean' ? result.email_queued : undefined }
    },
    async updateSupportStatus(threadId, status, reason, options = {}) {
      const result = await updateAdminSupportStatus({ thread_id: threadId, status, reason, idempotency_key: options.idempotencyKey })
      if (result?.success !== true || result.status !== status) throw new Error('support_status_failed')
    },
    async updateSupportPriority(threadId, priority) {
      const result = await updateAdminSupportPriority({ thread_id: threadId, priority })
      if (result?.success !== true || result.priority !== priority) throw new Error('support_priority_failed')
    },
    async setSupportBlocked(threadId, blocked, reason) {
      const result = await setSupportBlocked({ thread_id: threadId, blocked, reason })
      if (result?.success !== true || result.blocked !== blocked) throw new Error('support_block_failed')
      return { blocked: Boolean(result.blocked), status: result.status }
    },
    getEmailConfiguration: fetchAdminEmailConfiguration,
    listEmailActivity: fetchAdminEmailActivity,
    getEmailJob: fetchAdminEmailJob,
    async processEmailOutbox() {
      const data = await processEmailOutboxRequest()
      if (data?.success !== true) throw new Error('email_action_unconfirmed')
      return data.processed?.skipped === true ? { skipped: true } : emailProcessingResult(data.processed)
    },
    async retryEmailJob(jobId) {
      const data = await retryEmailJobRequest(jobId)
      if (data?.success !== true || data.job_id !== jobId) throw new Error('email_action_unconfirmed')
      return emailProcessingResult(data.processed, true)
    },
    async sendAdminTestEmail(input) {
      const data = await sendAdminTestEmailRequest({
        recipient: input.recipient,
        email_type: input.emailType,
        locale: input.locale,
        subject: input.subject,
        message: input.message,
      })
      if (data?.success !== true || typeof data.job_id !== 'string' || !data.job_id) throw new Error('email_action_unconfirmed')
      return { jobId: data.job_id, processing: emailProcessingResult(data.processed, true) }
    },
    listCrashLogs(filters = {}, signal) {
      return fetchCrashLogs(filters, signal)
    },
    async getCrashLog(id, signal) {
      return (await fetchCrashLog(id, signal)).item
    },
    getDiagnosticTriage: fetchDiagnosticTriage,
    getDiagnosticCoverage: fetchDiagnosticCoverage,
    async updateCrashGroupState(fingerprint, input) {
      const data = await updateCrashGroupStateRequest(fingerprint, input)
      if (data?.success !== true || data.item?.fingerprint !== fingerprint || data.item.status !== input.status ||
          (data.item.assignee || '') !== (input.assignee || '').trim() || (data.item.note || '') !== (input.note || '').trim()) throw new Error('admin_operation_unconfirmed')
      return data.item
    },
    listTamperAlerts: fetchTamperAlerts,
    async resolveTamperAlert(alertId, reason) {
      const data = await resolveTamperAlertRequest(alertId, reason)
      if (data?.success !== true || data.item?.id !== alertId || data.item.resolved !== true) throw new Error('admin_operation_unconfirmed')
      return data.item
    },
    listAuditLog: fetchAuditLog,
    getUserDetail: fetchUserDetail,
    getReadiness(signal) {
      return fetchAdminReadiness(signal)
    },
    listInviteDirectory: fetchAdminInviteDirectory,
    getInviteDetail: fetchAdminInviteDetail,
    async createInvite(input) {
      const result = await createAdminInvite(input)
      return { item: result.item, code: result.code, shown_once: result.shown_once, replay: result.replay }
    },
    async revokeInvite(inviteId, reason) {
      await revokeAdminInvite(inviteId, reason)
    },
    getPolicyDirectory: fetchAdminPolicyDirectory,
    getPolicyVersion: fetchAdminPolicyVersion,
    getPolicyPlan: fetchAdminPolicyPlan,
    getGlobalPolicy(signal) {
      return fetchAdminGlobalPolicy(signal)
    },
    updateGlobalPolicy(input) {
      return updateAdminGlobalPolicy(input)
    },
    updateDisabledVersion: updateAdminDisabledVersion,
  },
  content: {
    async getLegalPage(page, locale) {
      const copy = publicCopy[locale]
      return legalPageContent(page, locale, copy.legalBody)
    },
  },
}
