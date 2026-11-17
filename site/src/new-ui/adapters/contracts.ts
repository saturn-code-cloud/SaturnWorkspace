import type {
  AdminAuditFilters,
  AdminAuditLogItem,
  AdminAuditPage,
  AdminCrashGroup,
  AdminCrashLog,
  AdminDiagnosticFilters,
  AdminDiagnosticPage,
  AdminDiagnosticTriage,
  AdminDiagnosticCoverage,
  AdminDiagnosticCoveragePeriod,
  AdminDeviceChangePreview,
  AdminDeviceChangeFilter,
  AdminDeviceChangePage,
  AdminDeviceChangeRequest,
  AdminDeviceResetPreview,
  AdminPromoCode,
  AdminPromoDirectoryQuery,
  AdminPromoDirectoryPage,
  AdminReleaseManifest,
  AdminReviewedReleaseArtifacts,
  AdminStagedReleaseArtifact,
  AdminStagedReleaseArtifacts,
  AdminRemoteControls,
  AdminSubscription,
  AdminSupportMessage,
  AdminSupportAuditEvent,
  AdminSupportInboxPage,
  AdminSupportInboxQuery,
  AdminSupportThread,
  AdminUserDetail,
  AdminEmailConfiguration,
  AdminEmailActivityQuery,
  AdminEmailActivityPage,
  AdminEmailJobDetail,
  AdminEmailProcessingResult,
  AdminEmailQueueResult,
  AdminCommercePage,
  AdminCommerceQuery,
  AdminCommerceConfiguration,
  AdminOrderRecordsView,
  AdminOrderDetail,
  AdminUserDirectoryItem,
  AdminUserDirectoryQuery,
  AdminSession,
  AdminOperationReason,
  AdminOperationPreview,
  AdminReadiness,
  AdminTamperAlert,
  AdminTamperAlertFilters,
  AdminTamperAlertPage,
  AdminInviteCode,
  AdminInviteDirectoryQuery,
  AdminInviteDirectoryPage,
  AdminInviteDetail,
  AdminPolicyDirectory,
  AdminPolicyDirectoryQuery,
  AdminPolicyVersionState,
  AdminPolicyVersionChange,
  AdminPolicyPlanDetail,
  AdminGlobalPolicy,
  AdminGlobalPolicyChange,
  ManualGrantExecuteInput,
  ManualGrantPreview,
  ManualGrantPreviewInput,
  ManualGrantResult,
  PendingSubscriptionGrant,
} from '../../api/admin'
import type { AccountDeletionStatusResult, AccountDeviceChangeRequest, AccountProfileProjection, AccountSessionsResult, AccountSubscription, SubscriptionProjection } from '../../api/account'

export type RuntimeMode = 'preview' | 'production'

export type AppUser = {
  id: string
  email: string
  displayName?: string | null
  emailVerified?: boolean
  authProviders?: string[]
  trustedEmailIdentity?: boolean
  profile?: AccountProfileProjection | null
}

export type AuthBootstrapStatus =
  | 'initializing'
  | 'unauthenticated'
  | 'authenticating'
  | 'authenticated'
  | 'refreshing'
  | 'signing_out'
  | 'error'

export type EmailVerificationState =
  | 'not_required'
  | 'unverified'
  | 'verification_pending'
  | 'verified'
  | 'verification_expired'
  | 'verification_locked'

export type AccountProfileState =
  | 'missing'
  | 'provisioning'
  | 'ready'
  | 'failed_recoverable'
  | 'disabled'

export type SessionState = 'valid' | 'refresh_required' | 'expired' | 'revoked'

export type AuthState = {
  ready: boolean
  user: AppUser | null
  status?: AuthBootstrapStatus
  emailVerificationState?: EmailVerificationState
  profileState?: AccountProfileState
  sessionState?: SessionState
  error?: string | null
}

export type ReleaseInfo = {
  available: boolean
  releaseId?: string
  accessState?: 'signed_out' | 'not_entitled' | 'available' | 'unavailable'
  version?: string
  channel?: string
  mandatory?: boolean
  filename?: string
  downloadUrl?: string
  sha256?: string
  sizeBytes?: number
  architecture?: string
  notes?: string
  raw?: unknown
}

export type PlanInfo = {
  id: 'weekly' | 'monthly' | 'annual'
  version: number
  name: string
  price: string
  originalPrice?: string
  period: string
  description: string
  trialDays: number
  features: string[]
  visible: boolean
  active: boolean
  purchasable: boolean
  providerReady: boolean
  enabled: boolean
  checkoutEnabled: boolean
}

export type AdminDashboardState = {
  kpis: Record<'total_users' | 'total_active_users' | 'active_sessions' | 'active_tampering_alerts', number | null>
  recentActivity: (Pick<AdminAuditLogItem, 'action' | 'timestamp' | 'actor' | 'request_id'> & { id: string })[]
  degradedResources: string[]
  subscriptionCountLimited: boolean
}

export type PaymentIntentInput = {
  plan: 'weekly' | 'monthly' | 'annual'
  planVersion: number
  email?: string
  locale: 'ar' | 'en'
}

export type PaymentIntentResult = {
  success: boolean
  status: 'creating' | 'provider_unavailable' | 'awaiting_payment' | 'confirming' | 'paid' | 'underpaid' | 'overpaid' | 'failed' | 'cancelled' | 'expired' | 'refunded' | 'manual_review'
  orderId?: string
  hostedUrl?: string
  reason?: string
}

export type SignUpWithEmailInput = {
  displayName: string
  email: string
  locale: 'ar' | 'en'
  termsAccepted: boolean
  termsVersion?: string
  termsAcceptedAt?: string
}

export type EmailRegistrationStartResult = {
  success: boolean
  status?: string
  registrationId?: string
  email?: string
  expiresAt?: string
  resendAfterSeconds?: number
  retryAfterSeconds?: number
  error?: string
}

export type EmailVerificationResult = {
  success: boolean
  status?: string
  verifiedAt?: string
  registrationId?: string
  finalizationToken?: string
  finalizationExpiresAt?: string
  retryAfterSeconds?: number
  error?: string
}

export type CustomerSupportThread = {
  id: string
  subject: string
  status?: string
  updatedAt?: string
  lastMessageAt?: string
  lastMessageSender?: string
  unreadCount?: number
}

export type CustomerSupportMessage = {
  id: string
  sender: string
  senderRole?: SupportSenderRole
  body: string
  createdAt?: string
  attachments?: CustomerSupportAttachment[]
}

export type CustomerSupportAttachment = {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  status: string
}

export type SupportSenderRole = 'customer' | 'support_agent' | 'internal_note' | 'system' | 'email_inbound'

export type AuthAdapter = {
  subscribe(callback: (state: AuthState) => void): () => void
  signInWithEmail(email: string, password: string): Promise<AppUser>
  startEmailRegistration(input: SignUpWithEmailInput): Promise<EmailRegistrationStartResult>
  finalizeEmailRegistration(input: { email: string; password: string; registrationId: string; finalizationToken: string }): Promise<AppUser>
  signInWithGoogle(input?: { locale?: 'ar' | 'en'; termsAccepted?: boolean; termsVersion?: string; provisionProfile?: boolean; selectAccount?: boolean }): Promise<AppUser>
  provisionProfile?(input?: { displayName?: string; locale?: 'ar' | 'en'; termsAccepted?: boolean; termsVersion?: string }): Promise<AppUser>
  sendPasswordReset(email: string): Promise<void>
  requestEmailVerification(email: string, input?: { displayName?: string; locale?: 'ar' | 'en'; termsAccepted?: boolean; termsVersion?: string; termsAcceptedAt?: string }): Promise<{ success: boolean; status?: string; expiresAt?: string; resendAfterSeconds?: number; retryAfterSeconds?: number; error?: string }>
  verifyEmailCode(input: { email: string; code: string; registrationId?: string }): Promise<EmailVerificationResult>
  cancelEmailVerification?(input: { email: string; registrationId?: string }): Promise<{ success: boolean; status?: string; error?: string }>
  signOut(): Promise<void>
  getIdToken(forceRefresh?: boolean): Promise<string | null>
}

export type AccountAdapter = {
  getSubscription(): Promise<AccountSubscription>
  getSubscriptionProjection?(): Promise<SubscriptionProjection | null>
  updateProfile(input: { displayName: string }): Promise<AppUser>
  sendPasswordReset(): Promise<void>
  listSessions(): Promise<AccountSessionsResult>
  requestDeviceChange(deviceCode: string, reason?: string): Promise<AccountDeviceChangeRequest>
  revokeSession(sessionId: string, scope: 'session' | 'device'): Promise<void>
  revokeAllSessions(): Promise<void>
  getDeletionStatus(): Promise<AccountDeletionStatusResult>
  requestDeletion(reason?: string): Promise<AccountDeletionStatusResult>
  cancelDeletion(): Promise<AccountDeletionStatusResult>
}

export type ReleaseAdapter = {
  getLatest(channel?: 'stable' | 'beta'): Promise<ReleaseInfo>
  download(releaseId: string, filename?: string): Promise<void>
}

export type PlansAdapter = {
  listPlans(locale: 'ar' | 'en'): Promise<PlanInfo[]>
}

export type PaymentsAdapter = {
  createIntent(input: PaymentIntentInput): Promise<PaymentIntentResult>
  isCheckoutEnabled(): boolean
}

export type SupportAdapter = {
  isCustomerWebSupportEnabled(): boolean
  createTicket(input: { subject: string; body: string; attachments?: File[] }): Promise<{ success: boolean; threadId?: string; error?: string }>
  listThreads(): Promise<CustomerSupportThread[]>
  getThread(threadId: string): Promise<{ thread?: CustomerSupportThread; messages: CustomerSupportMessage[] }>
  replyThread(threadId: string, body: string, attachments?: File[]): Promise<{ success: boolean; error?: string }>
  downloadAttachment(attachment: CustomerSupportAttachment): Promise<void>
  setThreadStatus(threadId: string, status: 'open' | 'closed'): Promise<{ success: boolean; status?: string; error?: string }>
}

export type AccountNotification = {
  id: string
  type: string
  title: string
  body: string
  titleAr?: string
  bodyAr?: string
  linkedResourceType?: string
  linkedResourceId?: string
  portalStatus: string
  emailStatus: string
  readAt?: string
  createdAt: string
}

export type NotificationPage = {
  items: AccountNotification[]
  unreadCount: number
  nextCursor?: string
}

export type NotificationsAdapter = {
  list(input?: { cursor?: string; limit?: number }): Promise<NotificationPage>
  markRead(notificationId: string): Promise<void>
  markAllRead(): Promise<number>
  archive(notificationId: string): Promise<void>
}

export type AdminAdapter = {
  onIdentityChanged(callback: () => void): () => void
  getPreauthState(signal?: AbortSignal): Promise<{ authenticated: boolean }>
  submitPreauth(input: { username: string; password: string }, signal?: AbortSignal): Promise<{ authenticated: boolean }>
  signInWithGoogle(): Promise<AppUser>
  getSession(signal?: AbortSignal): Promise<AdminSession>
  getDashboard(signal?: AbortSignal): Promise<AdminDashboardState>
  getCommercePage(input: AdminCommerceQuery, signal?: AbortSignal): Promise<AdminCommercePage>
  getCommerceConfiguration(signal?: AbortSignal): Promise<AdminCommerceConfiguration>
  getCommerceOrder(id: string, view?: AdminOrderRecordsView, page?: number, signal?: AbortSignal): Promise<AdminOrderDetail>
  listUsers(input?: AdminUserDirectoryQuery, signal?: AbortSignal): Promise<{ items: AdminUserDirectoryItem[]; total: number; page: number; limit: number }>
  listSubscriptions(input?: { id?: string; search?: string; page?: number; limit?: number; lifecycle?: string; planTerm?: string; source?: string; current?: string; integrity?: string }, signal?: AbortSignal): Promise<{ items: AdminSubscription[]; total: number; page: number; limit: number }>
  createSubscription(input: {
    user_email: string
    firebase_user_id?: string
    plan: 'monthly' | 'yearly'
    tier: 'public' | 'private'
    expires_at?: string
    is_unlimited?: boolean
  }): Promise<AdminSubscription>
  previewManualGrant(input: ManualGrantPreviewInput): Promise<ManualGrantPreview>
  executeManualGrant(input: ManualGrantExecuteInput): Promise<ManualGrantResult>
  listPendingSubscriptionGrants(status: PendingSubscriptionGrant['status'] | 'all', page: number, signal?: AbortSignal): Promise<{ items: PendingSubscriptionGrant[]; total: number; page: number; limit: number }>
  cancelPendingSubscriptionGrant(grantId: string, reason: string): Promise<PendingSubscriptionGrant>
  listDeviceChangeRequests(params?: { status?: AdminDeviceChangeFilter; page?: number; limit?: number }, signal?: AbortSignal): Promise<AdminDeviceChangePage>
  getDeviceChangeRequest(requestId: string, signal?: AbortSignal): Promise<AdminDeviceChangeRequest>
  previewDeviceChange(requestId: string, input: { action: 'approve' | 'reject'; reason: string }): Promise<AdminDeviceChangePreview>
  executeDeviceChange(requestId: string, input: { action: 'approve' | 'reject'; reason: string; preview_hash: string; request_id: string }): Promise<{ item: AdminDeviceChangeRequest; idempotent: boolean }>
  previewDeviceReset(firebaseUid: string, reason: string): Promise<AdminDeviceResetPreview>
  executeDeviceReset(firebaseUid: string, input: { reason: string; preview_hash: string; request_id: string }): Promise<{ reset: boolean; idempotent: boolean }>
  updateSubscriptionStatus(id: string, status: AdminSubscription['status']): Promise<AdminSubscription>
  previewAccountLifecycle(firebaseUid: string, input: AdminOperationReason & { action: 'suspend' | 'reactivate' | 'mark_pending_deletion' }): Promise<AdminOperationPreview>
  executeAccountLifecycle(firebaseUid: string, input: AdminOperationReason & { action: 'suspend' | 'reactivate' | 'mark_pending_deletion'; preview_hash: string; request_id: string }): Promise<Record<string, unknown>>
  previewAccessRevocation(firebaseUid: string, input: AdminOperationReason & { scope: 'session' | 'device' | 'all'; target_id?: string }): Promise<AdminOperationPreview>
  executeAccessRevocation(firebaseUid: string, input: AdminOperationReason & { scope: 'session' | 'device' | 'all'; target_id?: string; preview_hash: string; request_id: string }): Promise<Record<string, unknown>>
  previewSubscriptionTransition(subscriptionId: string, input: AdminOperationReason & { action: 'suspend' | 'resume' | 'cancel_at_period_end' | 'cancel_now' | 'end_trial' | 'correct_expiry' | 'revoke_entitlement'; new_expiry?: string }): Promise<AdminOperationPreview>
  executeSubscriptionTransition(subscriptionId: string, input: AdminOperationReason & { action: 'suspend' | 'resume' | 'cancel_at_period_end' | 'cancel_now' | 'end_trial' | 'correct_expiry' | 'revoke_entitlement'; new_expiry?: string; preview_hash: string; request_id: string }): Promise<Record<string, unknown>>
  resetHwid(id: string): Promise<AdminSubscription>
  listPromoDirectory(input: AdminPromoDirectoryQuery, signal?: AbortSignal): Promise<AdminPromoDirectoryPage>
  createPromoCode(input: { code: string; title?: string; discount_type: 'percent' | 'fixed'; discount_value: number; is_private_tier_trigger: boolean; max_uses?: number; expires_at?: string }): Promise<AdminPromoCode>
  updatePromoCodeState(id: string, active: boolean, reason: string, expectedUpdatedAt: string): Promise<AdminPromoCode>
  listReleases(channel?: 'stable' | 'beta', signal?: AbortSignal): Promise<AdminReleaseManifest[]>
  getStagedRelease(channel: 'stable' | 'beta', version: string, signal?: AbortSignal): Promise<AdminStagedReleaseArtifacts>
  uploadRelease(input: { file: File; version: string; channel: string; artifactType: 'portable' | 'installed' }): Promise<AdminStagedReleaseArtifact>
  publishRelease(input: {
    version: string
    channel: string
    notes: string
    mandatory: boolean
    updateMode: 'optional' | 'force' | 'required' | 'silent'
    reviewedArtifacts: AdminReviewedReleaseArtifacts
    targetScope?: 'all' | 'selected'
    targetUserEmails?: string[]
  }): Promise<AdminReleaseManifest>
  getRemoteControls(channel?: string): Promise<AdminRemoteControls>
  updateRemoteControls(input: AdminRemoteControls & { channel: string }): Promise<AdminRemoteControls>
  listSupportInbox(input: AdminSupportInboxQuery, signal?: AbortSignal): Promise<AdminSupportInboxPage>
  downloadSupportAttachment(attachment: { id: string; filename: string }): Promise<void>
  getSupportConversation(threadId: string, signal?: AbortSignal): Promise<{ thread: AdminSupportThread; messages: AdminSupportMessage[]; unreadMessageIds: string[] }>
  getSupportHistory(threadId: string, cursor: string | null, signal?: AbortSignal): Promise<{ events: AdminSupportAuditEvent[]; nextCursor: string | null }>
  markSupportMessagesRead(threadId: string, ids: string[], signal?: AbortSignal): Promise<void>
  sendSupportReply(threadId: string, body: string, options?: { internal?: boolean; emailRequested?: boolean; idempotencyKey?: string }): Promise<{ emailQueued?: boolean }>
  updateSupportStatus(threadId: string, status: string, reason?: string, options?: { idempotencyKey?: string }): Promise<void>
  updateSupportPriority(threadId: string, priority: 'low' | 'normal' | 'high' | 'urgent'): Promise<void>
  setSupportBlocked(threadId: string, blocked: boolean, reason?: string): Promise<{ blocked: boolean; status?: string }>
  getEmailConfiguration(signal?: AbortSignal): Promise<AdminEmailConfiguration>
  listEmailActivity(input: AdminEmailActivityQuery, signal?: AbortSignal): Promise<AdminEmailActivityPage>
  getEmailJob(jobId: string, signal?: AbortSignal): Promise<AdminEmailJobDetail>
  processEmailOutbox(): Promise<AdminEmailQueueResult>
  retryEmailJob(jobId: string): Promise<AdminEmailProcessingResult>
  sendAdminTestEmail(input: { recipient: string; emailType?: string; locale?: 'ar' | 'en'; subject?: string; message?: string }): Promise<{ jobId: string; processing: AdminEmailProcessingResult }>
  listCrashLogs(filters?: AdminDiagnosticFilters, signal?: AbortSignal): Promise<AdminDiagnosticPage>
  getCrashLog(id: string, signal?: AbortSignal): Promise<AdminCrashLog>
  getDiagnosticTriage(params?: AdminDiagnosticFilters & { asOf?: string; summary?: boolean }, signal?: AbortSignal): Promise<AdminDiagnosticTriage>
  getDiagnosticCoverage(period: AdminDiagnosticCoveragePeriod, signal?: AbortSignal): Promise<AdminDiagnosticCoverage>
  updateCrashGroupState(fingerprint: string, input: { status: AdminCrashGroup['status']; assignee?: string; note?: string }): Promise<AdminCrashGroup>
  listTamperAlerts(input?: AdminTamperAlertFilters, signal?: AbortSignal): Promise<AdminTamperAlertPage>
  resolveTamperAlert(alertId: string, reason: string): Promise<AdminTamperAlert>
  listAuditLog(filters?: AdminAuditFilters, signal?: AbortSignal): Promise<AdminAuditPage>
  getUserDetail(userKey: string, signal?: AbortSignal): Promise<AdminUserDetail>
  getReadiness(signal?: AbortSignal): Promise<AdminReadiness>
  listInviteDirectory(query?: AdminInviteDirectoryQuery, signal?: AbortSignal): Promise<AdminInviteDirectoryPage>
  getInviteDetail(inviteId: string, page?: number, signal?: AbortSignal): Promise<AdminInviteDetail>
  createInvite(input: { request_id: string; expires_at?: string; max_uses?: number; note?: string; scope?: AdminInviteCode['scope']; restrictions?: AdminInviteCode['restrictions'] }): Promise<{ item: AdminInviteCode; code: string | null; shown_once?: boolean; replay?: boolean }>
  revokeInvite(inviteId: string, reason: string): Promise<void>
  getPolicyDirectory(input: AdminPolicyDirectoryQuery, signal?: AbortSignal): Promise<AdminPolicyDirectory>
  getPolicyVersion(version: string, signal?: AbortSignal): Promise<AdminPolicyVersionState>
  getPolicyPlan(id: string, signal?: AbortSignal): Promise<AdminPolicyPlanDetail>
  getGlobalPolicy(signal?: AbortSignal): Promise<AdminGlobalPolicy>
  updateGlobalPolicy(input: AdminGlobalPolicyChange): Promise<{ success: boolean; request_id: string; revision: string; replay: boolean }>
  updateDisabledVersion(input: AdminPolicyVersionChange): Promise<{ success: boolean; request_id: string; version: string; disabled: boolean; revision: string; replay: boolean }>
}

export type ContentAdapter = {
  getLegalPage(page: string, locale: 'ar' | 'en'): Promise<{ title: string; body: string }>
}

export type AppAdapters = {
  mode: RuntimeMode
  auth: AuthAdapter
  account: AccountAdapter
  releases: ReleaseAdapter
  plans: PlansAdapter
  payments: PaymentsAdapter
  support: SupportAdapter
  notifications: NotificationsAdapter
  admin: AdminAdapter
  content: ContentAdapter
}
