import type { AdminSubscription, AdminUserDetail } from '../../../api/admin'

export type SubscriptionAction = 'suspend' | 'resume' | 'cancel_at_period_end' | 'cancel_now' | 'end_trial' | 'correct_expiry' | 'revoke_entitlement'

export function isCurrentSubscriptionRecord(subscription: AdminSubscription) {
  return subscription.is_current_record ?? subscription.is_current === true
}

export function currentAccountSubscription(detail: Pick<AdminUserDetail, 'item' | 'subscription_projection' | 'subscription_integrity'>): AdminSubscription | null {
  if (!detail.item || !isCurrentSubscriptionRecord(detail.item)) return null
  const projection = detail.subscription_projection || detail.item.subscription_projection
  const integrity = detail.subscription_integrity
  return {
    ...detail.item,
    subscription_projection: projection,
    effective_lifecycle: projection?.lifecycle || detail.item.effective_lifecycle,
    plan_term: projection?.plan_term || detail.item.plan_term,
    integrity_warning: integrity?.integrity && integrity.integrity !== 'ok'
      ? integrity.code || integrity.integrity : detail.item.integrity_warning,
  }
}

export function subscriptionDisplayLifecycle(subscription: AdminSubscription) {
  return subscription.effective_lifecycle || (isCurrentSubscriptionRecord(subscription)
    ? subscription.subscription_projection?.lifecycle || subscription.lifecycle_state || subscription.status
    : subscription.lifecycle_state || subscription.status)
}

export function subscriptionActions(subscription: AdminSubscription, now = Date.now()): SubscriptionAction[] {
  if (subscription.integrity_warning || subscription.subscription_projection?.entitlement === 'integrity_conflict') return []
  const lifecycle = subscriptionDisplayLifecycle(subscription)
  if (lifecycle === 'suspended') {
    // Suspension clears the database's is_current flag. Only offer recovery
    // if the account projection confirms there isn't a replacement subscription.
    if (subscription.subscription_projection?.existence !== 'none') return []
    const expiresAt = Date.parse(subscription.period_end_at || subscription.expires_at)
    return subscription.plan_term === 'lifetime' || (Number.isFinite(expiresAt) && expiresAt > now)
      ? ['resume', 'cancel_now'] : []
  }
  if (!isCurrentSubscriptionRecord(subscription)) return []
  if (['cancelled', 'revoked', 'none', 'integrity_conflict'].includes(lifecycle || '')) return []
  if (['expired', 'no_subscription'].includes(lifecycle || '')) return subscription.plan_term === 'lifetime' ? [] : ['correct_expiry']
  if (!['trialing', 'active', 'past_due', 'cancel_at_period_end', 'scheduled'].includes(lifecycle || '')) return []
  if (subscription.plan_term === 'lifetime') return ['suspend', 'cancel_now']
  return [
    ...(lifecycle === 'trialing' ? ['end_trial' as const] : []),
    'correct_expiry', 'suspend',
    ...(['active', 'trialing', 'past_due'].includes(lifecycle || '') ? ['cancel_at_period_end' as const] : []),
    'cancel_now',
  ]
}

export function subscriptionSourceLabel(subscription: AdminSubscription, locale: 'ar' | 'en') {
  const source = subscription.source_type || subscription.provider
  if (['manual', 'admin_manual', 'manual_grant_replace_current'].includes(source || '')) return locale === 'ar' ? 'منح إداري' : 'Admin grant'
  if (source === 'subscription_recovery') return locale === 'ar' ? 'استعادة اشتراك' : 'Subscription recovery'
  return source || '—'
}
