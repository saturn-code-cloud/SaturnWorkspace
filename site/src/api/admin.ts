import { ApiError } from './http'
import { firebaseAuth, firebaseAuthPersistenceReady } from '../lib/firebase'
import { parseServiceTimestamp } from '../lib/serviceTimestamp'

function adminBaseUrl() {
  if (typeof window === 'undefined') return '/api/admin'
  const host = window.location.hostname.toLowerCase()
  if (host === 'admin.saturnws.com' || host === 'admin-api.saturnws.com') return '/api/admin'
  return 'https://admin.saturnws.com/api/admin'
}

function compactAdminError(message: unknown, status: number, path: string) {
  const text = String(message || '').trim()
  const lower = text.toLowerCase()
  if (lower.startsWith('<!doctype') || lower.startsWith('<html') || lower.includes('site not found')) {
    return `admin_upstream_html_${status}:${path}`
  }
  return text || `request_failed_${status}:${path}`
}
if (typeof window !== 'undefined') {
  try { window.sessionStorage.removeItem('st_admin_firebase_token') } catch { /* Storage can be unavailable in restricted browsers. */ }
}

export type AdminSubscription = {
  id: string
  firebase_user_id?: string | null
  user_email?: string | null
  plan: 'monthly' | 'yearly'
  tier: 'public' | 'private'
  status: 'active' | 'past_due' | 'canceled' | 'expired' | 'suspended'
  hwid?: string | null
  bound_at?: string | null
  last_seen_at?: string | null
  expires_at: string
  metadata?: Record<string, unknown> | null
  created_at: string
  updated_at?: string
  lifecycle_state?: string | null
  effective_lifecycle?: string
  plan_term?: string | null
  renewal_state?: string | null
  source_type?: string | null
  provider?: string | null
  period_start_at?: string | null
  period_end_at?: string | null
  trial_starts_at?: string | null
  trial_ends_at?: string | null
  grace_ends_at?: string | null
  cancel_at_period_end?: boolean
  is_current?: boolean
  integrity_state?: string
  identity_authority?: 'firebase_uid' | 'legacy_email_only'
  is_current_record?: boolean
  is_current_projection?: boolean
  integrity_warning?: string | null
  subscription_projection?: {
    existence?: string
    lifecycle?: string | null
    plan_term?: string | null
    entitlement?: string
  } | null
}

export type AdminUserSummary = {
  firebase_uid: string
  email: string
  display_name?: string | null
  locale?: string | null
  account_status: string
  email_verified_at?: string | null
  last_login_at?: string | null
  last_activity_at?: string | null
  session_count?: number
  device_count?: number
  subscription_presence?: 'none' | 'active' | 'history_only' | 'integrity_conflict'
  created_at: string
  subscription_projection: {
    existence?: string
    lifecycle?: string | null
    plan_term?: string | null
    entitlement?: string
  }
  subscription_integrity?: { integrity?: string; code?: string | null }
}

export type AdminUserDirectoryItem = Pick<AdminUserSummary,
  'firebase_uid' | 'email' | 'display_name' | 'account_status' | 'created_at' | 'last_activity_at'
> & {
  subscription_presence: NonNullable<AdminUserSummary['subscription_presence']>
  session_count: number
  device_count: number
}

export type AdminUserDirectoryQuery = {
  search?: string; exactEmail?: boolean; page?: number; limit?: number; accountStatus?: string;
  verification?: string; subscription?: string; sort?: string;
}

export type AdminCommerceOrder = {
  id: string; firebase_uid: string; user_email: string | null; plan_id: string; plan_version: number
  status: 'creating' | 'provider_unavailable' | 'awaiting_payment' | 'confirming' | 'paid' | 'underpaid' | 'overpaid' | 'expired' | 'failed' | 'cancelled' | 'refunded' | 'manual_review'
  amount_minor: number; currency: string; provider: string | null; provider_order_id: string | null; created_at: string; updated_at: string; expires_at: string
}
export type AdminCommercePlan = { plan_id: string; version: number; display_name: string; term: string; price_minor: number; original_price_minor?: number | null; currency: string; active: boolean; public_visible: boolean; purchasable: boolean; provider: string | null; trial_days: number; config_status: string; updated_at: string; checkout_available: boolean }
export type AdminCommerceIntegrity = { id: string; firebase_uid: string | null; subscription_id: string | null; code: string; severity: 'info' | 'warning' | 'critical'; source: string; resolved_at: string | null; created_at: string }
export type AdminCommerceView = 'orders' | 'plans' | 'integrity'
export type AdminCommerceQuery = { view: AdminCommerceView; query?: string; status?: string; page?: number }
type AdminCommercePageMeta = { success: true; query: string; status: string; page: number; limit: number; total: number; has_more: boolean; generated_at: string }
export type AdminCommercePage = AdminCommercePageMeta & (
  { view: 'orders'; items: AdminCommerceOrder[] } | { view: 'plans'; items: AdminCommercePlan[] } | { view: 'integrity'; items: AdminCommerceIntegrity[] }
)
export type AdminPaymentAttempt = { id: string; order_id: string; provider: string; provider_payment_id: string | null; status: string; requested_amount_minor: number; received_amount_minor: number | null; currency: string; created_at: string; updated_at: string }
export type AdminPaymentEvent = { id: string; order_id: string; provider: string; provider_event_id: string; event_type: string; signature_verified: boolean; processing_status: string; received_at: string; processed_at: string | null; error_code: string | null }
export type AdminPaymentReceipt = { id: string; order_id: string; provider_receipt_id: string | null; document_type: 'receipt' | 'invoice'; issued_at: string | null; created_at: string }
export type AdminOrderRecordsView = 'attempts' | 'events' | 'receipts'
type AdminOrderDetailMeta = { success: true; order: AdminCommerceOrder; unavailable: boolean; total: number | null; page: number; limit: number; has_more: boolean; generated_at: string }
export type AdminOrderDetail = AdminOrderDetailMeta & ({ view: 'attempts'; items: AdminPaymentAttempt[] | null } | { view: 'events'; items: AdminPaymentEvent[] | null } | { view: 'receipts'; items: AdminPaymentReceipt[] | null })
export type AdminCommerceConfiguration = { success: true; checkout_available: false; providers: Record<'stripe' | 'nowpayments', { configured: boolean; implemented: false; available: false }>; generated_at: string }

export type ManualGrantOperation = 'extend_current' | 'replace_current' | 'start_from_now' | 'restore_remaining_time'
export type ManualGrantPlan = 'weekly' | 'monthly' | 'annual' | 'lifetime' | 'custom' | 'manual'
export type ManualGrantDurationUnit = 'hours' | 'days' | 'weeks' | 'months'

export type ManualGrantPreviewInput = {
  target_firebase_uid?: string
  target_email?: string
  operation_type: ManualGrantOperation
  plan: ManualGrantPlan
  duration_mode: 'duration' | 'exact' | 'lifetime'
  duration_value?: number
  duration_unit?: ManualGrantDurationUnit
  exact_expiry?: string
  timezone?: string
  reason?: string
  reason_code?: 'admin_grant' | 'compensation' | 'trial' | 'technical_support' | 'subscription_replacement' | 'subscription_recovery' | 'other'
  reason_note?: string
  recovery_evidence_id?: string
}

export type ManualGrantExecuteInput = ManualGrantPreviewInput & {
  reason: string
  idempotency_key: string
  preview_hash?: string
}

export type ManualGrantPreview = {
  target: { firebase_user_id?: string | null; user_email?: string | null }
  current_subscription?: Partial<AdminSubscription> | null
  latest_subscription?: Partial<AdminSubscription> | null
  history_summary: {
    total_rows: number
    usable_rows: number
    historical_rows: number
    duplicate_groups?: Record<string, unknown>
  }
  requested_operation: Record<string, unknown>
  proposed_state: {
    operation: ManualGrantOperation
    source: 'admin_manual' | 'admin_recovery'
    plan_intent: ManualGrantPlan
    db_plan: 'monthly' | 'yearly'
    starts_at: string | null
    expires_at: string | null
    is_lifetime: boolean
    resulting_entitlement: string
  }
  affected_rows: string[]
  warnings: string[]
  blocked: boolean
  pending_registration?: boolean
  preview_hash: string
}

export type PendingSubscriptionGrant = {
  id: string
  normalized_email: string
  status: 'pending' | 'claimed' | 'cancelled' | 'expired'
  plan_term: ManualGrantPlan
  duration_mode: 'duration' | 'exact' | 'lifetime'
  duration_value?: number | null
  duration_unit?: ManualGrantDurationUnit | null
  exact_expiry?: string | null
  claim_deadline: string
  reason_code: string
  reason_note?: string | null
  created_by: string
  claimed_by_uid?: string | null
  resulting_subscription_id?: string | null
  claimed_at?: string | null
  cancelled_at?: string | null
  cancelled_by?: string | null
  cancellation_reason?: string | null
  created_at: string
  updated_at: string
}

export type ManualGrantResult = {
  success: boolean
  request_id: string
  item: AdminSubscription | null
  pending_grant?: PendingSubscriptionGrant | null
  preview: ManualGrantPreview
  auto_authorized_requests?: number
  idempotent_replay?: boolean
}

export type AdminAccessRequest = {
  id: string
  user_id?: string | null
  user_email?: string | null
  hwid?: string | null
  status: string
  created_at?: string | null
  authorized_at?: string | null
  consumed_at?: string | null
  expires_at?: string | null
  request_count: number
  last_event_at?: string | null
  has_subscription: boolean
  subscription_status?: string | null
  subscription_expires_at?: string | null
  subscription_id?: string | null
}

export type AdminDeviceChangeRequest = {
  id: string
  firebase_uid: string
  current_binding_id: string | null
  resulting_binding_id: string | null
  requested_device_key: string
  device_name: string | null
  platform: string | null
  os_version: string | null
  app_version: string | null
  user_reason: string | null
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  requested_at: string
  resolved_at: string | null
  resolved_by: string | null
  resolution_note: string | null
  created_at: string
  updated_at: string
  account?: Pick<AdminUserSummary, 'firebase_uid' | 'display_name' | 'account_status'> & { normalized_email?: string } | null
}

export type AdminDeviceBinding = {
  id: string
  firebase_uid: string
  device_key: string
  device_name: string | null
  platform: string | null
  os_version: string | null
  app_version: string | null
  status: string
  bound_at: string
  last_seen_at: string
  released_at: string | null
  created_at: string
  updated_at: string
}

export type AdminDeviceChangePreview = {
  request: AdminDeviceChangeRequest
  account: AdminDeviceChangeRequest['account']
  action: 'approve' | 'reject'
  reason: string
  preview_hash: string
}

export type AdminDeviceResetPreview = {
  binding: AdminDeviceBinding
  active_session_count: number
  reason: string
  preview_hash: string
}

export type AdminPromoCode = {
  id: string
  code: string
  discount_type: 'percent' | 'fixed'
  discount_value: number
  is_private_tier_trigger: boolean
  is_active: boolean
  max_uses?: number | null
  used_count?: number
  expires_at?: string | null
  title?: string | null
  currency?: string
  starts_at?: string | null
  created_at?: string
  updated_at?: string
  effective_status?: AdminPromoStatus
}

export type AdminPromoStatus = 'active' | 'paused' | 'scheduled' | 'expired' | 'exhausted'
export type AdminPromoDirectoryQuery = { query?: string; status?: AdminPromoStatus | ''; page?: number; limit?: number }
export type AdminPromoDirectoryPage = { success: true; items: AdminPromoCode[]; page: number; limit: number; has_more: boolean; query: string; status: string; generated_at: string }

export type AdminOtaUpdate = {
  id: string
  version: string
  channel: string
  release_notes: string
  download_url: string
  is_mandatory: boolean
  is_published: boolean
  rollout_percent?: number
  minimum_supported_version?: string | null
  force_update_deadline?: string | null
  created_at: string
}

export type AdminCrashLog = {
  id: string
  happened_at: string
  user_id?: string | null
  subscription_id?: string | null
  license_id?: string | null
  hwid?: string | null
  device_name?: string | null
  windows_version?: string | null
  cpu?: string | null
  gpu?: string | null
  ram_gb?: number | null
  error_type: string
  message?: string | null
  stack_trace: string
  app_version?: string | null
  tool_channel?: string | null
  fingerprint?: string | null
  classification?: 'error' | 'warning'
  event_id?: string | null
  component?: string | null
  context?: string | null
  severity?: string | null
  attribution?: 'verified' | 'unattributed' | 'legacy_unverified'
  operator?: { firebase_uid: string; email?: string | null; display_name?: string | null } | null
  occurrence_count?: number
  first_happened_at?: string | null
  last_happened_at?: string | null
  technical_context?: Record<string, unknown>
  raw_payload?: {
    auth?: {
      source?: string | null
      firebase_user_id?: string | null
      user_email?: string | null
      warning?: string | null
    } | null
    request?: {
      ip?: string | null
      user_agent?: string | null
      colo?: string | null
      country?: string | null
    } | null
    [key: string]: unknown
  } | null
}

export type AdminDiagnosticFilters = {
  user?: string
  search?: string
  cursor?: string
  limit?: number
  classification?: 'error' | 'warning' | 'all'
  attribution?: 'verified' | 'unattributed'
  component?: string
}

export type AdminDiagnosticPage<T = AdminCrashLog> = {
  success: boolean
  items: T[]
  has_more: boolean
  next_cursor: string | null
  retention_days: number
  summarized_reports?: number
}

export type AdminCrashGroup = {
  fingerprint: string
  count: number
  first_seen_at: string
  last_seen_at: string
  latest_report_id?: string
  error_type: string
  message?: string | null
  affected_hwids?: string[]
  affected_users?: string[]
  affected_device_count?: number
  affected_user_count?: number
  affected_versions?: string[]
  status?: 'open' | 'investigating' | 'resolved' | 'ignored'
  assignee?: string | null
  note?: string | null
  state_updated_at?: string | null
  latest?: AdminCrashLog
}

export type AdminDiagnosticTriage = {
  items: AdminCrashGroup[]
  counts: { recent: number; attention: number }
  window: { as_of: string; scan_limit: number; scanned_reports: number; matched_error_reports: number; has_older: boolean }
}

export type AdminDiagnosticCoveragePeriod = { from: string; to: string }
export type AdminDiagnosticCoverage = {
  window: {
    from: string
    to: string
    retention_limited: boolean
    scanned_reports: number
    total_records: number
    oldest_scanned_at: string | null
    limited: boolean
  }
  totals: { errors: number; warnings: number }
  versions: Array<{
    tool_channel: string | null
    app_version: string | null
    errors: number
    warnings: number
    latest_report_id: string
    latest_report_at: string
  }>
}

export type AdminAuditLogItem = {
  id?: string
  action?: string
  type?: string
  entity?: string
  entity_id?: string | null
  admin_email?: string | null
  actor?: string | null
  payload?: unknown
  happened_at?: string
  at?: string
  timestamp?: string
  actor_role?: string | null
  target_type?: string | null
  target_id?: string | null
  request_id?: string | null
  reason_code?: string | null
  reason_note?: string | null
  outcome?: string
  source_service?: string
}

export type AdminAuditFilters = { search?: string; cursor?: string; limit?: number }
export type AdminAuditPage = { success: boolean; items: AdminAuditLogItem[]; has_more: boolean; next_cursor: string | null }

export type AdminSession = {
  success: boolean
  email: string
  role: 'super_admin' | 'support' | 'billing' | 'release_manager' | 'security_auditor' | 'read_only'
  permissions: string[]
}

export type AdminOperationReason = {
  reason_code: 'admin_action' | 'customer_request' | 'security_review' | 'technical_support' | 'billing_correction' | 'subscription_recovery' | 'policy_enforcement' | 'other'
  reason_note?: string
}

export type AdminOperationPreview = {
  preview_hash: string
  action?: string
  scope?: string
  target: Record<string, unknown>
  current_status?: string
  resulting_status?: string
  current?: Record<string, unknown>
  resulting?: Record<string, unknown>
  sessions_will_be_revoked?: boolean
  expected_updated_at?: string
  reason_code: string
  reason_note?: string | null
}

export type AdminTamperAlert = {
  id: string
  happened_at: string
  device_key?: string | null
  severity: 'low' | 'medium' | 'high' | 'critical'
  reason: string
  resolved: boolean
  resolved_at?: string | null
}

export type AdminTamperAlertFilters = { page?: number; limit?: number; resolved?: boolean; severity?: string; user?: string }
export type AdminTamperAlertPage = { success: boolean; items: AdminTamperAlert[]; page: number; limit: number; has_more: boolean }

export type AdminReadinessCheck = {
  id: string
  group: 'database' | 'configuration' | 'security'
  kind: 'read' | 'configuration'
  status: 'passed' | 'configured' | 'missing' | 'unavailable' | 'disabled' | 'review'
  reason: 'read_succeeded' | 'schema_missing' | 'read_unavailable' | 'not_configured' | 'configuration_present' | 'flag_enabled' | 'flag_disabled' | 'role_configuration_missing' | 'integration_not_active' | 'configuration_present_disabled'
}

export type AdminReadiness = {
  success: boolean
  generated_at: string
  checks: AdminReadinessCheck[]
  services: Record<string, string>
  integrations: Record<string, string>
  admin_security: Record<string, string>
}

export type AdminInviteCode = {
  id: string
  status: string
  effective_status?: 'active' | 'expired' | 'exhausted' | 'revoked' | 'blocked'
  expires_at?: string | null
  max_uses?: number | null
  used_count: number
  note?: string | null
  scope?: { channels?: string[]; app_versions?: string[] }
  restrictions?: { user_ids?: string[]; emails?: string[]; device_ids?: string[]; install_ids?: string[]; one_per_user?: boolean; one_per_device?: boolean }
  created_by?: string | null
  created_at?: string
  updated_at?: string
  revoked_at?: string | null
  revoked_by?: string | null
  revoke_reason?: string | null
}

export type AdminInviteDirectoryQuery = { query?: string; status?: string; page?: number }
export type AdminInviteDirectoryPage = { success: true; items: AdminInviteCode[]; query: string; status: string; page: number; limit: number; has_more: boolean; generated_at: string }
export type AdminInviteDetail = { success: true; item: AdminInviteCode; items: AdminInviteUsage[]; page: number; limit: number; has_more: boolean; generated_at: string }

export type AdminInviteUsage = {
  id: string
  user_id?: string | null
  email?: string | null
  install_id?: string | null
  device_id?: string | null
  app_version?: string | null
  channel?: string | null
  result: string
  created_at: string
}


export type AdminSupportThread = {
  id: string
  subject: string
  status?: string
  email?: string | null
  install_id?: string | null
  device_id?: string | null
  app_version?: string | null
  app_build_id?: string | null
  channel?: string | null
  platform?: string | null
  created_at?: string
  updated_at?: string
  last_message_body?: string | null
  last_message_sender?: string | null
  last_message_at?: string | null
  unread_count?: number
  support_blocked?: boolean | number
  priority?: 'low' | 'normal' | 'high' | 'urgent' | string
  assigned_admin_id?: string | null
  last_customer_reply_at?: string | null
  last_support_reply_at?: string | null
}

export type AdminSupportMessage = {
  id: string
  thread_id: string
  sender: 'user' | 'admin' | 'system' | 'internal' | string
  body: string
  created_at?: string
  sender_role?: string | null
  delivery_mode?: string | null
  source?: string | null
  provider_message_id?: string | null
  attachments?: Array<{ id: string; filename: string; mime_type: string; size_bytes: number; status: string; download_url: string }>
}

export type AdminSupportAuditEvent = {
  id: string
  event_type: string
  actor_role: string
  actor_id?: string | null
  message_id?: string | null
  metadata_json?: string | null
  created_at?: string
}

export type AdminEmailJob = {
  id: string
  email_type: string
  catalog_event_type?: string | null
  template_key?: string | null
  template_version?: number | null
  email_category?: string | null
  recipient: string
  sender?: string | null
  subject: string
  linked_user_id?: string | null
  linked_ticket_id?: string | null
  status: string
  attempt_count?: number
  max_attempts?: number
  provider_message_id?: string | null
  last_error?: string | null
  last_attempt_at?: string | null
  next_attempt_at?: string | null
  sensitive_payload_state?: 'none' | 'available' | 'expired' | 'purged'
  sent_at?: string | null
  delivered_at?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export type AdminInboundEmailMessage = {
  id: string
  provider_email_id?: string | null
  thread_id?: string | null
  sender_email?: string | null
  recipient_email?: string | null
  subject?: string | null
  status: string
  rejection_reason?: string | null
  received_at?: string | null
  processed_at?: string | null
  created_at?: string | null
}

export type AdminEmailCatalogItem = {
  event_type: string
  template_key: string
  template_version: number
  category: string
  sender_identity: string
  title_en: string
  title_ar: string
  description_en: string
  description_ar: string
  default_subject_en?: string
  default_subject_ar?: string
  integration_status: 'linked' | 'prepared' | 'disabled' | 'backend_missing'
  user_can_disable: boolean
  retry_allowed: boolean
  essential: boolean
  requires_backend_event: boolean
  admin_test_allowed: boolean
}

export type AdminEmailProviderEvent = {
  id: string
  event_type: string
  provider_message_id?: string | null
  email_job_id?: string | null
  processed_at?: string | null
  created_at?: string | null
}

export type AdminEmailRecipientFlag = {
  email: string
  status: string
  reason?: string | null
  provider_message_id?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export type AdminScheduledEmail = {
  id: string
  event_type: string
  recipient: string
  status: string
  scheduled_for: string
  attempts?: number | null
  last_error?: string | null
  linked_user_id?: string | null
  linked_ticket_id?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export type AdminEmailStatus = {
  success: boolean
  generated_at?: string
  config: {
    outbound_enabled: boolean
    inbound_enabled: boolean
    scheduler_enabled?: boolean
    category_flags?: Record<string, boolean>
    has_resend_send_api_key: boolean
    has_resend_receive_api_key: boolean
    has_resend_webhook_secret: boolean
    from: string
    sender_identities?: Record<string, string>
    reply_domain: string
    webhook_path: string
    schema?: { ok: boolean; missing: string[] }
  }
  metrics?: {
    catalog_total?: number
    catalog_linked?: number
    catalog_prepared?: number
    catalog_disabled?: number
    latest_event_at?: string | null
  }
  catalog?: AdminEmailCatalogItem[]
  counts: Array<{ status: string; count: number }>
  jobs: AdminEmailJob[]
  inbound: AdminInboundEmailMessage[]
  provider_events?: AdminEmailProviderEvent[]
  recipient_flags?: AdminEmailRecipientFlag[]
  scheduled?: AdminScheduledEmail[]
}

export type AdminEmailConfiguration = Pick<AdminEmailStatus, 'success' | 'generated_at' | 'config'> & { catalog: AdminEmailCatalogItem[] }
export type AdminEmailActivityItems = { outbound: AdminEmailJob; inbound: AdminInboundEmailMessage; scheduled: AdminScheduledEmail; events: AdminEmailProviderEvent; flags: AdminEmailRecipientFlag }
export type AdminEmailActivityView = keyof AdminEmailActivityItems
export type AdminEmailActivityQuery = { view: AdminEmailActivityView; query?: string; status?: string; page?: number; limit?: number; jobId?: string }
export type AdminEmailActivityPage = { [V in AdminEmailActivityView]: { success: true; view: V; items: AdminEmailActivityItems[V][]; query: string; status: string; job_id: string | null; page: number; limit: number; has_more: boolean; generated_at: string } }[AdminEmailActivityView]
export type AdminEmailJobDetail = { success: true; job: AdminEmailJob & { retry_allowed: boolean; retry_blocked_reason: string | null; recipient_status?: string | null }; events: AdminEmailProviderEvent[]; events_has_more: boolean; events_unavailable: boolean; generated_at: string }
export type AdminEmailProcessingResult = { processed: number; sent: number; skipped: number }
export type AdminEmailQueueResult = AdminEmailProcessingResult | { skipped: true }

export type AdminRemoteControls = {
  rollout_percent?: number
  minimum_supported_version?: string
  force_update_deadline?: string
  remote_config?: {
    update_mode?: 'optional' | 'force' | 'required' | 'silent'
    kill_switch_enabled?: boolean
    kill_switch_message?: string
    feature_flags?: Record<string, unknown>
    announcements?: Array<{
      id?: string
      title?: string
      body?: string
      severity?: 'info' | 'warning' | 'critical'
      starts_at?: string
      ends_at?: string
    }>
  }
}

export type AdminUserDetail = {
  success: boolean
  profile: AdminUserSummary
  item: AdminSubscription | null
  subscription_projection?: AdminUserSummary['subscription_projection']
  subscription_integrity?: AdminUserSummary['subscription_integrity']
  subscription_history?: Array<Record<string, unknown>>
  sessions: Array<Record<string, unknown>>
  login_requests: Array<Record<string, unknown>>
  devices: Array<Record<string, unknown>>
  device_binding?: AdminDeviceBinding | null
  device_binding_history?: AdminDeviceBinding[]
  device_change_requests?: AdminDeviceChangeRequest[]
  audit?: AdminAuditLogItem[] | null
  recovery_evidence?: Array<{ id: string; subscription_id?: string | null; evidence_type: string; evidence_reference: string; remaining_seconds: number; status: string; created_at: string; expires_at?: string | null }>
  support_threads?: AdminSupportThread[]
  request?: {
    user_id?: string | null
    user_email?: string | null
    device_key?: string | null
    status?: string | null
    last_event_at?: string | null
    expires_at?: string | null
  } | null
}

async function getAdminToken(signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted()
  const pending = (async () => {
    await firebaseAuthPersistenceReady
    await firebaseAuth.authStateReady()
    const user = firebaseAuth.currentUser
    if (!user) return ''
    let token: string
    try { token = await user.getIdToken(false) }
    catch (error) {
      const code = String((error as { code?: unknown })?.code || '')
      if (['auth/user-token-expired', 'auth/invalid-user-token', 'auth/user-disabled'].includes(code)) throw new ApiError('firebase_token_invalid', 401)
      throw new ApiError('admin_identity_unavailable', 503)
    }
    if (firebaseAuth.currentUser !== user) throw new ApiError('unauthorized', 401)
    return token
  })()
  if (!signal) return pending
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    void pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

async function adminFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {})
  const isFormData = typeof FormData !== 'undefined' && init.body instanceof FormData
  if (!headers.has('Content-Type') && init.body && !isFormData) headers.set('Content-Type', 'application/json')
  const token = path === '/preauth' || path.startsWith('/preauth/') ? '' : await getAdminToken(init.signal || undefined)
  init.signal?.throwIfAborted()
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const response = await fetch(`${adminBaseUrl()}${path}`, { ...init, headers, credentials: 'same-origin' })
  const raw = await response.text()
  let payload: unknown
  try {
    payload = raw ? JSON.parse(raw) : undefined
  } catch {
    payload = undefined
  }
  if (!response.ok) {
    const rawMessage =
      typeof payload === 'object' && payload !== null && 'error' in payload && typeof payload.error === 'string'
        ? payload.error
        : raw || `request_failed_${response.status}`
    const message = compactAdminError(rawMessage, response.status, path)
    throw new ApiError(message, response.status)
  }
  if (payload === undefined && raw) throw new ApiError(compactAdminError(raw, response.status, path), response.status)
  return payload as T
}

export async function fetchAdminPreauthState(signal?: AbortSignal) {
  const state = await adminFetch<{ success: boolean; authenticated: boolean } | null>('/preauth/state', { signal })
  if (state?.success !== true || typeof state.authenticated !== 'boolean') throw new Error('admin_preauth_unavailable')
  return state
}

export async function submitAdminPreauth(payload: { username: string; password: string }, signal?: AbortSignal) {
  const state = await adminFetch<{ success: boolean; authenticated: boolean } | null>('/preauth', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  })
  if (state?.success !== true || typeof state.authenticated !== 'boolean') throw new Error('admin_preauth_unavailable')
  return state
}

export async function clearAdminPreauth() {
  return adminFetch<{ success: boolean }>('/preauth/logout', {
    method: 'POST',
  })
}

export async function fetchAdminSession(signal?: AbortSignal) {
  const session = await adminFetch<AdminSession | null>('/session', { signal })
  if (session?.success !== true || typeof session.email !== 'string' || !session.email.trim() || !['super_admin', 'support', 'billing', 'release_manager', 'security_auditor', 'read_only'].includes(session.role) || !Array.isArray(session.permissions) || session.permissions.length > 100 || session.permissions.some((permission) => typeof permission !== 'string' || !/^(?:\*|[a-z_]+:[a-z_]+)$/.test(permission)) || new Set(session.permissions).size !== session.permissions.length) throw new Error('admin_session_unavailable')
  return session
}

const dashboardCounts = [
  ['total_users', 'profiles'], ['total_active_users', 'subscriptions'],
  ['active_sessions', 'sessions'], ['active_tampering_alerts', 'tamper'],
] as const

export async function fetchAdminDashboard(signal?: AbortSignal) {
  const data = await adminFetch<{
    success: boolean; kpis?: Record<string, unknown>; recent_activity?: AdminAuditLogItem[]
    degraded_resources?: string[]; subscription_count_limited?: boolean
  }>('/dashboard', { signal, cache: 'no-store' })
  if (data?.success !== true) throw new Error('dashboard_unavailable')
  const degraded = new Set(Array.isArray(data.degraded_resources) ? data.degraded_resources : [])
  const kpis: Record<(typeof dashboardCounts)[number][0] | 'total_revenue', number | null> = {
    total_users: null, total_active_users: null, active_sessions: null, active_tampering_alerts: null, total_revenue: null,
  }
  for (const [field, source] of dashboardCounts) {
    const value = data.kpis?.[field]
    if (degraded.has(source)) continue
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) kpis[field] = value
    else if (value !== null || (source !== 'tamper' && !(source === 'subscriptions' && data.subscription_count_limited === true))) degraded.add(source)
  }
  const limited = data.subscription_count_limited === true
  if (limited) kpis.total_active_users = null
  const activity = data.recent_activity
  if (!Array.isArray(activity) || activity.length > 20 || activity.some((item) => !item ||
    typeof item.id !== 'string' || !item.id || typeof item.action !== 'string' || !item.action.trim() ||
    !parseServiceTimestamp(item.timestamp)) || new Set(activity.map((item) => item.id)).size !== activity.length) degraded.add('activity')
  return {
    kpis,
    recent_activity: degraded.has('activity') ? [] : (activity ?? []).map((item) => ({
      id: item.id!,
      action: item.action,
      timestamp: item.timestamp,
      actor: typeof item.actor === 'string' ? item.actor : null,
      target_type: typeof item.target_type === 'string' ? item.target_type : null,
      target_id: typeof item.target_id === 'string' ? item.target_id : null,
      outcome: typeof item.outcome === 'string' ? item.outcome : undefined,
      request_id: typeof item.request_id === 'string' ? item.request_id : null,
    })),
    degraded_resources: [...degraded],
    subscription_count_limited: limited,
  }
}

export async function fetchSubscriptions(params: { id?: string; search?: string; page?: number; limit?: number; lifecycle?: string; planTerm?: string; source?: string; current?: string; integrity?: string } = {}, signal?: AbortSignal, directory = false) {
  const query = new URLSearchParams()
  if (directory) query.set('view', 'directory')
  if (params.id) query.set('id', params.id)
  query.set('limit', String(params.limit ?? 100))
  if (params.page) query.set('page', String(params.page))
  if (params.search) query.set('search', params.search)
  if (params.lifecycle) query.set('lifecycle', params.lifecycle)
  if (params.planTerm) query.set('plan_term', params.planTerm)
  if (params.source) query.set('source', params.source)
  if (params.current) query.set('current', params.current)
  if (params.integrity) query.set('integrity', params.integrity)
  return adminFetch<{ success: boolean; view?: string; items: AdminSubscription[]; total: number; page: number; limit: number }>(`/subscriptions?${query}`, { signal })
}

export async function createSubscription(payload: {
  user_email: string
  firebase_user_id?: string
  hwid?: string
  plan: 'monthly' | 'yearly'
  tier: 'public' | 'private'
  expires_at?: string
  is_unlimited?: boolean
}) {
  return adminFetch<{ success: boolean; item: AdminSubscription; auto_authorized_requests?: number }>('/subscriptions', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function fetchAccessRequests(params: { search?: string; limit?: number } = {}) {
  const query = new URLSearchParams()
  query.set('limit', String(params.limit ?? 100))
  if (params.search) query.set('search', params.search)
  return adminFetch<{ success: boolean; items: AdminAccessRequest[] }>(`/access-requests?${query}`)
}

export async function patchSubscriptionStatus(id: string, status: AdminSubscription['status']) {
  return adminFetch<{ success: boolean; item: AdminSubscription }>(`/subscriptions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })
}

export async function resetSubscriptionHwid(id: string, revokeSessions = true) {
  return adminFetch<{ success: boolean; item: AdminSubscription }>(`/subscriptions/${encodeURIComponent(id)}/reset-hwid`, {
    method: 'POST',
    body: JSON.stringify({ revoke_sessions: revokeSessions }),
  })
}

export async function fetchPromoCodes() {
  return adminFetch<{ success: boolean; items: AdminPromoCode[] }>('/promo-codes?limit=100')
}

export async function fetchAdminPromoDirectory(input: AdminPromoDirectoryQuery = {}, signal?: AbortSignal) {
  const query = new URLSearchParams({ view: 'management', page: String(input.page ?? 1), limit: String(input.limit ?? 25) })
  if (input.query?.trim()) query.set('query', input.query.trim())
  if (input.status) query.set('status', input.status)
  const result = await adminFetch<AdminPromoDirectoryPage>(`/promo-codes?${query}`, { signal })
  if (result?.success !== true || !Array.isArray(result.items) || result.page !== (input.page ?? 1) || result.limit !== (input.limit ?? 25) ||
      result.query !== (input.query || '').trim() || result.status !== (input.status || '') || typeof result.has_more !== 'boolean' || !Number.isFinite(Date.parse(result.generated_at)) ||
      result.items.length > result.limit ||
      !result.items.every((item) => typeof item?.id === 'string' && typeof item.code === 'string' && typeof item.is_active === 'boolean' &&
        ['percent', 'fixed'].includes(item.discount_type) && typeof item.discount_value === 'number' && Number.isFinite(item.discount_value) && item.discount_value >= 0 &&
        ['active', 'paused', 'scheduled', 'expired', 'exhausted'].includes(item.effective_status || '') && Number.isFinite(Date.parse(item.updated_at || ''))) ||
      new Set(result.items.map((item) => item.id)).size !== result.items.length) throw new Error('promo_codes_unavailable')
  return result
}

export async function createPromoCode(payload: {
  code: string
  discount_type: 'percent' | 'fixed'
  discount_value: number
  is_private_tier_trigger: boolean
  max_uses?: number
  expires_at?: string
  title?: string
}) {
  return adminFetch<{ success: boolean; item: AdminPromoCode }>('/promo-codes', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function fetchOtaUpdates() {
  return adminFetch<{ success: boolean; items: AdminOtaUpdate[] }>('/ota-updates?limit=100')
}

export async function createOtaUpdate(payload: {
  version: string
  channel: string
  release_notes: string
  download_url: string
  is_mandatory: boolean
  is_published?: boolean
}) {
  return adminFetch<{ success: boolean; item: AdminOtaUpdate }>('/ota-updates', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export type AdminReleaseUpload = {
  key: string
  channel: string
  version: string
  filename: string
  size: number
  sha256: string
  uploaded_at: string
  uploaded_by: string
  package_type?: 'portable_exe' | 'installed_zip'
}

export type AdminStagedReleaseArtifact = {
  filename: string
  size_bytes: number
  revision: string
}

export type AdminStagedReleaseArtifacts = Record<'portable' | 'installed', AdminStagedReleaseArtifact | null>
export type AdminReviewedReleaseArtifacts = Record<'portable' | 'installed', string | null>

export async function updatePromoCodeState(id: string, active: boolean, reason: string, expectedUpdatedAt: string) {
  return adminFetch<{ success: boolean; item: AdminPromoCode }>(`/promo-codes/${encodeURIComponent(id)}/state`, { method: 'POST', body: JSON.stringify({ active, reason, expected_updated_at: expectedUpdatedAt }) })
}

export async function fetchAdminUsers(params: AdminUserDirectoryQuery = {}, signal?: AbortSignal) {
  const query = new URLSearchParams()
  query.set('limit', String(params.limit ?? 100))
  if (params.search) query.set('search', params.search)
  if (params.exactEmail) query.set('exact_email', 'true')
  if (params.page) query.set('page', String(params.page))
  if (params.accountStatus) query.set('account_status', params.accountStatus)
  if (params.verification) query.set('verification', params.verification)
  if (params.subscription) query.set('subscription', params.subscription)
  if (params.sort) query.set('sort', params.sort)
  const data = await adminFetch<{ success: boolean; directory_version: number; items: AdminUserDirectoryItem[]; total: number; page: number; limit: number; exact_email: string | null }>(`/users?${query}`, { signal })
  const exactEmail = params.exactEmail ? (params.search || '').trim().toLowerCase() : null
  if (data?.success !== true || data.directory_version !== 1 || data.exact_email !== exactEmail ||
      !Array.isArray(data.items) || data.page !== (params.page ?? 1) || data.limit !== (params.limit ?? 100) ||
      !Number.isSafeInteger(data.total) || data.total < 0 ||
      data.items.length !== Math.max(0, Math.min(data.limit, data.total - ((data.page - 1) * data.limit))) ||
      (exactEmail && (data.total > 1 || data.items.some((item) => item?.email !== exactEmail))) ||
      data.items.some((item) => !item || typeof item.firebase_uid !== 'string' || !item.firebase_uid.trim() ||
        typeof item.email !== 'string' || !item.email.trim() || typeof item.account_status !== 'string' || !item.account_status ||
        !Number.isSafeInteger(item.session_count) || item.session_count < 0 ||
        !Number.isSafeInteger(item.device_count) || item.device_count < 0 ||
        !['none', 'active', 'history_only', 'integrity_conflict'].includes(item.subscription_presence || '')) ||
      new Set(data.items.map((item) => item.firebase_uid)).size !== data.items.length) throw new Error('admin_users_unavailable')
  return data
}

export type AdminDeviceChangeFilter = AdminDeviceChangeRequest['status'] | 'all'
export type AdminDeviceChangePage = { success: boolean; items: AdminDeviceChangeRequest[]; page: number; limit: number; has_more: boolean }

export async function fetchAdminDeviceChangeRequests(params: { status?: AdminDeviceChangeFilter; page?: number; limit?: number } = {}, signal?: AbortSignal) {
  const query = new URLSearchParams({
    status: params.status || 'pending',
    page: String(params.page || 1),
    limit: String(params.limit || 25),
  })
  const data = await adminFetch<AdminDeviceChangePage>(`/device-change-requests?${query}`, { signal })
  if (data?.success !== true || !Array.isArray(data.items) || data.page !== (params.page ?? 1) || data.limit !== (params.limit ?? 25)
    || typeof data.has_more !== 'boolean' || data.items.length > data.limit || (data.has_more && data.items.length !== data.limit)
    || data.items.some((item) => typeof item?.id !== 'string' || !item.id)
    || new Set(data.items.map((item) => item.id)).size !== data.items.length) throw new Error('device_change_requests_unavailable')
  return data
}

export async function fetchAdminDeviceChangeRequest(requestId: string, signal?: AbortSignal) {
  const data = await adminFetch<{ success: boolean; item: AdminDeviceChangeRequest }>(`/device-change-requests/${encodeURIComponent(requestId)}`, { signal })
  if (data?.success !== true || typeof data.item?.id !== 'string' || data.item.id.toLowerCase() !== requestId.toLowerCase() ||
    !['pending', 'approved', 'rejected', 'cancelled'].includes(data.item.status) ||
    typeof data.item.firebase_uid !== 'string' || !data.item.firebase_uid.trim() ||
    typeof data.item.requested_device_key !== 'string' || !data.item.requested_device_key.trim() ||
    !parseServiceTimestamp(data.item.updated_at) ||
    !(data.item.current_binding_id === null || typeof data.item.current_binding_id === 'string')) throw new Error('device_change_requests_unavailable')
  return data.item
}

export async function previewAdminDeviceChange(requestId: string, payload: { action: 'approve' | 'reject'; reason: string }) {
  return adminFetch<{ success: boolean; preview: AdminDeviceChangePreview }>(`/device-change-requests/${encodeURIComponent(requestId)}/preview`, { method: 'POST', body: JSON.stringify(payload) })
}

export async function executeAdminDeviceChange(requestId: string, payload: { action: 'approve' | 'reject'; reason: string; preview_hash: string; request_id: string }) {
  return adminFetch<{ success: boolean; result: { item: AdminDeviceChangeRequest; idempotent: boolean } }>(`/device-change-requests/${encodeURIComponent(requestId)}/execute`, { method: 'POST', body: JSON.stringify(payload) })
}

export async function previewAdminDeviceReset(firebaseUid: string, reason: string) {
  return adminFetch<{ success: boolean; preview: AdminDeviceResetPreview }>(`/users/${encodeURIComponent(firebaseUid)}/device/reset/preview`, { method: 'POST', body: JSON.stringify({ reason }) })
}

export async function executeAdminDeviceReset(firebaseUid: string, payload: { reason: string; preview_hash: string; request_id: string }) {
  return adminFetch<{ success: boolean; result: { reset: boolean; idempotent: boolean } }>(`/users/${encodeURIComponent(firebaseUid)}/device/reset/execute`, { method: 'POST', body: JSON.stringify(payload) })
}

export async function previewAccountLifecycle(firebaseUid: string, payload: AdminOperationReason & { action: 'suspend' | 'reactivate' | 'mark_pending_deletion' }) {
  return adminFetch<{ success: boolean; preview: AdminOperationPreview }>(`/users/${encodeURIComponent(firebaseUid)}/lifecycle/preview`, { method: 'POST', body: JSON.stringify(payload) })
}

export async function executeAccountLifecycle(firebaseUid: string, payload: AdminOperationReason & { action: 'suspend' | 'reactivate' | 'mark_pending_deletion'; preview_hash: string; request_id: string }) {
  return adminFetch<{ success: boolean; result: Record<string, unknown> }>(`/users/${encodeURIComponent(firebaseUid)}/lifecycle/execute`, { method: 'POST', body: JSON.stringify(payload) })
}

export async function previewAccessRevocation(firebaseUid: string, payload: AdminOperationReason & { scope: 'session' | 'device' | 'all'; target_id?: string }) {
  return adminFetch<{ success: boolean; preview: AdminOperationPreview }>(`/users/${encodeURIComponent(firebaseUid)}/access/preview`, { method: 'POST', body: JSON.stringify(payload) })
}

export async function executeAccessRevocation(firebaseUid: string, payload: AdminOperationReason & { scope: 'session' | 'device' | 'all'; target_id?: string; preview_hash: string; request_id: string }) {
  return adminFetch<{ success: boolean; result: Record<string, unknown> }>(`/users/${encodeURIComponent(firebaseUid)}/access/execute`, { method: 'POST', body: JSON.stringify(payload) })
}

export async function previewSubscriptionTransition(subscriptionId: string, payload: AdminOperationReason & { action: 'suspend' | 'resume' | 'cancel_at_period_end' | 'cancel_now' | 'end_trial' | 'correct_expiry' | 'revoke_entitlement'; new_expiry?: string }) {
  return adminFetch<{ success: boolean; preview: AdminOperationPreview }>(`/subscriptions/${encodeURIComponent(subscriptionId)}/transition/preview`, { method: 'POST', body: JSON.stringify(payload) })
}

export async function executeSubscriptionTransition(subscriptionId: string, payload: AdminOperationReason & { action: 'suspend' | 'resume' | 'cancel_at_period_end' | 'cancel_now' | 'end_trial' | 'correct_expiry' | 'revoke_entitlement'; new_expiry?: string; preview_hash: string; request_id: string }) {
  return adminFetch<{ success: boolean; result: Record<string, unknown> }>(`/subscriptions/${encodeURIComponent(subscriptionId)}/transition/execute`, { method: 'POST', body: JSON.stringify(payload) })
}

export async function fetchRecoveryEvidence(firebaseUid: string) {
  return adminFetch<{ success: boolean; items: AdminUserDetail['recovery_evidence'] }>(`/subscriptions/recovery-evidence?firebase_uid=${encodeURIComponent(firebaseUid)}`)
}

export async function updateCrashGroupState(fingerprint: string, payload: { status: AdminCrashGroup['status']; assignee?: string; note?: string }) {
  return adminFetch<{ success: boolean; item: AdminCrashGroup }>(`/crash-groups/${encodeURIComponent(fingerprint)}/state`, { method: 'POST', body: JSON.stringify(payload) })
}

export async function fetchTamperAlerts(params: AdminTamperAlertFilters = {}, signal?: AbortSignal) {
  const query = new URLSearchParams()
  query.set('page', String(params.page || 1)); query.set('limit', String(params.limit || 50))
  if (typeof params.resolved === 'boolean') query.set('resolved', String(params.resolved))
  if (params.severity) query.set('severity', params.severity)
  if (params.user) query.set('user', params.user)
  const data = await adminFetch<AdminTamperAlertPage>(`/tamper-alerts?${query}`, { signal })
  if (!data?.success || !Array.isArray(data.items) || typeof data.has_more !== 'boolean') throw new Error('diagnostics_unavailable')
  return data
}

export async function resolveTamperAlert(alertId: string, reason: string) {
  return adminFetch<{ success: boolean; item: AdminTamperAlert }>(`/tamper-alerts/${encodeURIComponent(alertId)}/resolve`, { method: 'POST', body: JSON.stringify({ reason }) })
}

export async function fetchAdminReadiness(signal?: AbortSignal) {
  const data = await adminFetch<AdminReadiness>('/readiness', { signal })
  if (data?.success !== true || !Number.isFinite(Date.parse(data.generated_at)) || !Array.isArray(data.checks) || !data.checks.length || data.checks.length > 40 || new Set(data.checks.map((check) => check?.id)).size !== data.checks.length || !data.checks.every((check) =>
    typeof check?.id === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(check.id) &&
    ['database', 'configuration', 'security'].includes(check.group) && ['read', 'configuration'].includes(check.kind) &&
    ['passed', 'configured', 'missing', 'unavailable', 'disabled', 'review'].includes(check.status) &&
    ['read_succeeded', 'schema_missing', 'read_unavailable', 'not_configured', 'configuration_present', 'flag_enabled', 'flag_disabled', 'role_configuration_missing', 'integration_not_active', 'configuration_present_disabled'].includes(check.reason) &&
    (check.status !== 'passed' || (check.kind === 'read' && check.group === 'database' && check.reason === 'read_succeeded')) &&
    (check.reason !== 'read_succeeded' || check.status === 'passed'))) throw new Error('readiness_unavailable')
  return data
}

function validInvite(value: unknown): value is AdminInviteCode {
  if (!value || typeof value !== 'object') return false
  const row = value as AdminInviteCode
  const scope = row.scope; const restrictions = row.restrictions
  if ((scope !== undefined && (!scope || typeof scope !== 'object' || Array.isArray(scope))) || (restrictions !== undefined && (!restrictions || typeof restrictions !== 'object' || Array.isArray(restrictions)))) return false
  const lists = [scope?.channels, scope?.app_versions, restrictions?.user_ids, restrictions?.emails, restrictions?.device_ids, restrictions?.install_ids]
  if (lists.some((list) => list !== undefined && (!Array.isArray(list) || !list.every((entry) => typeof entry === 'string')))) return false
  if ([restrictions?.one_per_user, restrictions?.one_per_device].some((flag) => flag !== undefined && typeof flag !== 'boolean')) return false
  return typeof row.id === 'string' && Boolean(row.id) && typeof row.status === 'string' &&
    ['active', 'expired', 'exhausted', 'revoked', 'blocked'].includes(row.effective_status || '') &&
    Number.isSafeInteger(row.used_count) && row.used_count >= 0 &&
    (row.max_uses === null || Number.isSafeInteger(row.max_uses)) &&
    Number.isFinite(Date.parse(row.created_at || '')) && Number.isFinite(Date.parse(row.updated_at || '')) &&
    (!row.expires_at || Number.isFinite(Date.parse(row.expires_at))) && !('code_hash' in row) && !('creation_request_id' in row)
}

export async function fetchAdminInviteDirectory(input: AdminInviteDirectoryQuery = {}, signal?: AbortSignal) {
  const query = new URLSearchParams({ view: 'management', query: input.query || '', status: input.status || '', page: String(input.page || 1) })
  const result = await adminFetch<AdminInviteDirectoryPage>(`/policy/invites?${query}`, { signal })
  if (result.success !== true || !Array.isArray(result.items) || !result.items.every(validInvite) || new Set(result.items.map((row) => row.id)).size !== result.items.length ||
      result.page !== (input.page || 1) || result.query !== (input.query || '').trim() || result.status !== (input.status || '') || typeof result.has_more !== 'boolean' || !Number.isFinite(Date.parse(result.generated_at))) throw new Error('invalid_invite_directory')
  return result
}

export async function fetchAdminInviteDetail(inviteId: string, page = 1, signal?: AbortSignal) {
  const result = await adminFetch<AdminInviteDetail>(`/policy/invites/usage?${new URLSearchParams({ view: 'management', invite_id: inviteId, page: String(page) })}`, { signal })
  if (result.success !== true || !validInvite(result.item) || result.item.id !== inviteId || result.page !== page || typeof result.has_more !== 'boolean' || !Array.isArray(result.items) ||
      !result.items.every((row) => row && typeof row.id === 'string' && ['valid', 'invalid', 'expired', 'already_used', 'blocked', 'policy_unavailable'].includes(row.result) && Number.isFinite(Date.parse(row.created_at)))) throw new Error('invalid_invite_detail')
  return result
}

export async function createAdminInvite(payload: { request_id: string; expires_at?: string; max_uses?: number; note?: string; scope?: AdminInviteCode['scope']; restrictions?: AdminInviteCode['restrictions'] }) {
  const result = await adminFetch<{ success: boolean; item: AdminInviteCode; code: string | null; shown_once?: boolean; replay?: boolean }>('/policy/invites/create', { method: 'POST', headers: { 'Idempotency-Key': payload.request_id }, body: JSON.stringify(payload) })
  if (result.success !== true || !validInvite(result.item) || (result.replay ? result.code !== null || result.shown_once !== false : typeof result.code !== 'string' || !/^[A-Z2-9]{20}$/.test(result.code) || result.shown_once !== true)) throw new Error('invite_write_unconfirmed')
  return result
}

export async function revokeAdminInvite(inviteId: string, reason: string) {
  const result = await adminFetch<{ success: boolean; invite_id: string; status: string }>('/policy/invites/revoke', { method: 'POST', body: JSON.stringify({ invite_id: inviteId, reason }) })
  if (result.success !== true || result.invite_id !== inviteId || result.status !== 'revoked') throw new Error('invite_write_unconfirmed')
  return result
}

export type AdminGlobalPolicy = { kill_switch_enabled: 0 | 1; mandatory_update_enabled: 0 | 1; minimum_supported_version: string | null; update_mode: 'optional' | 'mandatory' | 'required' | 'force'; updated_at: string; revision: string }
export type AdminGlobalPolicyChange = { kill_switch_enabled: boolean; mandatory_update_enabled: boolean; minimum_supported_version: string; update_mode: AdminGlobalPolicy['update_mode']; reason: string; expected_revision: string; request_id: string }
export async function fetchAdminGlobalPolicy(signal?: AbortSignal) {
  const result = await adminFetch<{ success: boolean; policy: AdminGlobalPolicy }>('/policy/global-policy', { signal })
  const policy = result.policy
  if (result.success !== true || !policy || Object.keys(policy).sort().join(',') !== 'kill_switch_enabled,mandatory_update_enabled,minimum_supported_version,revision,update_mode,updated_at' || ![0, 1].includes(policy.kill_switch_enabled) || ![0, 1].includes(policy.mandatory_update_enabled) || !['optional', 'mandatory', 'required', 'force'].includes(policy.update_mode) || (policy.minimum_supported_version !== null && typeof policy.minimum_supported_version !== 'string') || typeof policy.revision !== 'string' || !/^[a-f0-9]{64}$/.test(policy.revision) || typeof policy.updated_at !== 'string' || !Number.isFinite(Date.parse(policy.updated_at))) throw new Error('policy_state_unavailable')
  return policy
}
export async function updateAdminGlobalPolicy(payload: AdminGlobalPolicyChange) {
  const result = await adminFetch<{ success: boolean; request_id: string; revision: string; replay: boolean }>('/policy/global-policy', { method: 'POST', headers: { 'Idempotency-Key': payload.request_id }, body: JSON.stringify(payload) })
  if (result.success !== true || result.request_id !== payload.request_id || typeof result.revision !== 'string' || !/^[a-f0-9]{64}$/.test(result.revision) || typeof result.replay !== 'boolean') throw new Error('policy_write_unconfirmed')
  return result
}

export type AdminDisabledVersion = { version: string; reason: string | null; created_at: string }
export type AdminPolicyPlanSummary = { plan_id: string; updated_at: string; valid: boolean; features_count: number | null; limits_count: number | null; blocked_actions_count: number | null }
export type AdminPolicyDirectoryQuery = { view: 'versions' | 'plans'; query?: string; page?: number }
type AdminPolicyPage = { success: boolean; query: string; page: number; limit: number; has_more: boolean }
export type AdminPolicyDirectory = AdminPolicyPage & ({ view: 'versions'; items: AdminDisabledVersion[] } | { view: 'plans'; items: AdminPolicyPlanSummary[] })
export type AdminPolicyVersionState = { success: boolean; version: string; disabled: boolean; item: AdminDisabledVersion | null; revision: string }
export type AdminPolicyVersionChange = { version: string; disabled: boolean; reason: string; expected_revision: string; request_id: string }
export type PolicyJson = null | boolean | number | string | PolicyJson[] | { [key: string]: PolicyJson }
export type AdminPolicyRules = { valid: true; features: Record<string, PolicyJson>; limits: Record<string, PolicyJson>; blocked_actions: string[] } | { valid: false; features: null; limits: null; blocked_actions: null }
export type AdminPolicyPlanDetail = { success: boolean; plan_id: string; updated_at: string; rules: AdminPolicyRules; global_rules: AdminPolicyRules | null }
function validDisabledVersion(value: AdminDisabledVersion) { return Boolean(value && typeof value.version === 'string' && value.version.length > 0 && value.version.length <= 80 && (value.reason === null || typeof value.reason === 'string') && typeof value.created_at === 'string' && Number.isFinite(Date.parse(value.created_at))) }
function validPolicyRules(value: AdminPolicyRules) {
  if (!value || Object.keys(value).sort().join(',') !== 'blocked_actions,features,limits,valid') return false
  if (value.valid === false) return value.features === null && value.limits === null && value.blocked_actions === null
  if (value.valid !== true || !value.features || typeof value.features !== 'object' || Array.isArray(value.features) || !value.limits || typeof value.limits !== 'object' || Array.isArray(value.limits) || !Array.isArray(value.blocked_actions) || value.blocked_actions.some((item) => typeof item !== 'string')) return false
  let nodes = 0
  const valid = (item: PolicyJson, depth = 0): boolean => ++nodes <= 1000 && depth <= 10 && (item === null || typeof item === 'string' || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item) || typeof item === 'object' && (Array.isArray(item) ? item : Object.values(item)).every((child) => valid(child, depth + 1)))
  return valid(value.features) && valid(value.limits) && valid(value.blocked_actions)
}
export async function fetchAdminPolicyDirectory(input: AdminPolicyDirectoryQuery, signal?: AbortSignal) {
  const query = input.query?.trim() || ''; const page = input.page || 1
  const params = new URLSearchParams({ query, page: String(page) })
  const result = await adminFetch<AdminPolicyDirectory>(`/policy/${input.view === 'versions' ? 'disabled-versions' : 'plan-features'}?${params}`, { signal })
  if (result.success !== true || result.view !== input.view || result.query !== query || result.page !== page || result.limit !== 25 || typeof result.has_more !== 'boolean' || !Array.isArray(result.items) || result.items.length > 25 || result.has_more && result.items.length !== 25) throw new Error('policy_records_unavailable')
  const valid = result.view === 'versions' ? result.items.every(validDisabledVersion) : result.items.every((row) => row && typeof row.plan_id === 'string' && row.plan_id.length > 0 && typeof row.updated_at === 'string' && Number.isFinite(Date.parse(row.updated_at)) && typeof row.valid === 'boolean' && [row.features_count, row.limits_count, row.blocked_actions_count].every((count) => row.valid ? Number.isSafeInteger(count) && count !== null && count >= 0 : count === null))
  if (!valid) throw new Error('policy_records_unavailable')
  const ids = result.items.map((row) => 'version' in row ? row.version : row.plan_id)
  if (new Set(ids).size !== ids.length) throw new Error('policy_records_unavailable')
  return result
}
export async function fetchAdminPolicyVersion(version: string, signal?: AbortSignal) {
  const normalized = version.trim().toLowerCase()
  const result = await adminFetch<AdminPolicyVersionState>('/policy/disabled-versions?version=' + encodeURIComponent(normalized), { signal })
  if (result.success !== true || result.version !== normalized || typeof result.disabled !== 'boolean' || !/^[a-f0-9]{64}$/.test(result.revision) || (result.disabled ? !validDisabledVersion(result.item!) || result.item!.version.toLowerCase() !== normalized : result.item !== null)) throw new Error('policy_records_unavailable')
  return result
}
export async function fetchAdminPolicyPlan(id: string, signal?: AbortSignal) {
  const result = await adminFetch<AdminPolicyPlanDetail>('/policy/plan-features?plan=' + encodeURIComponent(id), { signal })
  if (result.success !== true || result.plan_id !== id || typeof result.updated_at !== 'string' || !Number.isFinite(Date.parse(result.updated_at)) || !validPolicyRules(result.rules) || result.global_rules !== null && !validPolicyRules(result.global_rules)) throw new Error('policy_records_unavailable')
  return result
}
export async function updateAdminDisabledVersion(payload: AdminPolicyVersionChange) {
  const result = await adminFetch<{ success: boolean; request_id: string; version: string; disabled: boolean; revision: string; replay: boolean }>('/policy/disabled-versions', { method: 'POST', headers: { 'Idempotency-Key': payload.request_id }, body: JSON.stringify(payload) })
  if (result.success !== true || result.request_id !== payload.request_id || result.version !== payload.version.trim().toLowerCase() || result.disabled !== payload.disabled || !/^[a-f0-9]{64}$/.test(result.revision) || typeof result.replay !== 'boolean') throw new Error('policy_write_unconfirmed')
  return result
}

export type AdminReleaseManifest = {
  version: string
  channel?: string
  available: boolean
  disabled?: boolean
  disabled_reason?: string
  published_at?: string | null
  mandatory: boolean
  download_url: string
  download_sha256?: string
  filename: string
  notes: string
  artifacts?: {
    installed?: { url?: string; sha256?: string; filename?: string; size_bytes?: number; package_type?: string }
    portable?: { url?: string; sha256?: string; filename?: string; size_bytes?: number; package_type?: string }
  }
  channels?: Record<string, Partial<AdminReleaseManifest>>
  manifest_signature?: string
  history_reset_at?: string
}

export async function uploadReleaseBinary(payload: {
  file: File
  version: string
  channel: string
  artifact_type?: 'portable' | 'installed'
}) {
  const form = new FormData()
  form.set('file', payload.file)
  form.set('version', payload.version)
  form.set('channel', payload.channel)
  if (payload.artifact_type) form.set('artifact_type', payload.artifact_type)
  return adminFetch<{ success: boolean; release: AdminReleaseUpload; artifact_type: 'portable' | 'installed'; staged_artifact?: AdminStagedReleaseArtifact }>('/upload', {
    method: 'POST',
    body: form,
  })
}

export async function previewManualSubscriptionGrant(payload: ManualGrantPreviewInput) {
  return adminFetch<{ success: boolean; preview: ManualGrantPreview }>('/subscriptions/manual-grant/preview', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function executeManualSubscriptionGrant(payload: ManualGrantExecuteInput) {
  return adminFetch<ManualGrantResult>('/subscriptions/manual-grant/execute', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function fetchPendingSubscriptionGrants(status: PendingSubscriptionGrant['status'] | 'all' = 'pending') {
  return adminFetch<{ success: boolean; items: PendingSubscriptionGrant[] }>(`/subscriptions/pending-grants?status=${encodeURIComponent(status)}`)
}

export async function fetchPendingSubscriptionGrantPage(status: PendingSubscriptionGrant['status'] | 'all', page: number, signal?: AbortSignal) {
  const data = await adminFetch<{ success: boolean; view: string; items: PendingSubscriptionGrant[]; total: number; page: number; limit: number }>(
    `/subscriptions/pending-grants?view=directory&status=${encodeURIComponent(status)}&page=${page}&limit=5`, { signal },
  )
  if (data?.success !== true || data.view !== 'directory' || data.page !== page || data.limit !== 5 ||
      !Number.isSafeInteger(data.total) || data.total < 0 || !Array.isArray(data.items) ||
      data.items.length !== Math.min(5, Math.max(0, data.total - (page - 1) * 5)) ||
      !data.items.every((item) => typeof item?.id === 'string' && item.id && typeof item.normalized_email === 'string' && (status === 'all' || item.status === status)) ||
      new Set(data.items.map(({ id }) => id)).size !== data.items.length) throw new Error('pending_grants_unavailable')
  return data
}

export async function cancelPendingSubscriptionGrant(payload: { grant_id: string; reason: string }) {
  return adminFetch<{ success: boolean; item: PendingSubscriptionGrant }>('/subscriptions/pending-grants/cancel', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function publishRelease(payload: {
  version: string
  channel: string
  notes: string
  mandatory: boolean
  update_mode: 'optional' | 'force' | 'required' | 'silent'
  rollout_percent?: number
  minimum_supported_version?: string
  force_update_deadline?: string
  target_scope?: 'all' | 'selected'
  target_user_ids?: string[]
  target_user_emails?: string[]
  target_install_ids?: string[]
  target_device_ids?: string[]
  target_hwids?: string[]
  reviewed_artifacts?: AdminReviewedReleaseArtifacts
}) {
  return adminFetch<{ success: boolean; targeted?: boolean; target_count?: number; manifest: AdminReleaseManifest }>(payload.reviewed_artifacts ? '/releases/publish-reviewed' : '/publish', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function rollbackRelease(payload: { version: string; channel: string }) {
  return adminFetch<{ success: boolean; manifest: AdminReleaseManifest }>('/rollback', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function disableRelease(payload: { channel: string; reason?: string }) {
  return adminFetch<{ success: boolean; manifest: AdminReleaseManifest }>('/releases/disable', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function resetOtaBaseline(payload: { channel: string; version?: string }) {
  return adminFetch<{ success: boolean; manifest: AdminReleaseManifest }>('/reset-baseline', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function fetchRemoteControls(channel = 'beta') {
  return adminFetch<{ success: boolean; channel: string; controls: AdminRemoteControls; channel_manifest: AdminReleaseManifest; manifest: AdminReleaseManifest }>(
    `/remote-config?channel=${encodeURIComponent(channel)}`,
  )
}

export async function fetchCurrentAdminRelease(channel = 'beta', signal?: AbortSignal) {
  return adminFetch<{ success: boolean; channel: string; item: AdminReleaseManifest }>(
    `/releases/current?channel=${encodeURIComponent(channel)}`, { signal },
  )
}

export async function fetchStagedAdminRelease(channel: 'stable' | 'beta', version: string, signal?: AbortSignal) {
  const query = new URLSearchParams({ channel, version })
  return adminFetch<{ success: boolean; channel: string; version: string; artifacts: AdminStagedReleaseArtifacts }>(
    `/releases/staged?${query}`, { signal, cache: 'no-store' },
  )
}

export async function updateRemoteControls(payload: AdminRemoteControls & { channel: string }) {
  return adminFetch<{ success: boolean; controls: AdminRemoteControls; manifest: AdminReleaseManifest }>('/remote-config', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

function diagnosticQuery(params: AdminDiagnosticFilters) {
  const query = new URLSearchParams()
  query.set('limit', String(params.limit ?? 50))
  for (const key of ['user', 'search', 'cursor', 'classification', 'attribution', 'component'] as const) {
    if (params[key]) query.set(key, params[key])
  }
  return query
}

export async function fetchCrashLogs(params: AdminDiagnosticFilters = {}, signal?: AbortSignal) {
  return adminFetch<AdminDiagnosticPage>(`/crash-logs?${diagnosticQuery(params)}`, { signal })
}

export async function fetchCrashLog(id: string, signal?: AbortSignal) {
  return adminFetch<{ success: boolean; item: AdminCrashLog }>(`/crash-logs/${encodeURIComponent(id)}`, { signal })
}

export async function fetchCrashGroups(params: AdminDiagnosticFilters = {}) {
  return adminFetch<AdminDiagnosticPage<AdminCrashGroup>>(`/crash-groups?${diagnosticQuery(params)}`)
}

export async function fetchDiagnosticTriage(params: AdminDiagnosticFilters & { asOf?: string; summary?: boolean } = {}, signal?: AbortSignal) {
  const query = diagnosticQuery(params)
  query.delete('limit')
  if (params.asOf) query.set('as_of', params.asOf)
  if (params.summary) query.set('summary', 'true')
  const data = await adminFetch<AdminDiagnosticTriage & { success: boolean }>(`/diagnostic-triage?${query}`, { signal })
  if (data?.success !== true || !Array.isArray(data.items) || !data.counts || !data.window ||
    ![data.counts.recent, data.counts.attention, data.window.scanned_reports].every((value) => Number.isSafeInteger(value) && value >= 0) ||
    data.counts.attention > data.counts.recent || data.counts.recent > data.window.scanned_reports ||
    !parseServiceTimestamp(data.window.as_of)) throw new Error('diagnostics_unavailable')
  return data
}

export async function fetchDiagnosticCoverage(period: AdminDiagnosticCoveragePeriod, signal?: AbortSignal) {
  const query = new URLSearchParams({ from: period.from, to: period.to })
  const data = await adminFetch<AdminDiagnosticCoverage & { success: boolean }>(`/diagnostic-coverage?${query}`, { signal })
  if (!data?.success || !Array.isArray(data.versions) || !data.totals || !data.window?.from || !data.window.to || typeof data.window.retention_limited !== 'boolean') throw new Error('diagnostics_unavailable')
  return data
}

export async function fetchAuditLog(filters: AdminAuditFilters = {}, signal?: AbortSignal) {
  const query = new URLSearchParams({ limit: String(filters.limit ?? 100) })
  if (filters.search) query.set('search', filters.search)
  if (filters.cursor) query.set('cursor', filters.cursor)
  const data = await adminFetch<AdminAuditPage>(`/audit-log?${query}`, { signal })
  if (!data?.success || !Array.isArray(data.items) || typeof data.has_more !== 'boolean'
    || (data.has_more ? typeof data.next_cursor !== 'string' || !data.next_cursor : data.next_cursor !== null)) throw new Error('audit_unavailable')
  return data
}

function validCommerceOrder(row: AdminCommerceOrder) {
  return row && typeof row.id === 'string' && typeof row.firebase_uid === 'string' && typeof row.plan_id === 'string' && Number.isSafeInteger(row.plan_version) &&
    ['creating', 'provider_unavailable', 'awaiting_payment', 'confirming', 'paid', 'underpaid', 'overpaid', 'expired', 'failed', 'cancelled', 'refunded', 'manual_review'].includes(row.status) &&
    Number.isSafeInteger(row.amount_minor) && row.amount_minor >= 0 && /^[A-Z]{3}$/.test(row.currency) && Number.isFinite(Date.parse(row.created_at)) &&
    !('metadata' in row) && !('hosted_url' in row) && !('idempotency_key_hash' in row)
}
export async function fetchAdminCommercePage(input: AdminCommerceQuery, signal?: AbortSignal) {
  const query = new URLSearchParams({ query: (input.query || '').trim(), status: input.status || '', page: String(input.page || 1) })
  const result = await adminFetch<AdminCommercePage>(`/commerce/${input.view}?${query}`, { signal })
  if (result?.success !== true || result.view !== input.view || result.page !== (input.page || 1) || result.query !== (input.query || '').trim() || result.status !== (input.status || (input.view === 'integrity' ? 'open' : '')) ||
      !Number.isSafeInteger(result.total) || result.total < 0 || result.limit !== 25 || typeof result.has_more !== 'boolean' || result.has_more !== (result.page * result.limit < result.total) || !Number.isFinite(Date.parse(result.generated_at)) || !Array.isArray(result.items) || result.items.length !== Math.min(result.limit, Math.max(0, result.total - (result.page - 1) * result.limit))) throw new Error('commerce_unavailable')
  const valid = result.view === 'orders' ? result.items.every(validCommerceOrder) : result.view === 'plans' ? result.items.every((row) => row && typeof row.plan_id === 'string' && Number.isSafeInteger(row.version) && Number.isSafeInteger(row.price_minor) && row.price_minor >= 0 && /^[A-Z]{3}$/.test(row.currency) && ['active', 'public_visible', 'purchasable', 'checkout_available'].every((key) => typeof row[key as keyof AdminCommercePlan] === 'boolean')) : result.items.every((row) => row && typeof row.id === 'string' && typeof row.code === 'string' && ['info', 'warning', 'critical'].includes(row.severity) && Number.isFinite(Date.parse(row.created_at)) && !('details' in row))
  if (!valid) throw new Error('commerce_unavailable')
  const keys = result.view === 'plans' ? result.items.map((row) => `${row.plan_id}:${row.version}`) : result.items.map((row) => row.id)
  if (new Set(keys).size !== keys.length) throw new Error('commerce_unavailable')
  return result
}
export async function fetchAdminCommerceConfiguration(signal?: AbortSignal) {
  const result = await adminFetch<AdminCommerceConfiguration>('/commerce/configuration', { signal })
  if (result?.success !== true || result.checkout_available !== false || !result.providers || !['stripe', 'nowpayments'].every((key) => { const state = result.providers[key as 'stripe' | 'nowpayments']; return state && typeof state.configured === 'boolean' && state.implemented === false && state.available === false }) || !Number.isFinite(Date.parse(result.generated_at))) throw new Error('commerce_unavailable')
  return result
}
export async function fetchAdminCommerceOrder(id: string, view: AdminOrderRecordsView = 'attempts', page = 1, signal?: AbortSignal) {
  const result = await adminFetch<AdminOrderDetail>(`/commerce/orders/${encodeURIComponent(id)}?${new URLSearchParams({ view, page: String(page) })}`, { signal })
  if (result?.success !== true || !validCommerceOrder(result.order) || result.order.id !== id || result.view !== view || result.page !== page || typeof result.has_more !== 'boolean' || typeof result.unavailable !== 'boolean' || !Number.isFinite(Date.parse(result.generated_at)) ||
      (result.unavailable ? result.items !== null || result.total !== null || result.has_more : !Number.isSafeInteger(result.total) || result.total! < 0 || result.has_more !== (page * 25 < result.total!) || !Array.isArray(result.items) || result.items.length !== Math.min(25, Math.max(0, result.total! - (page - 1) * 25)) || !result.items.every((row) => row && row.order_id === id && typeof row.id === 'string' && !('metadata' in row) && !('document_url' in row)))) throw new Error('commerce_unavailable')
  return result
}

export async function fetchSupportThreads() {
  return adminFetch<{ success: boolean; threads: AdminSupportThread[] }>('/policy/support')
}

export type AdminSupportInboxQuery = {
  scope?: 'all' | 'waiting'
  status?: string
  priority?: string
  query?: string
  threadId?: string
  page?: number
  limit?: number
}

export type AdminSupportInboxPage = { threads: AdminSupportThread[]; page: number; limit: number; has_more: boolean }

export async function fetchSupportInbox(input: AdminSupportInboxQuery, signal?: AbortSignal): Promise<AdminSupportInboxPage> {
  const query = new URLSearchParams({ view: 'inbox' })
  const filters = { scope: input.scope, status: input.status, priority: input.priority, query: input.query, thread_id: input.threadId, page: input.page, limit: input.limit }
  for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== '') query.set(key, String(value))
  const response = await adminFetch<AdminSupportInboxPage & { success: boolean }>(`/policy/support?${query}`, { signal })
  if (response?.success !== true || !Array.isArray(response.threads) || response.page !== (input.page ?? 1) ||
      response.limit !== (input.limit ?? 25) || typeof response.has_more !== 'boolean' ||
      response.threads.length > response.limit || (response.has_more && response.threads.length !== response.limit) ||
      !response.threads.every((row) => row && typeof row.id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(row.id)) ||
      new Set(response.threads.map((row) => row.id)).size !== response.threads.length) throw new Error('support_inbox_unavailable')
  return response
}

export async function fetchSupportMessages(threadId: string, signal?: AbortSignal) {
  return adminFetch<{ success: boolean; thread?: AdminSupportThread; messages: AdminSupportMessage[]; audit?: AdminSupportAuditEvent[]; audit_unavailable?: boolean }>(
    `/policy/support/messages?thread_id=${encodeURIComponent(threadId)}`,
    { signal },
  )
}

export async function fetchAdminSupportConversation(threadId: string, signal?: AbortSignal) {
  const data = await adminFetch<{ success: boolean; thread?: AdminSupportThread; messages: AdminSupportMessage[]; unread_message_ids: string[] }>(
    `/policy/support/conversation?thread_id=${encodeURIComponent(threadId)}`, { signal },
  )
  if (data?.success !== true || data.thread?.id !== threadId || !Array.isArray(data.messages) ||
      !data.messages.every((message) => message?.thread_id === threadId && typeof message.id === 'string') ||
      !Array.isArray(data.unread_message_ids)) throw new Error('support_inbox_unavailable')
  const ids = new Set(data.messages.map(({ id }) => id))
  if (!data.unread_message_ids.every((id) => ids.has(id))) throw new Error('support_inbox_unavailable')
  return { thread: data.thread, messages: data.messages, unreadMessageIds: [...new Set(data.unread_message_ids)] }
}

export async function fetchAdminSupportHistory(threadId: string, cursor: string | null, signal?: AbortSignal) {
  const params = new URLSearchParams({ thread_id: threadId })
  if (cursor !== null) params.set('cursor', cursor)
  const data = await adminFetch<{ success: boolean; thread_id: string; events: AdminSupportAuditEvent[]; next_cursor: string | null }>(
    `/policy/support/history?${params}`, { signal },
  )
  if (data?.success !== true || data.thread_id !== threadId || !Array.isArray(data.events) || data.events.length > 25 ||
      !data.events.every((item) => typeof item?.id === 'string' && typeof item.event_type === 'string') ||
      new Set(data.events.map(({ id }) => id)).size !== data.events.length ||
      (data.next_cursor !== null && (data.events.length !== 25 || data.next_cursor !== data.events.at(-1)?.id || data.events.some(({ id }) => id === cursor)))) {
    throw new Error('support_history_unavailable')
  }
  return { events: data.events, nextCursor: data.next_cursor }
}

export async function markAdminSupportMessagesRead(threadId: string, ids: string[], signal?: AbortSignal) {
  for (let index = 0; index < ids.length; index += 100) {
    if (signal?.aborted) return
    const data = await adminFetch<{ success: boolean }>('/policy/support/read', {
      method: 'POST', signal, body: JSON.stringify({ thread_id: threadId, message_ids: ids.slice(index, index + 100) }),
    })
    if (data?.success !== true) throw new Error('support_read_unavailable')
  }
}

export async function downloadAdminSupportAttachment(attachment: { id: string; filename: string }) {
  const headers = new Headers()
  const token = await getAdminToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(`${adminBaseUrl()}/policy/support/attachments/${encodeURIComponent(attachment.id)}`, { headers, credentials: 'same-origin' })
  if (!response.ok) throw new ApiError(`support_attachment_download_failed_${response.status}`, response.status)
  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = attachment.filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000)
}

export async function sendSupportReply(payload: { thread_id: string; body: string; internal_note?: boolean; email_requested?: boolean; idempotency_key?: string }) {
  const idempotencyKey = payload.idempotency_key || crypto.randomUUID()
  return adminFetch<{ success: boolean; email_queued?: boolean; duplicate?: boolean }>('/policy/support/reply', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ ...payload, idempotency_key: idempotencyKey }),
  })
}

export async function updateAdminSupportStatus(payload: { thread_id: string; status: string; reason?: string; idempotency_key?: string }) {
  const idempotencyKey = payload.idempotency_key || crypto.randomUUID()
  return adminFetch<{ success: boolean; status?: string }>('/policy/support/status', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ ...payload, idempotency_key: idempotencyKey }),
  })
}

export async function updateAdminSupportPriority(payload: { thread_id: string; priority: 'low' | 'normal' | 'high' | 'urgent' }) {
  return adminFetch<{ success: boolean; priority?: string }>('/policy/support/priority', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function setSupportBlocked(payload: { thread_id: string; blocked: boolean; reason?: string }) {
  return adminFetch<{ success: boolean; blocked?: boolean; status?: string }>('/policy/support/block', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function fetchEmailOperations() {
  return adminFetch<AdminEmailStatus>('/policy/email/status')
}

export async function fetchAdminEmailConfiguration(signal?: AbortSignal) {
  const data = await adminFetch<AdminEmailConfiguration>('/policy/email/status?view=configuration', { signal })
  const config = data?.config
  if (data?.success !== true || !config || typeof config.outbound_enabled !== 'boolean' || typeof config.inbound_enabled !== 'boolean' ||
      typeof config.scheduler_enabled !== 'boolean' || typeof config.has_resend_send_api_key !== 'boolean' || typeof config.has_resend_receive_api_key !== 'boolean' ||
      typeof config.has_resend_webhook_secret !== 'boolean' || !Array.isArray(data.catalog) || !data.catalog.every((item) => typeof item?.event_type === 'string' && typeof item.admin_test_allowed === 'boolean') ||
      !config.schema || typeof config.schema.ok !== 'boolean' || !Array.isArray(config.schema.missing) || !config.schema.missing.every((item) => typeof item === 'string') ||
      !Number.isFinite(Date.parse(data.generated_at || ''))) throw new Error('email_configuration_unavailable')
  return data
}

function validEmailActivityItem(view: AdminEmailActivityView, item: AdminEmailActivityItems[AdminEmailActivityView]): boolean {
  if (!item || typeof item !== 'object') return false
  if (view === 'flags') return typeof (item as AdminEmailRecipientFlag).email === 'string' && typeof (item as AdminEmailRecipientFlag).status === 'string'
  if (typeof (item as AdminEmailJob).id !== 'string' || !(item as AdminEmailJob).id) return false
  if (view === 'events') return typeof (item as AdminEmailProviderEvent).event_type === 'string'
  if (typeof (item as AdminEmailJob).status !== 'string') return false
  if (view === 'outbound') return typeof (item as AdminEmailJob).recipient === 'string' && typeof (item as AdminEmailJob).subject === 'string' && typeof (item as AdminEmailJob).email_type === 'string'
  if (view === 'scheduled') return typeof (item as AdminScheduledEmail).recipient === 'string' && typeof (item as AdminScheduledEmail).scheduled_for === 'string'
  return true
}

export async function fetchAdminEmailActivity(input: AdminEmailActivityQuery, signal?: AbortSignal): Promise<AdminEmailActivityPage> {
  const query = new URLSearchParams({ view: input.view, page: String(input.page || 1), limit: String(input.limit || 25) })
  if (input.query) query.set('query', input.query.trim())
  if (input.status) query.set('status', input.status.trim())
  if (input.jobId) query.set('job_id', input.jobId.trim())
  const data = await adminFetch<AdminEmailActivityPage>(`/policy/email/activity?${query}`, { signal })
  if (data?.success !== true || data.view !== input.view || data.page !== (input.page || 1) || data.limit !== (input.limit || 25) ||
      data.query !== (input.query || '').trim() || data.status !== (input.status || '').trim() || data.job_id !== (input.jobId?.trim() || null) ||
      typeof data.has_more !== 'boolean' || !Number.isFinite(Date.parse(data.generated_at)) || !Array.isArray(data.items) || data.items.length > data.limit ||
      !data.items.every((item) => validEmailActivityItem(data.view, item)) ||
      new Set(data.items.map((item) => 'email' in item ? item.email : item.id)).size !== data.items.length) throw new Error('email_activity_unavailable')
  return data
}

export async function fetchAdminEmailJob(jobId: string, signal?: AbortSignal) {
  const data = await adminFetch<AdminEmailJobDetail>(`/policy/email/jobs/${encodeURIComponent(jobId)}`, { signal })
  if (data?.success !== true || data.job?.id !== jobId || !validEmailActivityItem('outbound', data.job) || typeof data.job.retry_allowed !== 'boolean' ||
      (data.job.retry_allowed ? data.job.retry_blocked_reason !== null : typeof data.job.retry_blocked_reason !== 'string') ||
      !Array.isArray(data.events) || data.events.length > 100 || !data.events.every((event) => validEmailActivityItem('events', event) && event.email_job_id === jobId) ||
      new Set(data.events.map((event) => event.id)).size !== data.events.length || typeof data.events_has_more !== 'boolean' || typeof data.events_unavailable !== 'boolean' ||
      (data.events_unavailable && (data.events.length > 0 || data.events_has_more)) || !Number.isFinite(Date.parse(data.generated_at))) throw new Error('email_activity_unavailable')
  return data
}

export async function retryEmailJob(jobId: string) {
  return adminFetch<{ success: boolean; job_id?: string; processed?: AdminEmailProcessingResult }>('/policy/email/retry', {
    method: 'POST',
    body: JSON.stringify({ job_id: jobId }),
  })
}

export async function fetchEmailPreview(params: { email_type?: string; locale?: 'en' | 'ar' } = {}) {
  const query = new URLSearchParams()
  if (params.email_type) query.set('email_type', params.email_type)
  if (params.locale) query.set('locale', params.locale)
  return adminFetch<{
    success: boolean
    event: AdminEmailCatalogItem
    sender: { from: string; reply_to?: string }
    preview: { event_type: string; subject: string; html: string; text: string; locale: string; template_key: string; template_version: number }
  }>(`/policy/email/preview?${query}`)
}

export async function sendAdminTestEmail(payload: { recipient: string; subject?: string; message?: string; email_type?: string; locale?: 'en' | 'ar' }) {
  return adminFetch<{ success: boolean; job_id?: string; processed?: AdminEmailProcessingResult }>(
    '/policy/email/test',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  )
}

export async function processEmailOutbox() {
  return adminFetch<{ success: boolean; processed: AdminEmailQueueResult }>('/policy/email/process', {
    method: 'POST',
  })
}

export async function fetchUserDetail(userKey: string, signal?: AbortSignal) {
  return adminFetch<AdminUserDetail>(`/users/${encodeURIComponent(userKey)}?view=account`, { signal })
}

