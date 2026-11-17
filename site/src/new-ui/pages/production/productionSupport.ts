import type { SupportSenderRole } from '../../adapters/contracts'
import { copyByLocale } from './productionPresentation'

export const EMAIL_SUPPORT_ENABLED = true

export function stableTicketNumber(id: string, createdAt?: string | null, updatedAt?: string | null) {
  const year = (createdAt || updatedAt || new Date().toISOString()).slice(0, 4).replace(/\D/g, '') || '2026'
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return `SAT-${year}-${String(hash % 1000000).padStart(6, '0')}`
}

export function supportStatusTone(status?: string) {
  const normalized = String(status || 'open').toLowerCase()
  if (normalized === 'closed' || normalized === 'blocked') return 'neutral' as const
  if (normalized === 'resolved') return 'success' as const
  if (normalized === 'waiting_for_customer' || normalized === 'awaiting_customer' || normalized === 'answered') return 'warning' as const
  return 'info' as const
}

export function supportStatusLabel(status: string | undefined, locale: 'ar' | 'en') {
  const normalized = String(status || 'open').toLowerCase()
  const labels: Record<string, { en: string; ar: string }> = {
    open: { en: 'Open', ar: 'مفتوحة' },
    waiting_for_support: { en: 'Waiting for support', ar: 'بانتظار الدعم' },
    awaiting_support: { en: 'Waiting for support', ar: 'بانتظار الدعم' },
    waiting_for_customer: { en: 'Waiting for customer', ar: 'بانتظار العميل' },
    awaiting_customer: { en: 'Waiting for customer', ar: 'بانتظار العميل' },
    answered: { en: 'Waiting for customer', ar: 'بانتظار العميل' },
    resolved: { en: 'Resolved', ar: 'تم الحل' },
    closed: { en: 'Closed', ar: 'مغلقة' },
    reopened: { en: 'Reopened', ar: 'أعيد فتحها' },
    blocked: { en: 'Blocked', ar: 'محظورة' },
  }
  const item = labels[normalized] || labels.open
  return locale === 'ar' ? item.ar : item.en
}

export function supportSenderRole(sender: string | undefined, explicitRole?: SupportSenderRole): SupportSenderRole {
  if (explicitRole) return explicitRole
  const normalized = String(sender || '').trim().toLowerCase()
  if (normalized === 'admin' || normalized === 'support' || normalized === 'support_agent' || normalized === 'agent') return 'support_agent'
  if (normalized === 'internal' || normalized === 'internal_note') return 'internal_note'
  if (normalized === 'system') return 'system'
  if (normalized === 'email_inbound') return 'email_inbound'
  return 'customer'
}

export function supportSenderLabel(role: SupportSenderRole, locale: 'ar' | 'en') {
  if (role === 'support_agent') return copyByLocale(locale, 'Support', 'الدعم')
  if (role === 'internal_note') return copyByLocale(locale, 'Internal note', 'ملاحظة داخلية')
  if (role === 'system') return copyByLocale(locale, 'System', 'النظام')
  if (role === 'email_inbound') return copyByLocale(locale, 'Customer by email', 'العميل عبر البريد')
  return copyByLocale(locale, 'Customer', 'العميل')
}

export function supportMessageClass(role: SupportSenderRole) {
  return `support-message support-message--${role}`
}

export function supportAuditLabel(eventType: string, locale: 'ar' | 'en') {
  const labels: Record<string, { en: string; ar: string }> = {
    ticket_created: { en: 'Ticket created', ar: 'إنشاء التذكرة' },
    customer_reply: { en: 'Customer replied', ar: 'رد العميل' },
    support_reply: { en: 'Support replied', ar: 'رد الدعم' },
    internal_note_added: { en: 'Internal note added', ar: 'إضافة ملاحظة داخلية' },
    status_changed: { en: 'Status changed', ar: 'تغيير الحالة' },
    priority_changed: { en: 'Priority changed', ar: 'تغيير الأولوية' },
    ticket_closed: { en: 'Ticket closed', ar: 'إغلاق التذكرة' },
    ticket_reopened: { en: 'Ticket reopened', ar: 'إعادة فتح التذكرة' },
    sender_blocked: { en: 'Sender blocked', ar: 'حظر المرسل' },
    sender_unblocked: { en: 'Sender unblocked', ar: 'إلغاء حظر المرسل' },
    inbound_email_processed: { en: 'Email reply received', ar: 'استلام رد عبر البريد' },
    email_delivery_failed: { en: 'Email delivery failed', ar: 'فشل تسليم البريد' },
    email_delivery_retry_scheduled: { en: 'Email retry scheduled', ar: 'جدولة إعادة إرسال البريد' },
    email_retry_requested: { en: 'Email retry requested', ar: 'طلب إعادة إرسال البريد' },
  }
  const item = labels[eventType] || { en: 'Support activity', ar: 'نشاط دعم' }
  return locale === 'ar' ? item.ar : item.en
}

export function supportErrorMessage(error: unknown, locale: 'ar' | 'en') {
  const raw = String(error instanceof Error ? error.message : error || '').trim()
  const key = raw.toLowerCase()
  if (key === 'auth_session_expired' || key === 'not_authenticated' || key === 'missing_id_token' || key === 'unauthorized') {
    return copyByLocale(locale, 'Your session expired. Sign in again and retry.', 'انتهت جلسة تسجيل الدخول. سجّل الدخول مرة أخرى ثم أعد المحاولة.')
  }
  if (key === 'support_ticket_forbidden' || key === 'thread_not_found') {
    return copyByLocale(locale, 'This ticket is unavailable or no longer belongs to this account.', 'هذه التذكرة غير متاحة أو لم تعد مرتبطة بهذا الحساب.')
  }
  if (key === 'support_inbox_unavailable') return copyByLocale(locale, 'Could not load support. Try again.', 'تعذر تحميل بيانات الدعم. أعد المحاولة.')
  if (key === 'support_rate_limited') {
    return copyByLocale(locale, 'Daily support message limit reached. Try again later.', 'تم الوصول إلى الحد اليومي لرسائل الدعم. حاول لاحقًا.')
  }
  if (key === 'support_blocked') return copyByLocale(locale, 'Support messaging is unavailable for this account.', 'إرسال رسائل الدعم غير متاح لهذا الحساب.')
  if (key === 'ticket_closed') return copyByLocale(locale, 'Reopen the ticket before sending another reply.', 'أعد فتح التذكرة قبل إرسال رد جديد.')
  if (key === 'network_unavailable' || key.includes('failed to fetch') || key.includes('network')) {
    return copyByLocale(locale, 'Unable to reach the server right now. Check the connection and retry.', 'تعذر الوصول إلى الخادم حاليًا. تحقق من الاتصال ثم أعد المحاولة.')
  }
  return copyByLocale(locale, 'The request could not be completed. Try again.', 'تعذر تنفيذ الطلب. حاول مرة أخرى.')
}
